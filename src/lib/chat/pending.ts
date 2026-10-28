import "server-only";

// Offene Abläufe im Bot (Rückfragen in ingest_jobs: Kauf-Erfassung per Foto/Text, „Neuer Wein“,
// Verkostet, WSET-Verkostung, Foto zuordnen, Chat-Vorschläge mit Ja/Nein). Bei jeder
// eingehenden Nachricht zuerst: Rückfragen ohne Antwort seit 30 Minuten verwerfen und kurz
// melden; ein neues Anliegen (Foto, Menü, Befehl, neuer Wein im Text) verwirft den alten
// Ablauf. Der DB-Job expire-stale-ingest-jobs ist nur das Sicherheitsnetz.

import type { Json, Tables } from "@/lib/database.types";
import { formatDate, zurichDate } from "@/lib/format";
import type { AdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { announcesTasting, tastedIntent } from "./tasted-text";

export const PENDING_TTL_MS = 30 * 60 * 1000;
export const EXPIRED_ERROR = "abgelaufen: 30 Min. ohne Antwort";

type Job = Pick<Tables<"ingest_jobs">, "id" | "source" | "status" | "extracted" | "created_at" | "updated_at">;
type Extracted = {
  step?: string;
  proposal?: { name?: string | null; vintage_year?: number | null };
  title?: string;
  text?: string;
  encounterId?: string;
  wineName?: string;
};

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** Verkostet-Eintrag schon gespeichert (nur noch freiwillige Ergänzungen offen)? */
export const isSavedTasted = (job: Pick<Job, "source" | "extracted">) =>
  job.source === "telegram_tasted" && Boolean((job.extracted as Extracted | null)?.encounterId);

/** „die angefangene Erfassung von Pintia 2019 (11:27)“ bzw. „der Vorschlag „…“ (11:27)“. */
export function flowLabel(job: Pick<Job, "source" | "extracted" | "created_at">) {
  const x = (job.extracted ?? {}) as Extracted;
  const wine = x.proposal?.name ? `${x.proposal.name}${x.proposal.vintage_year != null ? ` ${x.proposal.vintage_year}` : ""}` : null;
  const at = time(job.created_at);
  const today = formatDate(zurichDate(new Date().toISOString()));
  const day = at ? formatDate(zurichDate(job.created_at)) : null;
  const when = !at ? "" : day === today ? ` (${at})` : ` (${day} ${at})`;
  switch (job.source) {
    case "telegram_edit":
      return `der Vorschlag „${(x.text ?? "").slice(0, 60)}${(x.text?.length ?? 0) > 60 ? "…" : ""}“${when}`;
    case "telegram_tasting":
      return `die angefangene WSET-Verkostung${x.title ? ` von ${x.title}` : ""}${when}`;
    case "telegram_attach":
      return `das angefangene Foto-Zuordnen${when}`;
    case "telegram_tasted":
      return `die angefangene Verkostet-Erfassung${wine ? ` von ${wine}` : ""}${when}`;
    default:
      if (x.step === "describe") return `der angefangene „Neue Wein“${when}`;
      return `die angefangene Erfassung${wine ? ` von ${wine}` : ""}${when}`;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Offene Abläufe dieses Chats (neueste zuerst). */
export async function openFlows(db: AdminClient, chatId: number): Promise<Job[]> {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("id, source, status, extracted, created_at, updated_at")
    .eq("telegram_chat_id", chatId)
    .in("status", ["received", "processing", "needs_review"])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // Merker der Menüleiste u. ä. sind keine Abläufe.
  return (data ?? []).filter((j) => j.source !== MENU_SOURCE);
}

/** Ablauf beenden: Verkostet schon gespeichert → abgeschlossen (still), sonst verworfen. */
async function close(db: AdminClient, job: Job, error: string | null) {
  const saved = isSavedTasted(job);
  const extracted = saved ? ({ ...(job.extracted as object), step: "t_done" } as Json) : undefined;
  await db
    .from("ingest_jobs")
    .update(saved ? { status: "confirmed", extracted } : { status: "discarded", ...(error ? { error } : {}) })
    .eq("id", job.id)
    .eq("status", job.status);
  return saved ? null : job;
}

/**
 * Rückfragen ohne Antwort seit 30 Minuten (updated_at – jede Antwort setzt die Zeit neu)
 * verwerfen und kurz melden. Laufende Arbeit (received/processing) verfällt still.
 */
export async function expireStale(db: AdminClient, chatId: number, now = Date.now()) {
  const stale = (await openFlows(db, chatId)).filter((j) => Date.parse(j.updated_at) < now - PENDING_TTL_MS);
  const closed: Job[] = [];
  for (const job of stale) {
    const done = await close(db, job, EXPIRED_ERROR);
    if (done && job.status === "needs_review") closed.push(done);
  }
  if (closed.length) {
    await sendMessage(chatId, closed.map((j) => `⏱ ${escapeHtml(capitalize(flowLabel(j)))} ist abgelaufen.`).join("\n"));
  }
  return closed;
}

export type Supersede = "photo" | "menu" | "command" | "text";

/**
 * Ein neues Anliegen verwirft den alten Ablauf (nur Rückfragen, keine laufende Arbeit).
 * Foto: eine wartende Foto-Zuordnung bleibt (das Foto gehört dorthin). Chat-Vorschläge mit
 * Ja/Nein fangen keine Nachrichten ab und bleiben stehen (bis sie ablaufen).
 */
export async function supersede(db: AdminClient, chatId: number, reason: Supersede, keep: string[] = []) {
  const flows = (await openFlows(db, chatId)).filter(
    (j) =>
      j.status === "needs_review" &&
      !keep.includes(j.id) &&
      j.source !== "telegram_edit" &&
      // Das Foto gehört zu „📷 Foto“ bzw. zur Ankündigung „wir verkosten einen Wein“.
      !(reason === "photo" && (j.source === "telegram_attach" || (j.extracted as Extracted | null)?.step === "t_armed")),
  );
  const closed: Job[] = [];
  for (const job of flows) {
    const done = await close(db, job, null);
    if (done) closed.push(done);
  }
  if (closed.length) {
    await sendMessage(chatId, closed.map((j) => `Ich habe ${escapeHtml(flowLabel(j))} verworfen.`).join("\n"));
  }
  return closed;
}

/** /abbrechen bzw. „✖️ Abbrechen“ ohne Bezug: alle offenen Rückfragen dieses Chats beenden. */
export async function cancelAll(db: AdminClient, chatId: number) {
  const flows = (await openFlows(db, chatId)).filter((j) => j.status === "needs_review");
  const closed: Job[] = [];
  for (const job of flows) {
    const done = await close(db, job, null);
    if (done) closed.push(done);
  }
  return closed.map(flowLabel);
}

/** Antwort auf eine Rückfrage: die 30 Minuten laufen ab jetzt neu (Trigger setzt updated_at). */
export async function touchFlow(db: AdminClient, jobId: string) {
  await db.from("ingest_jobs").update({ status: "needs_review" }).eq("id", jobId).eq("status", "needs_review");
}

/** Deutliche Zeichen für ein neues Anliegen statt einer Antwort (Befehl, Wein mit Hinweis, Ankündigung). */
export function strongNewConcern(text: string) {
  const t = text.trim();
  // Kurze Antworten wie „14 Glas“ oder „im Restaurant“ sind keine neuen Anliegen.
  return t.startsWith("/") || announcesTasting(t) || (tastedIntent(t) !== null && t.split(/\s+/).length >= 4);
}

/** Passt nicht als kurze Antwort (Zahl, Jahr, Preis) und sieht nach einem neuen Anliegen aus. */
export function looksLikeNewConcern(text: string) {
  const t = text.trim();
  return strongNewConcern(t) || t.split(/\s+/).length >= 4 || t.length >= 25;
}

// ---------------------------------------------------------------------------
// Menüleiste: neue Version einmal pro Chat mitschicken

export const MENU_SOURCE = "telegram_menu";

/** Welche Version der Menüleiste dieser Chat zuletzt bekommen hat (Merker in ingest_jobs). */
export async function menuVersionSeen(db: AdminClient, chatId: number) {
  const { data } = await db
    .from("ingest_jobs")
    .select("id, extracted")
    .eq("source", MENU_SOURCE)
    .eq("telegram_chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { id: data?.id ?? null, version: Number((data?.extracted as { version?: number } | null)?.version ?? 0) };
}

export async function rememberMenuVersion(db: AdminClient, chatId: number, version: number, id: string | null) {
  const extracted = { version } as Json;
  if (id) await db.from("ingest_jobs").update({ extracted }).eq("id", id);
  else await db.from("ingest_jobs").insert({ source: MENU_SOURCE, telegram_chat_id: chatId, status: "confirmed", extracted });
}
