import "server-only";

// Dokumente (PDF) über den Bot: Schickt man Antoine ein PDF, fragt er, zu welchem Wein es
// gehört (bis zu 3 Vorschläge aus Dateiname und Bildtext, „🔎 Anderen Wein suchen“,
// „✖️ Abbrechen“). Nach „📎 Dokument“ im Wein-Menü gehört das nächste PDF (innert 10 Min.)
// ohne Rückfrage zu diesem Wein. Gespeichert wie in der App (storeDocument).
// Job in ingest_jobs (source telegram_document); Knöpfe dc:<job>:<0–4|s|x>.

import { T } from "@/lib/bot/texts";
import { wineHref } from "@/lib/cellar/wine-page";
import { PENDING_TTL_MS } from "@/lib/chat/ttl";
import type { Json } from "@/lib/database.types";
import { matchWines, type MatchWine, type WineMatch } from "@/lib/media/doc-match";
import { MAX_DOCUMENT_BYTES, PDF_MIME, cleanFileName, storeDocument } from "@/lib/media/documents";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { answerCallback, downloadFile, editMessage, sendMessage } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgDocument, TgInlineKeyboard, TgMessage } from "@/lib/telegram/types";

export const DOCUMENT_SOURCE = "telegram_document";

type Target = { wineId: string; year: number | null; title: string };

export type DocState = {
  kind: "document";
  /** waiting: „📎 Dokument“ wartet auf das PDF; choose: Wein wählen; search: wartet auf einen Namen. */
  step: "waiting" | "choose" | "search" | "saving" | "done";
  file?: { fileId: string; name: string; size: number | null };
  caption?: string;
  candidates?: Target[];
  target?: Target;
};

const state = (job: { extracted: Json | null }) => job.extracted as unknown as DocState;
const title = (m: { name: string; year: number | null }) => `${m.name}${m.year != null ? ` ${m.year}` : ""}`;
const toTarget = (m: WineMatch): Target => ({ wineId: m.wineId, year: m.year, title: title(m) });

/** PDF? (Telegram-„document“ mit PDF-Typ oder Endung .pdf) */
export function isPdfDocument(doc: TgDocument | undefined) {
  return Boolean(doc && (doc.mime_type === PDF_MIME || /\.pdf$/i.test(doc.file_name ?? "")));
}

const data = (jobId: string, action: string) => `dc:${jobId}:${action}`;
export const isDocumentCallback = (value: string | undefined) => /^dc:[0-9a-f-]{36}:([0-4]|s|x)$/.test(value ?? "");

const cancelRow = (jobId: string) => [{ text: "✖️ Abbrechen", callback_data: data(jobId, "x") }];

function chooseKeyboard(jobId: string, candidates: Target[]): TgInlineKeyboard {
  return {
    inline_keyboard: [
      ...candidates.map((c, i) => [{ text: `🍷 ${c.title}`, callback_data: data(jobId, String(i)) }]),
      [{ text: "🔎 Anderen Wein suchen", callback_data: data(jobId, "s") }],
      cancelRow(jobId),
    ],
  };
}

/** Weine mit ihren Jahrgängen (Flaschen und Verkostet) für den Abgleich. */
async function loadMatchWines(db: AdminClient): Promise<MatchWine[]> {
  const [wines, items, encounters] = await Promise.all([
    db.from("wines").select("id, name, producer"),
    db.from("inventory_items").select("wine_id, vintage_year"),
    db.from("wine_encounters").select("wine_id, vintage_year"),
  ]);
  for (const r of [wines, items, encounters]) if (r.error) throw r.error;
  const years = new Map<string, Set<number | null>>();
  for (const r of [...(items.data ?? []), ...(encounters.data ?? [])]) {
    const set = years.get(r.wine_id) ?? new Set();
    set.add(r.vintage_year);
    years.set(r.wine_id, set);
  }
  return (wines.data ?? []).map((w) => ({ ...w, years: [...(years.get(w.id) ?? [])] }));
}

async function openDocJobs(db: AdminClient, chatId: number) {
  const { data: rows, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("source", DOCUMENT_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // Gleiche Zeitgrenze wie alle Rückfragen: 10 Minuten ab der letzten Aktivität.
  return (rows ?? []).filter((j) => Date.parse(j.updated_at) >= Date.now() - PENDING_TTL_MS);
}

/** Schritt atomar weiterschalten (nur aus dem erwarteten Schritt – Doppelklicks). */
async function advance(db: AdminClient, jobId: string, from: DocState["step"], next: DocState, status: "needs_review" | "confirmed" | "discarded" = "needs_review") {
  const { data: row, error } = await db
    .from("ingest_jobs")
    .update({ extracted: next as unknown as Json, status })
    .eq("id", jobId)
    .eq("status", "needs_review")
    .eq("extracted->>step", from)
    .select("id");
  if (error) throw error;
  return Boolean(row?.length);
}

/** „📎 Dokument“ im Wein-Menü: das nächste PDF gehört zu diesem Wein. Ältere Wartende verfallen. */
export async function startDocumentWait(db: AdminClient, chatId: number, target: { wineId: string; year: number | null }) {
  const { data: wine, error } = await db.from("wines").select("name").eq("id", target.wineId).maybeSingle();
  if (error) throw error;
  if (!wine) return { text: T.researchWineGone, keyboard: { inline_keyboard: [] } as TgInlineKeyboard };
  await db
    .from("ingest_jobs")
    .update({ status: "discarded" })
    .eq("source", DOCUMENT_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review");
  const t: Target = { ...target, title: title({ name: wine.name, year: target.year }) };
  const { data: job, error: jobError } = await db
    .from("ingest_jobs")
    .insert({
      source: DOCUMENT_SOURCE,
      telegram_chat_id: chatId,
      status: "needs_review",
      matched_wine_id: target.wineId,
      extracted: { kind: "document", step: "waiting", target: t } as unknown as Json,
    })
    .select("id")
    .single();
  if (jobError) throw jobError;
  return { text: T.docWaiting(t.title), keyboard: { inline_keyboard: [cancelRow(job.id)] } as TgInlineKeyboard };
}

/** PDF herunterladen und wie in der App ablegen; Bestätigung erst nach dem Eintrag in der DB. */
async function save(db: AdminClient, chatId: number, file: NonNullable<DocState["file"]>, target: Target) {
  const { bytes } = await downloadFile(file.fileId);
  await storeDocument(db, { wineId: target.wineId, vintageYear: target.year, bytes, fileName: file.name });
  const base = appBaseUrl();
  const link = base ? `\n${T.openInApp(`${base}${wineHref(target.wineId, target.year)}`)}` : "";
  return `${T.docSaved(target.title)}${link}`;
}

/** Ein PDF ist angekommen. */
export async function handleDocument(msg: TgMessage) {
  const chatId = msg.chat.id;
  const doc = msg.document!;
  if ((doc.file_size ?? 0) > MAX_DOCUMENT_BYTES) {
    await sendMessage(chatId, T.docTooBig);
    return;
  }
  const db = createAdminClient();
  const file = { fileId: doc.file_id, name: cleanFileName(doc.file_name), size: doc.file_size ?? null };

  // „📎 Dokument“ wartet: ohne Rückfrage zu diesem Wein.
  const waiting = (await openDocJobs(db, chatId)).find((j) => state(j).step === "waiting");
  if (waiting) {
    const target = state(waiting).target!;
    if (!(await advance(db, waiting.id, "waiting", { ...state(waiting), step: "saving", file }))) return;
    try {
      const text = await save(db, chatId, file, target);
      await advance(db, waiting.id, "saving", { ...state(waiting), step: "done", file }, "confirmed");
      await sendMessage(chatId, text);
    } catch (error) {
      console.error("bot document save failed", error);
      await advance(db, waiting.id, "saving", { ...state(waiting), step: "done", file }, "discarded");
      await sendMessage(chatId, T.docSaveError);
    }
    return;
  }

  // Sonst fragen, zu welchem Wein es gehört – mit Vorschlägen aus Dateiname und Bildtext.
  const caption = msg.caption?.trim().slice(0, 500) ?? "";
  const candidates = matchWines(`${file.name} ${caption}`, await loadMatchWines(db)).map(toTarget);
  const draft: DocState = { kind: "document", step: "choose", file, caption, candidates };
  const { data: job, error } = await db
    .from("ingest_jobs")
    .insert({ source: DOCUMENT_SOURCE, telegram_chat_id: chatId, status: "needs_review", extracted: draft as unknown as Json })
    .select("id")
    .single();
  if (error) throw error;
  await sendMessage(chatId, candidates.length ? T.docWhichWine(file.name) : T.docWhichWineNone(file.name), chooseKeyboard(job.id, candidates));
}

/** Wartet ein Dokument auf einen Weinnamen („🔎 Anderen Wein suchen“)? */
export async function findDocumentAwaitingText(db: AdminClient, chatId: number) {
  return (await openDocJobs(db, chatId)).find((j) => state(j).step === "search") ?? null;
}

/** Name zu „🔎 Anderen Wein suchen“: bis zu 5 Treffer als Knöpfe. */
export async function handleDocumentSearch(db: AdminClient, job: { id: string; extracted: Json | null }, chatId: number, text: string) {
  const results = matchWines(text, await loadMatchWines(db), 5).map(toTarget);
  if (!results.length) {
    await db.from("ingest_jobs").update({ status: "needs_review" }).eq("id", job.id).eq("status", "needs_review"); // Zeit neu
    await sendMessage(chatId, T.docSearchNone(text.slice(0, 80)), { inline_keyboard: [cancelRow(job.id)] });
    return;
  }
  if (!(await advance(db, job.id, "search", { ...state(job), step: "choose", candidates: results }))) return;
  await sendMessage(chatId, T.docSearchResults, chooseKeyboard(job.id, results));
}

/** Knöpfe: Wein gewählt, anderen suchen, abbrechen. */
export async function handleDocumentCallback(cb: TgCallbackQuery) {
  const [, jobId, action] = (cb.data ?? "").split(":");
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (chatId == null || messageId == null) return answerCallback(cb.id);
  const db = createAdminClient();
  const job = (await openDocJobs(db, chatId)).find((j) => j.id === jobId);
  if (!job) {
    await answerCallback(cb.id, T.docGone);
    return;
  }
  const s = state(job);

  if (action === "x") {
    await answerCallback(cb.id);
    if (await advance(db, job.id, s.step, { ...s, step: "done" }, "discarded")) await editMessage(chatId, messageId, T.docCancelled);
    return;
  }
  if (action === "s") {
    await answerCallback(cb.id);
    if (s.step !== "choose" || !(await advance(db, job.id, "choose", { ...s, step: "search" }))) return;
    await editMessage(chatId, messageId, T.docSearchAsk, { inline_keyboard: [cancelRow(job.id)] });
    return;
  }
  const target = s.candidates?.[Number(action)];
  if (s.step !== "choose" || !target || !s.file) {
    await answerCallback(cb.id, T.docGone);
    return;
  }
  if (!(await advance(db, job.id, "choose", { ...s, step: "saving", target }))) {
    await answerCallback(cb.id, T.alreadyDone);
    return;
  }
  await answerCallback(cb.id);
  try {
    const text = await save(db, chatId, s.file, target);
    await advance(db, job.id, "saving", { ...s, step: "done", target }, "confirmed");
    await editMessage(chatId, messageId, text);
  } catch (error) {
    console.error("bot document save failed", error);
    await advance(db, job.id, "saving", { ...s, step: "done", target }, "discarded");
    await editMessage(chatId, messageId, T.docSaveError);
  }
}
