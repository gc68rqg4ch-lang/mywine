import "server-only";

import { PENDING_TTL_MS } from "@/lib/chat/ttl";
import { T } from "@/lib/bot/texts";
// „📷 Foto“ im Wein-Menü des Bots: Vorder-/Rückseite zu einem bestehenden Wein und
// Jahrgang nachreichen – als wine_media mit Vorschaubild, ohne neue Charge.
// Ablauf in ingest_jobs (source = telegram_attach, Stand in extracted):
//   waiting → (side, bei nur einem Foto) → (confirm, falls schon Vorder-/Rückseite da) → saving → done
// Knöpfe: A:<aktion>:<job>  f/b = Seite des Einzelfotos, r = ersetzen, x = abbrechen.

import { after } from "next/server";
import { wineHref } from "@/lib/cellar/wine-page";
import type { Json } from "@/lib/database.types";
import { wineName } from "@/lib/format";
import { MEDIA_KIND_LABELS, labelKinds, type MediaKind } from "@/lib/media/pick";
import { loadVintageMedia, removeWineMedia, saveWineMedia } from "@/lib/media/store";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { answerCallback, editMessage, escapeHtml, sendMessage } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgInlineKeyboard } from "@/lib/telegram/types";
import { ALBUM_QUIET_MS, PHOTO_BUCKET, deleteJobPhotos, listJobPhotos, type IngestJob } from "./jobs";

export const ATTACH_SOURCE = "telegram_attach";
/** So lange wartet „📷 Foto“ auf die Bilder; danach gehen Fotos wieder an die normale Erfassung. */
export const ATTACH_WINDOW_MS = PENDING_TTL_MS;
/** Mehr als Vorder-, Rückseite und ein paar weitere braucht es nicht. */
const MAX_PHOTOS = 4;

type AttachStep = "waiting" | "processing" | "side" | "confirm" | "saving" | "done";

export type AttachState = {
  kind: "attach";
  step: AttachStep;
  wineId: string;
  vintageYear: number | null;
  itemId: string | null;
  /** „Produzent – Name 2019“ für die Nachrichten (bereits ohne HTML). */
  title: string;
  /** Art je Foto (Reihenfolge wie photo_paths), sobald bekannt. */
  kinds?: MediaKind[];
};

const e = escapeHtml;
const state = (job: Pick<IngestJob, "extracted">) => job.extracted as unknown as AttachState;
const yearLabel = (year: number | null) => (year == null ? "o. J." : String(year));

// ---------------------------------------------------------------------------
// Knöpfe

type AttachAction = "f" | "b" | "r" | "x";

const data = (action: AttachAction, jobId: string) => `A:${action}:${jobId}`;

export function isAttachCallback(value: string | undefined) {
  return /^A:[fbrx]:[0-9a-f-]{36}$/.test(value ?? "");
}

const cancelRow = (jobId: string) => [{ text: "✖️ Abbrechen", callback_data: data("x", jobId) }];

export function sideKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Vorderseite", callback_data: data("f", jobId) },
        { text: "Rückseite", callback_data: data("b", jobId) },
      ],
      cancelRow(jobId),
    ],
  };
}

export function replaceKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "🔁 Ersetzen", callback_data: data("r", jobId) }, ...cancelRow(jobId)]] };
}

// ---------------------------------------------------------------------------
// Job

/** Schaltet atomar weiter – nur wenn der Job noch im erwarteten Schritt ist (Doppelklicks). */
async function advance(
  db: AdminClient,
  job: IngestJob,
  from: AttachStep[],
  patch: Partial<AttachState>,
  columns: Partial<Pick<IngestJob, "status" | "photo_paths" | "error">> = {},
) {
  const current = state(job);
  if (!from.includes(current.step)) return null;
  const { data: next, error } = await db
    .from("ingest_jobs")
    .update({ extracted: { ...current, ...patch } as unknown as Json, ...columns })
    .eq("id", job.id)
    .eq("status", "needs_review")
    .eq("extracted->>step", current.step)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return next;
}

/**
 * „📷 Foto“ angetippt: neuen Job anlegen (ältere offene dieses Chats verfallen) und
 * die Anleitung als Text des Menüs zurückgeben.
 */
export async function startAttach(
  db: AdminClient,
  chatId: number,
  target: { wineId: string; vintageYear: number | null; itemId: string | null },
): Promise<{ text: string; keyboard: TgInlineKeyboard }> {
  const { data: wine, error } = await db.from("wines").select("name, producer").eq("id", target.wineId).maybeSingle();
  if (error) throw error;
  if (!wine) return { text: "Diesen Wein gibt es nicht mehr.", keyboard: { inline_keyboard: [] } };

  await discardAttach(db, chatId);
  const draft: AttachState = {
    kind: "attach",
    step: "waiting",
    ...target,
    title: `${wineName(wine)} ${yearLabel(target.vintageYear)}`,
  };
  const { data: job, error: jobError } = await db
    .from("ingest_jobs")
    .insert({
      source: ATTACH_SOURCE,
      telegram_chat_id: chatId,
      status: "needs_review",
      matched_wine_id: target.wineId,
      inventory_item_id: target.itemId,
      extracted: draft as unknown as Json,
    })
    .select("id")
    .single();
  if (jobError) throw jobError;
  return {
    text: `📷 Fotos für <b>${e(draft.title)}</b>\nSchick mir Vorder- und Rückseite als Album – die Vorderseite zuerst. Ich ordne sie diesem Jahrgang zu und lege keine neue Flasche an.`,
    keyboard: { inline_keyboard: [cancelRow(job.id)] },
  };
}

/** Wartende Zuordnung beenden (z. B. bei „📷 Neuer Wein“) und ihre Fotos löschen. */
export async function discardAttach(db: AdminClient, chatId: number) {
  const { data } = await db
    .from("ingest_jobs")
    .update({ status: "discarded" })
    .eq("source", ATTACH_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .select("photo_paths");
  await deleteJobPhotos(db, (data ?? []).flatMap((j) => j.photo_paths));
}

/** Job, der gerade auf Fotos wartet (höchstens 10 Minuten alt). */
export async function findAttachJob(db: AdminClient, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("source", ATTACH_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "waiting")
    .gte("updated_at", new Date(Date.now() - ATTACH_WINDOW_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Ein Foto des Albums ist im Ordner des Jobs gelandet: Aktivität vermerken (updated_at
 * per Trigger) und nach der Ruhezeit verarbeiten. false = Verarbeitung läuft schon.
 */
export async function noteAttachPhoto(db: AdminClient, jobId: string, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ status: "needs_review" })
    .eq("id", jobId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "waiting")
    .select("id");
  if (error) throw error;
  if (!data?.length) return false;
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, ALBUM_QUIET_MS + 1000));
    await processAttach(jobId, chatId);
  });
  return true;
}

/** Album vollständig: Seiten bestimmen, ggf. nachfragen, sonst speichern. Läuft nur einmal. */
export async function processAttach(jobId: string, chatId: number) {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - ALBUM_QUIET_MS).toISOString();
  const { data: claimed, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "waiting")
    .lt("updated_at", cutoff)
    .maybeSingle();
  if (error) throw error;
  if (!claimed) return;

  try {
    const photos = (await listJobPhotos(db, jobId)).slice(0, MAX_PHOTOS);
    if (!photos.length) return;
    const paths = photos.map((p) => p.path);
    const job = await advance(db, claimed, ["waiting"], { step: "processing" }, { photo_paths: paths });
    if (!job) return;

    if (paths.length === 1) {
      await advance(db, job, ["processing"], { step: "side" });
      await sendMessage(chatId, T.attachWhichSide, sideKeyboard(jobId));
      return;
    }
    await decide(db, job, chatId, labelKinds(paths.length));
  } catch (err) {
    await failAttach(db, jobId, chatId, err);
  }
}

/** Seiten stehen fest: gibt es die schon für den Jahrgang, erst nachfragen. */
async function decide(db: AdminClient, job: IngestJob, chatId: number, kinds: MediaKind[]) {
  const s = state(job);
  const existing = await loadVintageMedia(db, s.wineId, s.vintageYear, labelSides(kinds));
  if (existing.length) {
    const next = await advance(db, job, ["processing", "side"], { step: "confirm", kinds });
    if (!next) return;
    const what = [...new Set(existing.map((r) => MEDIA_KIND_LABELS[r.kind]))].join(" und ");
    await sendMessage(
      chatId,
      `📷 Für <b>${e(s.title)}</b> habe ich schon: ${e(what)}. Soll ich sie durch die neuen Fotos ersetzen?`,
      replaceKeyboard(job.id),
    );
    return;
  }
  const next = await advance(db, job, ["processing", "side"], { step: "saving", kinds });
  if (next) await saveAttach(db, next, chatId, false);
}

const labelSides = (kinds: MediaKind[]) => kinds.filter((k) => k === "label_front" || k === "label_back");

async function saveAttach(db: AdminClient, job: IngestJob, chatId: number, replace: boolean) {
  const s = state(job);
  const kinds = s.kinds ?? labelKinds(job.photo_paths.length);
  try {
    // Vorhandene erst nach dem Speichern der neuen löschen – schlägt etwas fehl, bleibt das alte Foto.
    const old = replace ? await loadVintageMedia(db, s.wineId, s.vintageYear, labelSides(kinds)) : [];
    const media = await Promise.all(
      job.photo_paths.map(async (path, i) => {
        const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
        if (error) throw error;
        return {
          path,
          bytes: new Uint8Array(await data.arrayBuffer()),
          mimeType: data.type || "image/jpeg",
          kind: kinds[i] ?? "photo",
          sortOrder: i,
        };
      }),
    );
    await saveWineMedia(db, { wineId: s.wineId, vintageYear: s.vintageYear, itemId: s.itemId }, media);
    await removeWineMedia(db, db, old);
    await db
      .from("ingest_jobs")
      .update({ status: "confirmed", extracted: { ...s, step: "done" } as unknown as Json })
      .eq("id", job.id);

    const base = appBaseUrl();
    const link = base ? `\n<a href="${base}${wineHref(s.wineId, s.vintageYear)}">In MyWine öffnen</a>` : "";
    const saved = kinds.map((k) => MEDIA_KIND_LABELS[k]).join(", ");
    await sendMessage(chatId, `✅ Ich habe ${e(saved)} ${replace ? "ersetzt" : "gespeichert"} · ${e(s.title)}${link}`);
  } catch (err) {
    await failAttach(db, job.id, chatId, err);
  }
}

async function failAttach(db: AdminClient, jobId: string, chatId: number, error: unknown) {
  console.error("attaching photos failed", error);
  const detail = error instanceof Error ? error.message : String(error);
  await db.from("ingest_jobs").update({ status: "failed", error: detail.slice(0, 1000) }).eq("id", jobId);
  await sendMessage(chatId, T.attachSaveError).catch(
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Knöpfe ausführen

export async function handleAttachCallback(cb: TgCallbackQuery) {
  const [, action, jobId] = (cb.data ?? "").split(":") as [string, AttachAction, string];
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (chatId == null || messageId == null) return answerCallback(cb.id);

  const db = createAdminClient();
  const { data: job, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("source", ATTACH_SOURCE)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  if (!job || job.status !== "needs_review") {
    await answerCallback(cb.id, T.alreadyDone);
    await editMessage(chatId, messageId, T.attachDone).catch(() => undefined);
    return;
  }
  const s = state(job);

  switch (action) {
    case "x": {
      const next = await advance(db, job, ["waiting", "side", "confirm"], { step: "done" }, { status: "discarded" });
      await answerCallback(cb.id);
      if (!next) return;
      await deleteJobPhotos(db, job.photo_paths);
      await editMessage(chatId, messageId, T.attachCancelled(s.title));
      return;
    }
    case "f":
    case "b": {
      if (s.step !== "side") return answerCallback(cb.id);
      await answerCallback(cb.id);
      await editMessage(chatId, messageId, `📷 ${action === "f" ? "Vorderseite" : "Rückseite"}.`);
      await decide(db, job, chatId, [action === "f" ? "label_front" : "label_back"]);
      return;
    }
    case "r": {
      const next = await advance(db, job, ["confirm"], { step: "saving" });
      await answerCallback(cb.id);
      if (!next) return;
      await editMessage(chatId, messageId, T.attachReplacing);
      await saveAttach(db, next, chatId, true);
      return;
    }
  }
}
