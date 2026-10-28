import "server-only";

import { later } from "@/lib/later";
import { cleanGiftFrom } from "./gift";
import { isZeroAmount, parseAmount } from "@/lib/format";
import { findDocumentAwaitingText, handleDocument, handleDocumentCallback, handleDocumentSearch, isDocumentCallback, isPdfDocument } from "./document";
import { after } from "next/server";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  answerCallback,
  clearKeyboard,
  downloadFile,
  sendMessage,
} from "@/lib/telegram/api";
import { resolveActor, type Actor } from "@/lib/telegram/actor";
import type { GrapeShare } from "@/lib/grapes/shares";
import type { TgCallbackQuery, TgMessage, TgUpdate } from "@/lib/telegram/types";
import type { Json } from "@/lib/database.types";
import { T } from "@/lib/bot/texts";
import {
  ALBUM_QUIET_MS,
  PHOTO_BUCKET,
  advanceJob,
  claimJob,
  deleteJobPhotos,
  ensureJob,
  findJobAwaitingText,
  jobIdFor,
  jobState,
  listJobPhotos,
  loadJob,
  photoFolder,
  touchReceivedJob,
  type IngestJob,
} from "./jobs";
import {
  HELP_TEXT,
  cancelKeyboard,
  giftValueKeyboard,
  priceKeyboard,
  regularPriceKeyboard,
  parseCallbackData,
  parseQuantity,
  skipVendorKeyboard,
  proposalMessage,
  reviewKeyboard,
} from "./messages";
import {
  applyCorrection,
  enrichFromWeb,
  recognizeLabel,
  type LabelImage,
} from "./recognize";
import { tastedIntent } from "@/lib/chat/tasted-text";
import {
  cancelAll,
  expireStale,
  looksLikeNewConcern,
  menuVersionSeen,
  rememberMenuVersion,
  strongNewConcern,
  supersede,
  touchFlow,
} from "@/lib/chat/pending";
import {
  armedForTasting,
  askPhotoIntent,
  askTextIntent,
  startTastedText,
  findTastedAwaitingText,
  handleTastedCallback,
  handleTastedText,
  isTastedCallback,
  maybeArmTasting,
  startTastedFromPhoto,
  tastedAnswerFit,
} from "@/lib/chat/tasted";
import { parseVintageAnswer, type IngestState, type StorageRoom, type WineProposal } from "./schema";
import { handleChatCallback, handleChatMessage, resetChat } from "@/lib/chat/handler";
import { isChatCallback } from "@/lib/chat/proposals";
import { handleResearchCallback, isResearchCallback } from "@/lib/chat/research";
import { handleMenuCallback, sendMainMenu } from "@/lib/chat/menu";
import {
  findTastingAwaitingText,
  handleTastingCallback,
  handleTastingText,
  isTastingCallback,
} from "@/lib/chat/tasting";
import { MAIN_KEYBOARD, MENU_VERSION, isMenuCallback, menuKeyFor } from "@/lib/chat/menu-view";
import { findWine, mergeWithKnownWine, resolveVendor } from "./wines";
import { findAttachJob, handleAttachCallback, isAttachCallback, noteAttachPhoto } from "./attach";
import {
  acceptRestock,
  chooseSimilar,
  advanceTo,
  confirmAndSave,
  continuePhotoPurchase,
  giftPatch,
  failJob,
  resolveGrapes,
  setProducer,
  setVintage,
  startTextIngest,
} from "./flow";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Grenze der Claude API pro Bild
const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Einstieg für jedes Telegram-Update. Lange Arbeit läuft per after() nach der Antwort. */
export async function handleUpdate(update: TgUpdate) {
  const from = update.callback_query?.from ?? update.message?.from;
  if (!from || from.is_bot) return;
  const actor = await resolveActor(createAdminClient(), from.id);

  if (update.callback_query) {
    const cb = update.callback_query;
    if (!actor) {
      await answerCallback(cb.id, T.unknownUserToast(from.id));
      return;
    }
    if (cb.message) await preflight(cb.message.chat.id);
    await handleCallback(cb, actor);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  if (!actor) {
    // Unbekannte bekommen nur ihre ID (für die Freischaltung), sonst nichts – und nur im Einzelchat.
    if (msg.chat.type === "private") {
      await sendMessage(msg.chat.id, T.unknownUser(from.id));
    }
    return;
  }
  await preflight(msg.chat.id);

  if (isPdfDocument(msg.document)) {
    await handleDocument(msg);
  } else if (msg.photo?.length || msg.document) {
    await handlePhoto(msg);
  } else if (msg.text) {
    await handleText(msg, actor);
  }
}

/**
 * Vor jeder Nachricht und jedem Knopf: Rückfragen ohne Antwort seit 10 Minuten verwerfen
 * (mit kurzer Meldung) und eine neue Menüleiste einmal mitschicken.
 */
async function preflight(chatId: number) {
  const db = createAdminClient();
  try {
    await expireStale(db, chatId);
    const seen = await menuVersionSeen(db, chatId);
    if (seen.version < MENU_VERSION) {
      await sendMessage(chatId, T.newMenu, MAIN_KEYBOARD);
      await rememberMenuVersion(db, chatId, MENU_VERSION, seen.id);
    }
  } catch (error) {
    // Nie die eigentliche Nachricht blockieren.
    console.error("bot preflight failed", error);
  }
}

// ---------------------------------------------------------------------------
// Fotos / Album

async function handlePhoto(msg: TgMessage) {
  const chatId = msg.chat.id;
  const file = pickImage(msg);
  if (!file) {
    // Andere Dateien als Fotos und PDFs: freundlich ablehnen.
    const isImage = msg.document?.mime_type?.startsWith("image/");
    await sendMessage(chatId, msg.document && !isImage ? T.docOnlyPdf : T.photoOnly);
    return;
  }

  const db = createAdminClient();

  // „📷 Foto“ im Wein-Menü wartet: die Fotos gehören zu diesem Wein, keine neue Erfassung.
  const attach = await findAttachJob(db, chatId);
  if (attach) {
    const { bytes, filePath } = await downloadFile(file.fileId);
    const ext = extensionOf(filePath) ?? "jpg";
    const { error } = await db.storage
      .from(PHOTO_BUCKET)
      .upload(`${photoFolder(attach.id)}/${msg.message_id}.${ext}`, bytes, { contentType: IMAGE_TYPES[ext], upsert: true });
    if (error) throw error;
    if (!(await noteAttachPhoto(db, attach.id, chatId))) {
      await sendMessage(chatId, T.photoTooLateAttach);
    }
    return;
  }

  // Neues Foto = neues Anliegen: angefangene Rückfragen (auch „Neuer Wein“) werden verworfen –
  // ausser dem eigenen Album (weitere Fotos davon).
  const jobId = jobIdFor(chatId, msg.media_group_id ?? `m${msg.message_id}`);
  await supersede(db, chatId, "photo", [jobId]);
  await ensureJob(db, jobId, chatId);
  await noteIntent(db, jobId, chatId, msg.caption);

  // Foto sofort sichern; die Erkennung startet erst, wenn das Album vollständig ist.
  const { bytes, filePath } = await downloadFile(file.fileId);
  const ext = extensionOf(filePath) ?? "jpg";
  const { error: uploadError } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(`${photoFolder(jobId)}/${msg.message_id}.${ext}`, bytes, {
      contentType: IMAGE_TYPES[ext],
      upsert: true,
    });
  if (uploadError) throw uploadError;

  if (!(await touchReceivedJob(db, jobId))) {
    await sendMessage(chatId, T.photoTooLate);
    return;
  }

  // Nach der Antwort (after); ausserhalb einer Anfrage (Tests) über runLater().
  later(async () => {
    await sleep(ALBUM_QUIET_MS + 1000);
    await processJob(jobId, chatId);
  });
}

/**
 * Bildtext („im Restaurant probiert“) bzw. eine Ankündigung („wir verkosten einen Wein“)
 * am Album vermerken – entscheidet nach der Erkennung über gekauft oder verkostet.
 */
async function noteIntent(db: AdminClient, jobId: string, chatId: number, caption: string | undefined) {
  const armed = await armedForTasting(db, chatId);
  if (!caption?.trim() && !armed) return;
  const { data } = await db.from("ingest_jobs").select("extracted").eq("id", jobId).maybeSingle();
  const before = (data?.extracted ?? {}) as Partial<IngestState>;
  const note = {
    ...before,
    step: "received",
    ...(caption?.trim() ? { caption: caption.trim().slice(0, 500) } : {}),
    ...(armed ? { intent: "tasted" } : {}),
  };
  await db.from("ingest_jobs").update({ extracted: note as Json }).eq("id", jobId).eq("status", "received");
}

function pickImage(msg: TgMessage) {
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return { fileId: largest.file_id };
  }
  const doc = msg.document;
  const isImage = doc?.mime_type && Object.values(IMAGE_TYPES).includes(doc.mime_type as never);
  if (doc && isImage && (doc.file_size ?? 0) <= MAX_IMAGE_BYTES) return { fileId: doc.file_id };
  return null;
}

function extensionOf(path: string): keyof typeof IMAGE_TYPES | null {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext && ext in IMAGE_TYPES ? (ext as keyof typeof IMAGE_TYPES) : null;
}

/** Erkennung eines vollständigen Albums – läuft nur im Request, der den Job beansprucht (exportiert für Tests). */
export async function processJob(jobId: string, chatId: number) {
  const db = createAdminClient();
  const job = await claimJob(db, jobId);
  if (!job) return;

  try {
    const photos = await listJobPhotos(db, jobId);
    if (photos.length === 0) throw new Error("Keine Fotos gefunden.");

    await db
      .from("ingest_jobs")
      .update({
        photo_paths: photos.map((p) => p.path),
        telegram_message_ids: photos.map((p) => p.messageId),
      })
      .eq("id", jobId);

    await sendMessage(chatId, T.photosReceived(photos.length));

    const images = await loadImages(db, photos.map((p) => p.path));
    const recognition = await recognizeLabel(images);

    // Gekauft oder nur verkostet? Bildtext bzw. „wir verkosten einen Wein“ vorher entscheidet;
    // sonst zuerst fragen – nie ungefragt einbuchen.
    const before = jobState(job);
    const intent = before?.intent ?? tastedIntent(before?.caption);
    if (intent === "tasted") {
      await startTastedFromPhoto(db, jobId, chatId, recognition, before?.caption);
      return;
    }
    if (intent == null) {
      await askPhotoIntent(db, jobId, chatId, recognition, before?.caption);
      return;
    }
    await continuePhotoPurchase(db, jobId, chatId, recognition, before?.caption);
  } catch (error) {
    await failJob(db, jobId, chatId, "Die Erkennung ist fehlgeschlagen", error);
  }
}

async function loadImages(db: AdminClient, paths: string[]): Promise<LabelImage[]> {
  return Promise.all(
    paths.map(async (path) => {
      const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
      if (error) throw error;
      const ext = extensionOf(path) ?? "jpg";
      return {
        mediaType: IMAGE_TYPES[ext],
        base64: Buffer.from(await data.arrayBuffer()).toString("base64"),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Buttons

async function handleCallback(cb: TgCallbackQuery, actor: Actor) {
  if (isResearchCallback(cb.data)) {
    await handleResearchCallback(cb, actor);
    return;
  }
  if (isTastedCallback(cb.data)) {
    await handleTastedCallback(cb);
    return;
  }
  if (isDocumentCallback(cb.data)) {
    await handleDocumentCallback(cb);
    return;
  }
  if (isAttachCallback(cb.data)) {
    await handleAttachCallback(cb);
    return;
  }
  if (isTastingCallback(cb.data)) {
    await handleTastingCallback(cb);
    return;
  }
  if (isMenuCallback(cb.data)) {
    await handleMenuCallback(cb, actor);
    return;
  }
  if (isChatCallback(cb.data)) {
    await handleChatCallback(cb);
    return;
  }
  const parsed = parseCallbackData(cb.data);
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (!parsed || chatId == null || messageId == null) {
    await answerCallback(cb.id);
    return;
  }

  const db = createAdminClient();
  const job = await loadJob(db, parsed.jobId, chatId);
  const state = job ? jobState(job) : null;
  if (!job || !state || job.status !== "needs_review") {
    await answerCallback(cb.id, T.alreadyDone);
    await clearKeyboard(chatId, messageId);
    return;
  }

  switch (parsed.action) {
    case "save": {
      // Pflicht ist nur der Name; ein fehlender Produzent wird später ergänzt bzw. recherchiert.
      if (!state.proposal.name) {
        await answerCallback(cb.id, T.missingName);
        return;
      }
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "review", {});
      return;
    }

    case "fix": {
      const next = await advanceJob(db, job, "review", { step: "correcting" });
      await answerCallback(cb.id);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await sendMessage(
        chatId,
        T.whatToFix,
        cancelKeyboard(job.id),
      );
      return;
    }

    case "drop": {
      const next = await advanceJob(
        db,
        job,
        [
          "describe",
          "restock",
          "similar",
          "producer",
          "vintage",
          "review",
          "correcting",
          "location",
          "quantity",
          "price",
          "gift_from",
          "regular_price",
          "vendor",
          "vendor_new",
          "confirm",
        ],
        { step: "done" },
        { status: "discarded" },
      );
      await answerCallback(cb.id);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await deleteJobPhotos(db, job.photo_paths);
      await sendMessage(chatId, T.dropped());
      return;
    }

    case "loc": {
      const room: StorageRoom | null =
        parsed.value === "keller" ? "Weinkeller" : parsed.value === "wohnzimmer" ? "Wohnzimmer" : null;
      if (!room) return answerCallback(cb.id);
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "location", { storage_room: room });
      return;
    }

    case "qty": {
      const quantity = parseQuantity(parsed.value ?? "");
      if (!quantity) return answerCallback(cb.id);
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "quantity", { quantity });
      return;
    }

    case "qtyother": {
      // „✏️ Andere Zahl“: um die Zahl als Text bitten (die Antwort nimmt der Schritt „quantity“ an).
      await answerCallback(cb.id);
      if (state.step !== "quantity") return;
      await clearKeyboard(chatId, messageId);
      await touchFlow(db, job.id);
      await sendMessage(chatId, T.quantityOther(), cancelKeyboard(job.id));
      return;
    }

    case "skipprice": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "price", { price: null });
      return;
    }

    case "gift": {
      // „🎁 Geschenk“ bei der Preisfrage: Preis 0, danach „Von wem?“ (kein Normalpreis, kein Händler).
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "price", giftPatch(undefined));
      return;
    }

    case "skipgift": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "gift_from", { gift_from: null });
      return;
    }

    case "sameprice": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "regular_price", { regular_price: state.price ?? null });
      return;
    }

    case "skipregular": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "regular_price", { regular_price: null });
      return;
    }

    case "vendor": {
      const index = Number(parsed.value);
      const vendorId = Number.isInteger(index) ? state.vendor_options?.[index] : undefined;
      await answerCallback(cb.id);
      if (!vendorId) return;
      const { data: vendor } = await db.from("vendors").select("id, name").eq("id", vendorId).maybeSingle();
      if (!vendor) return;
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, ["vendor", "vendor_new"], { vendor_id: vendor.id, vendor_name: vendor.name });
      return;
    }

    case "newvendor": {
      const next = await advanceJob(db, job, "vendor", { step: "vendor_new" });
      await answerCallback(cb.id);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await sendMessage(chatId, T.vendorName, skipVendorKeyboard(job.id));
      return;
    }

    case "skipvendor": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, ["vendor", "vendor_new"], { vendor_id: null, vendor_name: null });
      return;
    }

    case "vint": {
      const year = parsed.value === "nv" ? null : Number(parsed.value);
      if (year !== null && !(Number.isInteger(year) && year >= 1800 && year <= 2100)) return answerCallback(cb.id);
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await setVintage(db, job, chatId, year);
      return;
    }

    case "simyes":
    case "simno": {
      const index = parsed.action === "simyes" ? Number(parsed.value) : null;
      if (index != null && !Number.isInteger(index)) return answerCallback(cb.id);
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await chooseSimilar(db, job, chatId, index);
      return;
    }

    case "restock": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await acceptRestock(db, job, chatId);
      return;
    }

    case "confirm": {
      const ok = await confirmAndSave(db, job, chatId);
      await answerCallback(cb.id, ok ? T.savingToast : undefined);
      if (ok) await clearKeyboard(chatId, messageId);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Textantworten (Korrektur, Anzahl, Preise)

async function handleText(msg: TgMessage, actor: Actor) {
  const chatId = msg.chat.id;
  const text = msg.text!.trim();
  const db = createAdminClient();

  // Feste Menüleiste unten und Befehle gehen immer vor – ein neues Anliegen verwirft
  // angefangene Rückfragen.
  const menuKey = menuKeyFor(text);
  if (menuKey) {
    await supersede(db, chatId, "menu");
    await sendMainMenu(chatId, menuKey);
    return;
  }
  if (/^\/abbrechen\b/i.test(text)) {
    const labels = await cancelAll(db, chatId);
    await sendMessage(
      chatId,
      T.cancelledList(labels),
      MAIN_KEYBOARD,
    );
    return;
  }
  if (text.startsWith("/")) await supersede(db, chatId, "command");
  if (/^\/(reset|vergessen)\b/i.test(text)) {
    await resetChat(chatId);
    return;
  }
  if (/^\/id\b/i.test(text)) {
    await sendMessage(chatId, T.yourId(actor.telegramUserId, actor.name), MAIN_KEYBOARD);
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, T.hello(actor.name, HELP_TEXT), MAIN_KEYBOARD);
    return;
  }

  // „🔎 Anderen Wein suchen“ für ein PDF: der Text ist der Weinname.
  const docSearch = await findDocumentAwaitingText(db, chatId);
  if (docSearch) {
    await handleDocumentSearch(db, docSearch, chatId, text);
    return;
  }

  // Wartet eine Verkostung oder ein Foto-Eintrag auf eine Eingabe (Eindrücke, Anzahl,
  // Preis, …), geht der Text dorthin – passt er nicht und sieht nach einem neuen Anliegen
  // aus, wird der alte Ablauf verworfen und der Text normal verarbeitet.
  const tasting = await findTastingAwaitingText(db, chatId);
  if (tasting) {
    await touchFlow(db, tasting.id);
    await handleTastingText(tasting.id, tasting.draft, chatId, text);
    return;
  }
  const tasted = await findTastedAwaitingText(db, chatId);
  if (tasted) {
    if (tastedAnswerFit(tasted, text) !== "new") {
      await touchFlow(db, tasted.id);
      await handleTastedText(db, tasted, chatId, text);
      return;
    }
    await supersede(db, chatId, "text");
  }
  const job = await findJobAwaitingText(db, chatId);
  const state = job ? jobState(job) : null;
  if (job && state && purchaseAnswerFit(state.step, text) === "new") await supersede(db, chatId, "text");
  if (!job || !state || purchaseAnswerFit(state.step, text) === "new") {
    if (await maybeArmTasting(db, chatId, text)) return;
    await handleChatMessage(chatId, text, actor);
    return;
  }
  await touchFlow(db, job.id);

  switch (state.step) {
    case "describe": {
      // Gekauft oder nur verkostet? Ohne klaren Hinweis zuerst fragen.
      const intent = tastedIntent(text);
      if (intent === "bought") {
        await startTextIngest(chatId, text, job.id);
        return;
      }
      await db.from("ingest_jobs").update({ status: "discarded" }).eq("id", job.id);
      if (intent === "tasted") await startTastedText(chatId, text);
      else await askTextIntent(db, chatId, text);
      return;
    }
    case "vintage": {
      const year = parseVintageAnswer(text);
      if (year === undefined) {
        await sendMessage(chatId, T.vintageRetry, cancelKeyboard(job.id));
        return;
      }
      await setVintage(db, job, chatId, year);
      return;
    }
    case "producer": {
      const producer = text.replace(/\s+/g, " ").trim();
      if (producer.length < 2 || producer.length > 120) {
        await sendMessage(chatId, T.producerRetry, cancelKeyboard(job.id));
        return;
      }
      await setProducer(db, job, chatId, producer);
      return;
    }
    case "correcting": {
      await sendMessage(chatId, T.fixing);
      after(() => correctJob(job, state, chatId, text));
      return;
    }
    case "quantity": {
      const quantity = parseQuantity(text);
      if (!quantity) {
        await sendMessage(chatId, T.quantityRetry(), cancelKeyboard(job.id));
        return;
      }
      await advanceTo(db, job, chatId, "quantity", { quantity });
      return;
    }
    case "price": {
      // Strenge Prüfung (Betrag über 0); „0“ → Hinweis auf „🎁 Geschenk“ (Knöpfe bleiben).
      const price = parseAmount(text);
      if (price == null) {
        await sendMessage(chatId, isZeroAmount(text) ? T.priceZero() : T.priceRetry, priceKeyboard(job.id));
        return;
      }
      await advanceTo(db, job, chatId, "price", { price });
      return;
    }
    case "gift_from": {
      // Von wem? Freitext, getrimmt; leer → unbekannt.
      await advanceTo(db, job, chatId, "gift_from", { gift_from: cleanGiftFrom(text) });
      return;
    }
    case "regular_price": {
      // Geschenk: Wert pro Flasche – nur Beträge über 0; „🤷 Weiss ich nicht“ bleibt als Knopf.
      const regularPrice = parseAmount(text);
      if (regularPrice == null) {
        if (state.is_gift) await sendMessage(chatId, T.giftValueRetry(), giftValueKeyboard(job.id));
        else await sendMessage(chatId, T.regularPriceRetry, regularPriceKeyboard(job.id, state.price ?? null));
        return;
      }
      await advanceTo(db, job, chatId, "regular_price", { regular_price: regularPrice });
      return;
    }
    case "vendor":
    case "vendor_new": {
      const name = text.replace(/\s+/g, " ").trim();
      if (name.length < 2 || name.length > 80) {
        await sendMessage(chatId, T.vendorRetry, cancelKeyboard(job.id));
        return;
      }
      const vendor = await resolveVendor(db, name);
      await advanceTo(db, job, chatId, ["vendor", "vendor_new"], { vendor_id: vendor.id, vendor_name: vendor.name });
      return;
    }
  }
}

/**
 * Passt der Text als Antwort auf die offene Rückfrage der Erfassung? „new“ = neues Anliegen
 * (alter Ablauf wird verworfen), „answer“ = Antwort (bzw. erneute Rückfrage bei Unklarem).
 */
export function purchaseAnswerFit(step: IngestState["step"], text: string): "answer" | "new" {
  switch (step) {
    case "describe":
    case "correcting":
      return "answer";
    case "producer":
    case "vendor":
    case "vendor_new":
    case "gift_from":
      return strongNewConcern(text) ? "new" : "answer";
    case "vintage":
      return parseVintageAnswer(text) !== undefined ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
    case "quantity":
      return !strongNewConcern(text) && parseQuantity(text) ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
    case "price":
    case "regular_price":
      return !strongNewConcern(text) && parseAmount(text) != null ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
    default:
      return "answer";
  }
}

async function correctJob(job: IngestJob, state: IngestState, chatId: number, correction: string) {
  const db = createAdminClient();
  try {
    let proposal: WineProposal = await applyCorrection(state.proposal, correction);
    let enriched = state.recognition;
    let grapeSource = state.grape_source ?? null;
    const grapesCorrected =
      JSON.stringify(proposal.grape_shares) !== JSON.stringify(state.proposal.grape_shares);
    if (grapesCorrected) grapeSource = "manual";
    const otherWine =
      proposal.name !== state.proposal.name || proposal.producer !== state.proposal.producer;

    const known = await findWine(db, proposal.name, proposal.producer);
    let researchedGrapes: { shares: GrapeShare[]; sources: string[] } | null | undefined;
    // Trinkfenster gehört zum Wein und Jahrgang: bei einem anderen neu bestimmen.
    let drink = { from: state.drink_from_year ?? null, until: state.drink_until_year ?? null };
    if (otherWine || proposal.vintage_year !== state.proposal.vintage_year) drink = { from: null, until: null };
    if (known) {
      proposal = mergeWithKnownWine(proposal, known);
    } else if (otherWine) {
      // Anderer Wein als zuvor: fehlende Angaben nochmals per Websuche ergänzen.
      const web = await enrichFromWeb(proposal).catch(() => null);
      if (web) {
        proposal = web.proposal;
        enriched = { ...enriched, enriched_fields: web.filled, sources: web.sources };
        drink = web.drink;
        researchedGrapes = web.grapes;
      }
    }

    // Anderer Wein oder Jahrgang ohne eigene Rebsorten-Korrektur: Rebsorten neu bestimmen.
    if (!grapesCorrected && (otherWine || proposal.vintage_year !== state.proposal.vintage_year)) {
      // Rebsorten vom Etikett bleiben gültig, recherchierte gehörten zum alten Wein.
      const labelGrapes = state.grape_source === "label" ? proposal.grape_shares : [];
      const grapes = await resolveGrapes(db, { ...proposal, grape_shares: labelGrapes }, known?.id ?? null, researchedGrapes);
      proposal = { ...proposal, grape_shares: grapes.shares };
      grapeSource = grapes.source;
    }

    const next = await advanceJob(
      db,
      job,
      "correcting",
      {
        step: "review",
        proposal,
        recognition: enriched,
        grape_source: grapeSource,
        drink_from_year: drink.from,
        drink_until_year: drink.until,
        // Jahrgang in der Korrektur genannt: gilt als bestätigt.
        ...(proposal.vintage_year != null && proposal.vintage_year !== state.proposal.vintage_year
          ? { vintage_confirmed: true, vintage_uncertain: false }
          : {}),
      },
      { matched_wine_id: known?.id ?? null },
    );
    if (!next) return;
    await sendMessage(chatId, proposalMessage(jobState(next)!, Boolean(known)), reviewKeyboard(job.id));
  } catch (error) {
    console.error("correction failed", error);
    // Der Job bleibt im Korrekturmodus – die nächste Textantwort ist ein neuer Versuch.
    await sendMessage(chatId, T.fixFailed);
  }
}
