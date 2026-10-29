import "server-only";

// Offene Abläufe im Bot (Rückfragen in ingest_jobs: Kauf-Erfassung per Foto/Text, „Neuer Wein“,
// Verkostet, WSET-Verkostung, Foto zuordnen, Chat-Vorschläge mit Ja/Nein). Bei jeder
// eingehenden Nachricht zuerst: Rückfragen ohne Antwort seit 10 Minuten verwerfen und kurz
// melden; ein neues Anliegen (Foto, Menü, Befehl, neuer Wein im Text) verwirft den alten
// Ablauf. Der DB-Job expire-stale-ingest-jobs ist nur das Sicherheitsnetz.

import type { Json, Tables } from "@/lib/database.types";
import { T, type FlowSubject } from "@/lib/bot/texts";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram/api";
import { announcesTasting, tastedIntent } from "./tasted-text";

export { EXPIRED_ERROR, PENDING_TTL_MS } from "./ttl";
import { EXPIRED_ERROR, PENDING_TTL_MS } from "./ttl";

type Job = Pick<Tables<"ingest_jobs">, "id" | "source" | "status" | "extracted" | "created_at" | "updated_at">;
type Extracted = {
  step?: string;
  proposal?: { name?: string | null; vintage_year?: number | null };
  title?: string;
  text?: string;
  encounterId?: string;
  wineName?: string;
};

/** Verkostet-Eintrag schon gespeichert (nur noch freiwillige Ergänzungen offen)? */
export const isSavedTasted = (job: Pick<Job, "source" | "extracted">) =>
  job.source === "telegram_tasted" && Boolean((job.extracted as Extracted | null)?.encounterId);

/**
 * „📷 Neuer Wein“ wartet noch leer auf Foto oder Beschreibung (Schritt describe) – ohne Inhalt.
 * Wird er durch das Foto/Album bzw. die Beschreibung abgelöst, ist das die Antwort darauf:
 * still schliessen, keine Meldung „… lasse ich beiseite“.
 */
export const isEmptyNewWine = (job: Pick<Job, "extracted">) => (job.extracted as Extracted | null)?.step === "describe";

/** Preis-Rückfrage nach der Suche (Charge schon gespeichert): verfällt still, der Preis bleibt leer. */
export const isPriceFollowup = (job: Pick<Job, "extracted">) => Boolean((job.extracted as { price_followup?: unknown } | null)?.price_followup);

/** Zurückgehaltene Preis-Rückfrage (wartet, bis keine andere Erfassung mehr läuft). */
export const isHeldPrice = (job: Pick<Job, "extracted">) => (job.extracted as Extracted | null)?.step === "price_held";

/** Worum es im Ablauf ging – für „Den angefangenen Pintia 2019 lasse ich mal beiseite.“ */
export function flowSubject(job: Pick<Job, "source" | "extracted">): FlowSubject {
  const x = (job.extracted ?? {}) as Extracted;
  const wine = x.proposal?.name ? `${x.proposal.name}${x.proposal.vintage_year != null ? ` ${x.proposal.vintage_year}` : ""}` : null;
  switch (job.source) {
    case "telegram_edit":
      return { kind: "proposal", text: `${(x.text ?? "").slice(0, 60)}${(x.text?.length ?? 0) > 60 ? "…" : ""}` };
    case "telegram_tasting":
      return { kind: "tasting", wine: x.title ?? null };
    case "telegram_attach":
      return { kind: "photos" };
    case "telegram_document":
      return { kind: "document", file: (job.extracted as { file?: { name?: string } } | null)?.file?.name ?? null };
    default:
      if (x.step === "describe") return { kind: "newWine" };
      return wine ? { kind: "wine", wine } : { kind: "entry" };
  }
}

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
 * Rückfragen ohne Antwort seit 10 Minuten (updated_at – jede Antwort setzt die Zeit neu)
 * verwerfen und kurz melden. Laufende Arbeit (received/processing) verfällt still.
 */
export async function expireStale(db: AdminClient, chatId: number, now = Date.now()) {
  // Zurückgehaltene Preis-Rückfragen: keine 10-Min.-Frist (beginnt erst beim Senden; Obergrenze 24
  // Std. – expireHeldPriceQuestions).
  const stale = (await openFlows(db, chatId)).filter((j) => !isHeldPrice(j) && Date.parse(j.updated_at) < now - PENDING_TTL_MS);
  const closed: Job[] = [];
  for (const job of stale) {
    const done = await close(db, job, EXPIRED_ERROR);
    if (done && job.status === "needs_review") closed.push(done);
  }
  // Nur Abläufe mit Inhalt melden; ein leerer „Neuer Wein“ und Preis-Rückfragen verfallen still.
  const reported = closed.filter((j) => !isEmptyNewWine(j) && !isPriceFollowup(j));
  if (reported.length) {
    await sendMessage(chatId, reported.map((j) => T.laidAside(flowSubject(j))).join("\n"));
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
  const open = await openFlows(db, chatId);
  // Preis-Rückfragen zu schon gespeicherten Flaschen: nicht verwerfen, sondern zurückhalten – sie
  // kommen nach der neuen Erfassung wieder (releaseHeldPriceQuestions).
  for (const job of open.filter((j) => j.status === "needs_review" && isPriceFollowup(j) && !keep.includes(j.id) && !isHeldPrice(j))) {
    const x = job.extracted as { step?: string; price_followup?: Record<string, unknown> };
    await db
      .from("ingest_jobs")
      .update({ extracted: { ...x, step: "price_held", price_followup: { ...x.price_followup, held_step: x.step, held_at: new Date().toISOString() } } as Json })
      .eq("id", job.id)
      .eq("status", "needs_review");
  }
  const flows = open.filter(
    (j) =>
      j.status === "needs_review" &&
      !isPriceFollowup(j) &&
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
  // Ein leerer „Neuer Wein“ (wartet nur auf Foto oder Beschreibung) wird durch genau diese
  // Antwort abgelöst – still. Gemeldet wird nur, was wirklich Inhalt hatte (z. B. erkannter Wein).
  const reported = closed.filter((j) => !isEmptyNewWine(j) && !isPriceFollowup(j));
  if (reported.length) {
    await sendMessage(chatId, reported.map((j) => T.laidAside(flowSubject(j))).join("\n"));
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
  return closed.map(flowSubject);
}

/**
 * Eine offene Erfassung dieses Chats weglassen (Chat: „lösch das“, „vergiss den“). Ohne
 * Rückfrage – es geht nichts verloren. „saved“: Verkostet war schon gespeichert (nur noch
 * freiwillige Ergänzungen offen) – der Eintrag bleibt, die Ergänzungen fallen weg.
 */
export async function cancelFlow(db: AdminClient, chatId: number, jobId: string) {
  const job = (await openFlows(db, chatId)).find((j) => j.id === jobId);
  if (!job) return { status: "gone" as const };
  const subject = flowSubject(job);
  const done = await close(db, job, null);
  return { status: done ? ("cancelled" as const) : ("saved" as const), subject };
}

/** Antwort auf eine Rückfrage: die 10 Minuten laufen ab jetzt neu (Trigger setzt updated_at). */
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
