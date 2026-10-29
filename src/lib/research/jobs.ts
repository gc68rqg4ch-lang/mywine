import "server-only";

// Recherche im Hintergrund: 🔎 auf der Weinseite und der Sammellauf legen Aufträge in
// research_jobs; der Worker (API-Route, jede Minute per pg_cron) arbeitet sie nacheinander ab –
// nie parallel (Sperre research_worker_lock in der DB, Aufträge mit „for update skip locked“).
// API-Limit: sofort Stopp, der Rest bleibt „queued“ mit hold = 'usage_limit' (Fortsetzen auf
// /recherche). Ist ein Lauf fertig, meldet Antoine es der Person, die gestartet hat (Telegram).
// Vor dem Einspielen der Migration fehlt die Tabelle: dann „unavailable“ – die Seiten
// recherchieren wie bisher direkt.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { apiProblem } from "@/lib/ai/api-errors";
import { later } from "@/lib/later";
import { appBaseUrl } from "@/lib/telegram/config";
import { researchDrinkWindowYears } from "./drink-window";
import type { ResearchScope } from "./gaps";
import { limitText, runDoneText, singleDoneText, type JobResult, type RunCounts } from "./job-text";
import { researchAndFillWine, type ResearchOutcome, type TasteMode } from "./wine";

type Db = SupabaseClient<Database>;
export type JobRow = Database["public"]["Tables"]["research_jobs"]["Row"];
export type JobKind = "page" | "research" | "window";

/** Angaben für die Recherche – wie bisher an researchAndFillWine bzw. das Trinkfenster übergeben. */
export type JobParams = {
  scope?: ResearchScope;
  taste?: TasteMode;
  /** Jahrgang fürs Profil; fehlt = die Recherche wählt (null = ohne Jahrgang). */
  year?: number | null;
  skipRecent?: boolean;
  /** „Trinkfenster fehlt“: diese Jahrgänge. */
  years?: (number | null)[];
};

export type NewJob = { wineId: string; kind: JobKind; params: JobParams; vintageYear?: number | null };

/** Worker: so lange neue Aufträge beginnen (danach bleibt Zeit, den laufenden zu beenden). */
export const WORKER_BUDGET_MS = 150_000;
/** Sperre hält etwas länger als die Laufzeit der Funktion (300 s). */
export const WORKER_LOCK_SECONDS = 330;
/** Vorübergehende Fehler (Überlast): so oft versuchen, dann „failed“. */
const MAX_ATTEMPTS = 3;

/** Tabelle bzw. Funktion fehlt (Migration noch nicht eingespielt). */
export function missingSchema(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code ?? "") || /research_(jobs|worker)|claim_research_job/.test(error.message ?? "");
}

// ——— Anlegen, Abbrechen, Fortsetzen, Stand ———

/** Aufträge eines Laufs anlegen. unavailable: Migration fehlt (dann wie bisher direkt recherchieren). */
export async function enqueueRun(db: Db, jobs: NewJob[], createdBy: string | null): Promise<{ runId: string } | { unavailable: true } | { empty: true }> {
  if (!jobs.length) return { empty: true };
  const runId = randomUUID();
  const { error } = await db.from("research_jobs").insert(
    jobs.map((j, i) => ({
      run_id: runId,
      wine_id: j.wineId,
      kind: j.kind,
      params: j.params as Json,
      vintage_year: j.vintageYear ?? (typeof j.params.year === "number" ? j.params.year : null),
      position: i,
      created_by: createdBy,
    })),
  );
  if (missingSchema(error)) return { unavailable: true };
  if (error) throw error;
  return { runId };
}

/** Abbrechen: offene (auch angehaltene) Aufträge → skipped. Der laufende Wein wird noch fertig. */
export async function cancelRun(db: Db, runId: string) {
  const { data, error } = await db
    .from("research_jobs")
    .update({ status: "skipped", hold: null, finished_at: new Date().toISOString() })
    .eq("run_id", runId)
    .eq("status", "queued")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Fortsetzen nach dem API-Limit: angehaltene Aufträge wieder freigeben. */
export async function resumeRun(db: Db, runId: string) {
  const { data, error } = await db.from("research_jobs").update({ hold: null, error: null }).eq("run_id", runId).eq("status", "queued").not("hold", "is", null).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export function countJobs(rows: Pick<JobRow, "status" | "hold">[]): RunCounts {
  const c: RunCounts = { total: rows.length, done: 0, failed: 0, skipped: 0, queued: 0, running: 0, held: 0 };
  for (const r of rows) {
    if (r.status === "queued" && r.hold) c.held++;
    else if (r.status in c) c[r.status as "done" | "failed" | "skipped" | "queued" | "running"]++;
  }
  return c;
}

export type RunInfo = { runId: string; createdAt: string; counts: RunCounts; holdReason: string | null };

/** Letzter Sammellauf (für /recherche); null ohne Lauf bzw. ohne Migration. */
export async function latestBatchRun(db: Db): Promise<RunInfo | null> {
  const { data: last, error } = await db.from("research_jobs").select("run_id, created_at").neq("kind", "page").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (missingSchema(error)) return null;
  if (error) throw error;
  if (!last) return null;
  const { data: rows, error: rowsError } = await db.from("research_jobs").select("status, hold, error").eq("run_id", last.run_id);
  if (rowsError) throw rowsError;
  return {
    runId: last.run_id,
    createdAt: last.created_at,
    counts: countJobs(rows ?? []),
    holdReason: (rows ?? []).find((r) => r.hold)?.error ?? null,
  };
}

/** Weinseite: läuft für diesen Wein eine Recherche (🔎 oder Sammellauf)? Ohne Migration: nein. */
export async function wineJobStatus(db: Db, wineId: string): Promise<{ running: boolean; last: string | null }> {
  const { data, error } = await db
    .from("research_jobs")
    .select("status, hold, summary, finished_at")
    .eq("wine_id", wineId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    if (!missingSchema(error)) console.error("research job status failed", wineId, error.message);
    return { running: false, last: null };
  }
  const rows = data ?? [];
  const running = rows.some((r) => r.status === "running" || (r.status === "queued" && !r.hold));
  return { running, last: rows.find((r) => r.status === "done" || r.status === "failed")?.summary ?? null };
}

/** Worker sofort anstossen (statt bis zur nächsten Minute zu warten); der Cron bleibt die Sicherung. */
export function kickWorker() {
  const secret = process.env.RESEARCH_WORKER_SECRET;
  const base = appBaseUrl();
  if (!secret || !base) return;
  later(async () => {
    try {
      await fetch(`${base}/api/research/worker`, { method: "POST", headers: { "x-research-worker-secret": secret }, signal: AbortSignal.timeout(2000) });
    } catch {
      // Zeitlimit: der Worker läuft in seinem eigenen Aufruf weiter.
    }
  });
}

// ——— Abarbeiten ———

const toResult = (o: ResearchOutcome): JobResult => ({ status: o.status, filled: o.filled, suggested: o.suggested, ...(o.taste ? { taste: o.taste } : {}) });

/** Einen Auftrag ausführen (wie bisher die Server Actions). Fehler kommen als status „error“ zurück. */
export async function runJob(db: Db, job: Pick<JobRow, "wine_id" | "kind" | "params">): Promise<ResearchOutcome> {
  const p = (job.params ?? {}) as JobParams;
  try {
    if (job.kind === "window") return await researchDrinkWindowYears(db, job.wine_id, p.years ?? []);
    const year = "year" in p ? { year: p.year ?? null } : {};
    if (job.kind === "page") return await researchAndFillWine(db, job.wine_id, "all", { taste: "always", ...year });
    return await researchAndFillWine(db, job.wine_id, p.scope === "all" ? "all" : "cellar", { taste: p.taste ?? "missing", ...year, skipRecent: p.skipRecent !== false });
  } catch (error) {
    const problem = apiProblem(error);
    console.error("research job failed", job.wine_id, problem?.message ?? error);
    return { status: "error", filled: [], suggested: 0, seconds: 0, error: problem ?? { kind: "other", message: "Die Recherche ist fehlgeschlagen." } };
  }
}

export type WorkerResult =
  | { status: "unavailable" }
  | { status: "busy" }
  | { status: "ok"; processed: number; halted: "usage_limit" | "temporary" | null; wines: string[] };

/**
 * Aufträge nacheinander abarbeiten, solange Zeit bleibt (budgetMs). Nur mit der Sperre; ein
 * zweiter gleichzeitiger Aufruf bekommt „busy“ und macht nichts.
 */
export async function processQueue(
  db: Db,
  options: { budgetMs?: number; lockSeconds?: number; runner?: (job: JobRow) => Promise<ResearchOutcome>; now?: () => number } = {},
): Promise<WorkerResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const owner = randomUUID();
  const runner = options.runner ?? ((job: JobRow) => runJob(db, job));
  const { data: locked, error } = await db.rpc("acquire_research_worker", { p_owner: owner, p_seconds: options.lockSeconds ?? WORKER_LOCK_SECONDS });
  if (missingSchema(error)) return { status: "unavailable" };
  if (error) throw error;
  if (!locked) return { status: "busy" };

  const wines: string[] = [];
  let halted: "usage_limit" | "temporary" | null = null;
  try {
    // Abgebrochene Aufrufe (Zeitlimit): ihre „running“-Aufträge wieder einreihen – die Sperre haben jetzt wir.
    await db.from("research_jobs").update({ status: "queued", started_at: null }).eq("status", "running").lt("attempts", MAX_ATTEMPTS);
    await db.from("research_jobs").update({ status: "failed", error: "Abgebrochen (Zeitlimit)", finished_at: new Date().toISOString() }).eq("status", "running");

    while (now() - started < (options.budgetMs ?? WORKER_BUDGET_MS)) {
      const { data: claimed, error: claimError } = await db.rpc("claim_research_job", { p_owner: owner });
      if (claimError) throw claimError;
      const job = (Array.isArray(claimed) ? claimed[0] : claimed) as JobRow | undefined;
      if (!job) break;

      const outcome = await runner(job);
      const finished = new Date().toISOString();
      if (outcome.error?.kind === "usage_limit") {
        // Sofort Stopp: dieser und alle offenen Aufträge bleiben „queued“, angehalten mit Grund.
        await db.from("research_jobs").update({ status: "queued", started_at: null, hold: "usage_limit", error: outcome.error.message }).eq("id", job.id);
        await holdOpenRuns(db, outcome.error.message, job.run_id);
        halted = "usage_limit";
        break;
      }
      if (outcome.error?.kind === "temporary" && job.attempts < MAX_ATTEMPTS) {
        // Überlastet: später nochmals (nächster Aufruf), jetzt nicht weiter drängeln.
        await db.from("research_jobs").update({ status: "queued", started_at: null, error: outcome.error.message }).eq("id", job.id);
        halted = "temporary";
        break;
      }
      const failed = outcome.status === "error";
      const result = toResult(outcome);
      await db
        .from("research_jobs")
        .update({
          status: failed ? "failed" : "done",
          result: result as Json,
          summary: jobSummary(result, outcome.error?.message ?? null),
          error: failed ? (outcome.error?.message ?? "Fehlgeschlagen") : null,
          finished_at: finished,
        })
        .eq("id", job.id);
      wines.push(job.wine_id);
      await notifyIfRunDone(db, job.run_id);
    }
  } finally {
    await db.rpc("release_research_worker", { p_owner: owner });
  }
  return { status: "ok", processed: wines.length, halted, wines };
}

/** Kurzer Text fürs Ergebnis (Weinseite, Liste). */
export function jobSummary(r: JobResult, error: string | null) {
  if (r.status === "error") return error ?? "Fehlgeschlagen";
  if (r.status === "complete") return "Diesen Wein gibt es nicht mehr.";
  const parts = [r.filled.length ? `Ergänzt: ${r.filled.join(", ")}` : null, r.suggested ? `${r.suggested} ${r.suggested === 1 ? "Vorschlag" : "Vorschläge"} zum Prüfen` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nichts Neues gefunden";
}

/** API-Limit: alle offenen Aufträge anhalten und je betroffenem Lauf einmal melden, wie viele offen sind. */
async function holdOpenRuns(db: Db, reason: string, currentRun: string) {
  const { data, error } = await db
    .from("research_jobs")
    .update({ hold: "usage_limit", error: reason })
    .eq("status", "queued")
    .is("hold", null)
    .select("run_id");
  if (error) throw error;
  // Nur die jetzt angehaltenen Läufe (früher angehaltene wurden schon gemeldet).
  const runs = new Set([currentRun, ...(data ?? []).map((r) => r.run_id)]);
  const { data: held, error: heldError } = await db.from("research_jobs").select("run_id, kind, wine_id, created_by").eq("status", "queued").eq("hold", "usage_limit").in("run_id", [...runs]);
  if (heldError) throw heldError;
  for (const runId of runs) {
    const rows = (held ?? []).filter((r) => r.run_id === runId);
    if (!rows.length) continue;
    const link = rows.length === 1 && rows[0].kind === "page" ? `/wein/${rows[0].wine_id}` : "/recherche";
    await sendTo(db, rows[0].created_by, limitText(rows.length), link);
  }
}

/** Lauf fertig (nichts mehr offen)? Dann genau einmal melden. */
async function notifyIfRunDone(db: Db, runId: string) {
  const { data: rows, error } = await db.from("research_jobs").select("id, wine_id, kind, status, hold, result, error, created_by, notified_at").eq("run_id", runId);
  if (error) throw error;
  const list = rows ?? [];
  if (!list.length || list.some((r) => r.status === "queued" || r.status === "running")) return;
  // Gegen doppelte Meldungen (zwei Aufrufe): nur wer notified_at setzt, meldet.
  const { data: marked, error: markError } = await db.from("research_jobs").update({ notified_at: new Date().toISOString() }).eq("run_id", runId).is("notified_at", null).select("id");
  if (markError) throw markError;
  if (!marked?.length) return;
  const person = list[0].created_by;
  const results = list.map((r) => r.result as JobResult | null);
  if (list.length === 1 && list[0].kind === "page") {
    const { data: wine } = await db.from("wines").select("name, producer").eq("id", list[0].wine_id).maybeSingle();
    const name = [wine?.producer, wine?.name].filter(Boolean).join(" ") || "Wein";
    await sendTo(db, person, singleDoneText(name, results[0]), `/wein/${list[0].wine_id}`);
    return;
  }
  // Nur abgebrochen (nichts erledigt): keine Meldung – die Person hat selbst abgebrochen.
  const counts = countJobs(list);
  if (counts.done + counts.failed === 0) return;
  await sendTo(db, person, runDoneText(counts, results), "/recherche");
}

/** Nachricht von Antoine an die Person (persons.telegram_user_id); ohne Telegram: nichts. */
async function sendTo(db: Db, personId: string | null, html: string, path: string) {
  if (!personId) return;
  try {
    const { data } = await db.from("persons").select("telegram_user_id").eq("id", personId).maybeSingle();
    if (!data?.telegram_user_id) return;
    const { sendMessage } = await import("@/lib/telegram/api");
    const base = appBaseUrl();
    await sendMessage(data.telegram_user_id, base ? `${html}\n${base}${path}` : html);
  } catch (error) {
    console.error("research notify failed", personId, error instanceof Error ? error.message : error);
  }
}
