// Recherche im Hintergrund: Warteschlange anlegen, nacheinander abarbeiten, Sperre bei
// gleichzeitigem Aufruf, API-Limit → Stopp und Rest bleibt „queued“, Abbrechen/Fortsetzen,
// Telegram-Meldung von Antoine, Secret der Worker-Route, ohne Migration wie bisher.
// Supabase (inkl. der SQL-Funktionen als Nachbildung), Telegram und Claude per fetch-Stub.
// Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeError, claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelRun, countJobs, enqueueRun, latestBatchRun, processQueue, resumeRun, runJob, wineJobStatus, type JobRow } from "@/lib/research/jobs";
import { limitText, progressText, runDoneText, singleDoneText } from "@/lib/research/job-text";
import { secretMatches, workerSecretFrom } from "@/lib/secret";
import type { ResearchOutcome } from "@/lib/research/wine";

type Row = Record<string, unknown>;
const LIMIT = "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
const W = [1, 2, 3, 4].map((i) => `${i}${i}${i}${i}${i}${i}${i}${i}-1111-4111-8111-111111111111`);
const P = "99999999-9999-4999-8999-999999999999";

let claude: (body: Record<string, unknown>) => Record<string, unknown> = () => claudeError(400, LIMIT) as never;
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: (body) => claude(body) };

// Nachbildung der SQL-Funktionen (Sperre mit Ablaufzeit, Auftrag übernehmen).
let clock = Date.parse("2026-10-29T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
net.rpc.acquire_research_worker = (args) => {
  const lock = net.tables.research_worker_lock[0];
  const free = !lock.locked_until || Date.parse(String(lock.locked_until)) < clock || lock.owner === args.p_owner;
  if (!free) return false;
  Object.assign(lock, { owner: args.p_owner, locked_until: iso(clock + Number(args.p_seconds) * 1000) });
  return true;
};
net.rpc.release_research_worker = (args) => {
  const lock = net.tables.research_worker_lock[0];
  if (lock.owner === args.p_owner) Object.assign(lock, { owner: null, locked_until: null });
  return null;
};
net.rpc.claim_research_job = (args) => {
  const lock = net.tables.research_worker_lock[0];
  if (lock.owner !== args.p_owner || Date.parse(String(lock.locked_until)) <= clock) return [];
  const next = net.tables.research_jobs
    .filter((j) => j.status === "queued" && j.hold == null)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.position) - Number(b.position))[0];
  if (!next) return [];
  Object.assign(next, { status: "running", started_at: iso(clock), attempts: Number(next.attempts) + 1 });
  return [{ ...next }];
};
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();

function reset() {
  net.tables = {
    research_jobs: [],
    research_worker_lock: [{ id: 1, owner: null, locked_until: null }],
    persons: [{ id: P, name: "Michel", telegram_user_id: 111 }],
    wines: W.map((id, i) => ({ id, name: ["Alion", "Pintia", "Pago", "Fay"][i], producer: "Vega Sicilia", country: null, region: null, appellation: null, type: "red", alcohol_content: null, grapes: [], researched_at: null })),
    inventory_items: [], wine_encounters: [], wine_vintages: [], wine_grape_shares: [], wine_taste_profiles: [], wine_media: [], research_suggestions: [], vendors: [],
  };
  net.telegram.length = 0;
  net.fail = undefined;
  clock = Date.parse("2026-10-29T10:00:00Z");
}

/** Insert setzt in der Nachbildung keine Standardwerte – wie die DB: queued, attempts 0, created_at. */
function withDefaults() {
  for (const j of net.tables.research_jobs) {
    j.status ??= "queued";
    j.attempts ??= 0;
    j.hold ??= null;
    j.notified_at ??= null;
    j.created_at ??= iso(clock);
    j.id ??= `job-${j.position}-${String(j.wine_id).slice(0, 4)}`;
  }
}

const ok = (filled: string[] = [], extra: Partial<ResearchOutcome> = {}): ResearchOutcome => ({ status: filled.length ? "filled" : "nothing", filled, suggested: 0, seconds: 1, ...extra });
const statuses = () => net.tables.research_jobs.map((j) => `${j.status}${j.hold ? `/${j.hold}` : ""}`);

test("Warteschlange anlegen: ein Lauf, Reihenfolge, wer gestartet hat; Fortschritt", async () => {
  reset();
  const queued = await enqueueRun(db, W.slice(0, 3).map((wineId) => ({ wineId, kind: "research" as const, params: { scope: "cellar", taste: "missing", skipRecent: true } })), P);
  assert.ok("runId" in queued);
  withDefaults();
  const rows = net.tables.research_jobs;
  assert.deepEqual(rows.map((r) => [r.wine_id, r.position, r.kind, r.created_by, r.run_id]), W.slice(0, 3).map((w, i) => [w, i, "research", P, queued.runId]));
  assert.deepEqual(rows[0].params, { scope: "cellar", taste: "missing", skipRecent: true });
  assert.equal(progressText(countJobs(rows as never)), "0 von 3 erledigt");
  assert.deepEqual(await enqueueRun(db, [], P), { empty: true });
});

test("Abarbeitung nacheinander, Meldung per Telegram, wenn der Lauf fertig ist", async () => {
  reset();
  const queued = await enqueueRun(db, W.slice(0, 3).map((wineId) => ({ wineId, kind: "research" as const, params: {} })), P);
  withDefaults();
  const order: string[] = [];
  let active = 0;
  const runner = async (job: JobRow) => {
    active++;
    assert.equal(active, 1, "nie parallel");
    order.push(job.wine_id);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (job.wine_id === W[0]) return ok(["Region", "Trinkfenster 2019 (2024–2030)"], { taste: "saved", suggested: 1 });
    if (job.wine_id === W[1]) return ok(["Geschmacksprofil"], { taste: "saved" });
    return ok();
  };
  const result = await processQueue(db, { runner });
  assert.deepEqual(result, { status: "ok", processed: 3, halted: null, wines: W.slice(0, 3) });
  assert.deepEqual(order, W.slice(0, 3));
  assert.deepEqual(statuses(), ["done", "done", "done"]);
  assert.equal(net.tables.research_jobs[0].summary, "Ergänzt: Region, Trinkfenster 2019 (2024–2030) · 1 Vorschlag zum Prüfen");
  assert.equal(net.tables.research_worker_lock[0].owner, null, "Sperre wieder frei");
  const messages = net.telegram.filter((m) => m.method === "sendMessage");
  assert.equal(messages.length, 1, "genau eine Meldung pro Lauf");
  assert.equal(messages[0].body.chat_id, 111);
  assert.match(String(messages[0].body.text), /^🔎 Recherche fertig: 3 Weine, 2 Profile, 1 Trinkfenster, 1 Vorschlag zum Prüfen\./);
  assert.match(String(messages[0].body.text), /https:\/\/mywine\.example\/recherche$/);
  // Nochmals aufrufen: nichts mehr offen, keine zweite Meldung
  assert.deepEqual(await processQueue(db, { runner }), { status: "ok", processed: 0, halted: null, wines: [] });
  assert.equal(net.telegram.length, 1);
  const run = await latestBatchRun(db);
  assert.equal(run?.runId, (queued as { runId: string }).runId);
  assert.equal(progressText(run!.counts), "3 von 3 erledigt");
});

test("Sperre: ein zweiter gleichzeitiger Aufruf macht nichts doppelt", async () => {
  reset();
  await enqueueRun(db, W.slice(0, 2).map((wineId) => ({ wineId, kind: "research" as const, params: {} })), P);
  withDefaults();
  const seen: string[] = [];
  const runner = async (job: JobRow) => {
    seen.push(job.id);
    await new Promise((r) => setTimeout(r, 20));
    return ok();
  };
  const [first, second] = await Promise.all([processQueue(db, { runner }), processQueue(db, { runner })]);
  assert.deepEqual([first.status, second.status].sort(), ["busy", "ok"]);
  assert.equal(seen.length, 2);
  assert.equal(new Set(seen).size, 2, "kein Auftrag doppelt");
  // Abgelaufene Sperre (abgestürzter Aufruf) blockiert nicht für immer
  net.tables.research_worker_lock[0] = { id: 1, owner: "alt", locked_until: iso(clock - 1000) };
  assert.equal((await processQueue(db, { runner })).status, "ok");
});

test("Laufzeit: nur so viele Aufträge, wie ins Zeitbudget passen; der Rest bleibt für den nächsten Aufruf", async () => {
  reset();
  await enqueueRun(db, W.map((wineId) => ({ wineId, kind: "research" as const, params: {} })), P);
  withDefaults();
  let t = 0;
  const result = await processQueue(db, { budgetMs: 100, now: () => t, runner: async () => ((t += 60), ok()) });
  assert.equal(result.status === "ok" && result.processed, 2);
  assert.deepEqual(statuses(), ["done", "done", "queued", "queued"]);
  assert.equal(net.telegram.length, 0, "Lauf noch nicht fertig");
});

test("API-Limit: sofort Stopp, Rest bleibt queued (angehalten) mit Grund; Meldung; Fortsetzen", async () => {
  reset();
  const queued = (await enqueueRun(db, W.slice(0, 3).map((wineId) => ({ wineId, kind: "research" as const, params: {} })), P)) as { runId: string };
  withDefaults();
  const calls: string[] = [];
  const runner = async (job: JobRow): Promise<ResearchOutcome> => {
    calls.push(job.wine_id);
    if (job.wine_id === W[1]) return { status: "error", filled: [], suggested: 0, seconds: 0, error: { kind: "usage_limit", message: "API-Limit erreicht – ab 1. November geht es wieder." } };
    return ok();
  };
  const result = await processQueue(db, { runner });
  assert.equal(result.status === "ok" && result.halted, "usage_limit");
  assert.deepEqual(calls, [W[0], W[1]], "nach dem Limit keine weitere Anfrage");
  assert.deepEqual(statuses(), ["done", "queued/usage_limit", "queued/usage_limit"]);
  assert.equal(net.tables.research_jobs[1].error, "API-Limit erreicht – ab 1. November geht es wieder.");
  const message = net.telegram.find((m) => m.method === "sendMessage");
  assert.match(String(message?.body.text), /Kontingent ist aufgebraucht.*Noch 2 Weine offen/);
  // Nächster Aufruf (Cron): angehaltene Aufträge bleiben liegen
  assert.equal((await processQueue(db, { runner })).status === "ok" && calls.length, 2);
  const run = await latestBatchRun(db);
  assert.deepEqual([run?.counts.held, run?.holdReason], [2, "API-Limit erreicht – ab 1. November geht es wieder."]);
  // Fortsetzen → wieder abgearbeitet, dann Meldung „fertig“
  assert.equal(await resumeRun(db, queued.runId), 2);
  await processQueue(db, { runner: async () => ok() });
  assert.deepEqual(statuses(), ["done", "done", "done"]);
  assert.match(String(net.telegram.at(-1)?.body.text), /^🔎 Recherche fertig: 3 Weine/);
});

test("API-Limit in der echten Recherche: weder researched_at noch taste_profile_checked_at gesetzt", async () => {
  reset();
  claude = () => claudeError(400, LIMIT) as never;
  const outcome = await runJob(db, { wine_id: W[0], kind: "page", params: { year: null } });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.error?.kind, "usage_limit");
  assert.equal(net.tables.wines[0].researched_at, null);
  assert.ok(net.tables.wine_vintages.every((v: Row) => v.taste_profile_checked_at == null));
  claude = () => claudeTool("report_wine_details", {}) as never;
});

test("Abbrechen: offene (auch angehaltene) Aufträge → skipped; der laufende wird fertig", async () => {
  reset();
  const queued = (await enqueueRun(db, W.map((wineId) => ({ wineId, kind: "research" as const, params: {} })), P)) as { runId: string };
  withDefaults();
  net.tables.research_jobs[0].status = "running";
  net.tables.research_jobs[3].hold = "usage_limit";
  assert.equal(await cancelRun(db, queued.runId), 3);
  assert.deepEqual(statuses(), ["running", "skipped", "skipped", "skipped"]);
  assert.equal(progressText(countJobs(net.tables.research_jobs as never)), "0 von 1 erledigt");
});

test("🔎 auf der Weinseite: ein Auftrag, „läuft“ bis fertig, Meldung mit Name und Fund", async () => {
  reset();
  await enqueueRun(db, [{ wineId: W[0], kind: "page", params: { year: 2019 } }], P);
  withDefaults();
  assert.equal(net.tables.research_jobs[0].vintage_year, 2019);
  assert.deepEqual(await wineJobStatus(db, W[0]), { running: true, last: null });
  await processQueue(db, { runner: async () => ok(["Region", "Geschmacksprofil"], { taste: "saved" }) });
  assert.deepEqual(await wineJobStatus(db, W[0]), { running: false, last: "Ergänzt: Region, Geschmacksprofil" });
  const text = String(net.telegram.find((m) => m.method === "sendMessage")?.body.text);
  assert.match(text, /^🔎 Recherche fertig: <b>Vega Sicilia Alion<\/b> – ergänzt: Region, Geschmacksprofil\./);
  assert.match(text, new RegExp(`https://mywine\\.example/wein/${W[0]}$`));
});

test("Ohne Telegram-ID keine Meldung; Meldung geht nur an die Person, die gestartet hat", async () => {
  reset();
  net.tables.persons[0].telegram_user_id = null;
  await enqueueRun(db, [{ wineId: W[0], kind: "page", params: {} }], P);
  withDefaults();
  await processQueue(db, { runner: async () => ok() });
  assert.equal(net.telegram.length, 0);
});

test("Ohne Migration: unavailable – die Seiten recherchieren wie bisher direkt", async () => {
  reset();
  net.fail = (_m, table) => (table === "research_jobs" ? { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.research_jobs' in the schema cache" } } : null);
  assert.deepEqual(await enqueueRun(db, [{ wineId: W[0], kind: "page", params: {} }], P), { unavailable: true });
  assert.equal(await latestBatchRun(db), null);
  assert.deepEqual(await wineJobStatus(db, W[0]), { running: false, last: null });
  const rpc = net.rpc.acquire_research_worker;
  net.rpc.acquire_research_worker = () => ({ __status: 404, body: { code: "PGRST202", message: "Could not find the function public.acquire_research_worker" } });
  assert.deepEqual(await processQueue(db, { runner: async () => ok() }), { status: "unavailable" });
  net.rpc.acquire_research_worker = rpc;
});

test("Telegram-Texte: fertig (Lauf, einzelner Wein, nichts gefunden), API-Limit", () => {
  const counts = { total: 21, done: 18, failed: 1, skipped: 1, queued: 0, running: 0, held: 0 };
  const results = [{ status: "filled" as const, filled: ["Trinkfenster 2019: ≈ 2024–2030"], suggested: 2, taste: "saved" }, { status: "nothing" as const, filled: [], suggested: 0 }];
  assert.equal(runDoneText(counts, results, () => 0), "🔎 Recherche fertig: 20 Weine, 1 Profil, 1 Trinkfenster, 2 Vorschläge zum Prüfen. (1 nicht geklappt, 1 abgebrochen) Die Vorschläge findest du in der App unter „Recherche“.");
  assert.match(runDoneText({ ...counts, failed: 0, skipped: 0, total: 1, done: 1 }, [null]), /^🔎 Recherche fertig: 1 Wein, 0 Profile, 0 Trinkfenster, 0 Vorschläge zum Prüfen\. [^(]/);
  assert.equal(singleDoneText("Alion <2019>", { status: "nothing", filled: [], suggested: 0 }, () => 0), "🔎 Recherche fertig: <b>Alion &lt;2019&gt;</b> – ich habe nichts Neues gefunden.");
  assert.match(singleDoneText("Alion", { status: "error", filled: [], suggested: 0 }), /nicht durchgekommen/);
  assert.match(limitText(1), /Noch 1 Wein offen/);
  for (const text of [runDoneText(counts, results), limitText(3), singleDoneText("X", null)]) assert.ok(!text.includes("ß") && !/API/.test(text), text);
});

test("Worker-Route: nur mit Secret (Header oder Bearer); ohne Variable 503", async () => {
  assert.equal(secretMatches("geheim", "geheim"), true);
  assert.equal(secretMatches("geheimX", "geheim"), false);
  assert.equal(secretMatches(null, "geheim"), false);
  assert.equal(secretMatches("geheim", undefined), false);
  assert.equal(workerSecretFrom(new Headers({ "x-research-worker-secret": "s1" })), "s1");
  assert.equal(workerSecretFrom(new Headers({ authorization: "Bearer s2" })), "s2");
  const { POST } = await import("@/app/api/research/worker/route");
  const call = (headers: Record<string, string>) => POST(new Request("https://mywine.example/api/research/worker", { method: "POST", headers }) as never);
  delete process.env.RESEARCH_WORKER_SECRET;
  assert.equal((await call({ "x-research-worker-secret": "x" })).status, 503);
  process.env.RESEARCH_WORKER_SECRET = "richtig";
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ "x-research-worker-secret": "falsch" })).status, 401);
  reset();
  const res = await call({ authorization: "Bearer richtig" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "ok", processed: 0, halted: null, wines: [] });
  delete process.env.RESEARCH_WORKER_SECRET;
});
