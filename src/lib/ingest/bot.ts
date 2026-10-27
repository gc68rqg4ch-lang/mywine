import "server-only";

import { after } from "next/server";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  answerCallback,
  clearKeyboard,
  downloadFile,
  escapeHtml,
  sendMessage,
} from "@/lib/telegram/api";
import { resolveActor, type Actor } from "@/lib/telegram/actor";
import type { GrapeShare } from "@/lib/grapes/shares";
import type { TgCallbackQuery, TgMessage, TgUpdate } from "@/lib/telegram/types";
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
  toJson,
  touchReceivedJob,
  type IngestJob,
} from "./jobs";
import {
  HELP_TEXT,
  parseCallbackData,
  parsePrice,
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
import { parseVintageAnswer, type IngestState, type StorageRoom, type WineProposal } from "./schema";
import { handleChatCallback, handleChatMessage, resetChat } from "@/lib/chat/handler";
import { isChatCallback } from "@/lib/chat/proposals";
import { handleMenuCallback, sendMainMenu } from "@/lib/chat/menu";
import {
  findTastingAwaitingText,
  handleTastingCallback,
  handleTastingText,
  isTastingCallback,
} from "@/lib/chat/tasting";
import { MAIN_KEYBOARD, isMenuCallback, menuKeyFor } from "@/lib/chat/menu-view";
import { findWine, mergeWithKnownWine, resolveVendor } from "./wines";
import { findAttachJob, handleAttachCallback, isAttachCallback, noteAttachPhoto } from "./attach";
import {
  acceptRestock,
  advanceTo,
  confirmAndSave,
  discardDescribe,
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
      await answerCallback(cb.id, `Ich kenne dich noch nicht – deine Telegram-ID ist ${from.id}.`);
      return;
    }
    await handleCallback(cb, actor);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  if (!actor) {
    // Unbekannte bekommen nur ihre ID (für die Freischaltung), sonst nichts – und nur im Einzelchat.
    if (msg.chat.type === "private") {
      await sendMessage(msg.chat.id, `Ich kenne dich noch nicht – deine Telegram-ID ist <code>${from.id}</code>.`);
    }
    return;
  }

  if (msg.photo?.length || msg.document) {
    await handlePhoto(msg);
  } else if (msg.text) {
    await handleText(msg, actor);
  }
}

// ---------------------------------------------------------------------------
// Fotos / Album

async function handlePhoto(msg: TgMessage) {
  const chatId = msg.chat.id;
  const file = pickImage(msg);
  if (!file) {
    await sendMessage(chatId, "Schick mir bitte Fotos (JPEG, PNG oder WebP, höchstens 5 MB).");
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
      await sendMessage(chatId, "Dieses Foto kam zu spät – ich ordne die Fotos schon zu.");
    }
    return;
  }

  // Statt einer Beschreibung kommen Fotos: die wartende Text-Erfassung verfällt.
  await discardDescribe(db, chatId);
  const jobId = jobIdFor(chatId, msg.media_group_id ?? `m${msg.message_id}`);
  await ensureJob(db, jobId, chatId);

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
    await sendMessage(
      chatId,
      "Dieses Foto kam zu spät – die Erkennung für das Album läuft schon. Schick bei Bedarf das ganze Album nochmals.",
    );
    return;
  }

  after(async () => {
    await sleep(ALBUM_QUIET_MS + 1000);
    await processJob(jobId, chatId);
  });
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

/** Erkennung eines vollständigen Albums – läuft nur im Request, der den Job beansprucht. */
async function processJob(jobId: string, chatId: number) {
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

    await sendMessage(
      chatId,
      `📷 ${photos.length === 1 ? "1 Foto" : `${photos.length} Fotos`} erhalten – ich erkenne den Wein …`,
    );

    const images = await loadImages(db, photos.map((p) => p.path));
    const recognition = await recognizeLabel(images);

    let proposal = recognition.proposal;
    let enriched: { filled: IngestState["recognition"]["enriched_fields"]; sources: string[] } = {
      filled: [],
      sources: [],
    };

    // Zuerst gegen bestehende Weine abgleichen; nur unbekannte Weine per Websuche ergänzen.
    // Rebsorten mit Prozent für den Jahrgang laufen parallel dazu.
    const known = await findWine(db, proposal.name, proposal.producer);
    if (known) proposal = mergeWithKnownWine(proposal, known);

    // Ein Durchgang für alles, was fehlt (Stammdaten, Trinkfenster, Rebsorten mit %) –
    // auch bei bekannten Weinen; Vorhandenes bleibt.
    const web = await enrichFromWeb(proposal).catch((error) => {
      console.error("web enrichment failed", error);
      return null;
    });
    if (web) {
      proposal = web.proposal;
      enriched = { filled: web.filled, sources: web.sources };
    }
    const grapes = await resolveGrapes(db, proposal, known?.id ?? null, web ? web.grapes : undefined);
    proposal = { ...proposal, grape_shares: grapes.shares };

    const state: IngestState = {
      step: "review",
      proposal,
      // Jahrgang nicht sicher gelesen → vor dem Speichern nachfragen.
      ...(proposal.vintage_year != null && !recognition.vintageCertain ? { vintage_uncertain: true } : {}),
      grape_source: grapes.source,
      drink_from_year: web?.drink.from ?? null,
      drink_until_year: web?.drink.until ?? null,
      recognition: {
        model: recognition.model,
        confidence: recognition.confidence,
        notes: recognition.notes,
        enriched_fields: enriched.filled,
        sources: [...enriched.sources, ...grapes.sources].slice(0, 8),
        ...(recognition.imageSides ? { image_sides: recognition.imageSides } : {}),
      },
    };

    const { error } = await db
      .from("ingest_jobs")
      .update({
        status: "needs_review",
        extracted: toJson(state),
        confidence: Math.round(recognition.confidence * 100) / 100,
        matched_wine_id: known?.id ?? null,
      })
      .eq("id", jobId);
    if (error) throw error;

    await sendMessage(chatId, proposalMessage(state, Boolean(known)), reviewKeyboard(jobId));
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
    await answerCallback(cb.id, "Diesen Eintrag habe ich schon abgeschlossen.");
    await clearKeyboard(chatId, messageId);
    return;
  }

  switch (parsed.action) {
    case "save": {
      if (!state.proposal.name || !state.proposal.producer) {
        await answerCallback(cb.id, "Mir fehlen Name und Produzent – bitte zuerst korrigieren.");
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
        "Was soll ich korrigieren? Antworte mit Freitext, z. B. <i>„Jahrgang 2019, Region Rioja, 14 %“</i>.",
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
          "producer",
          "vintage",
          "review",
          "correcting",
          "location",
          "quantity",
          "price",
          "regular_price",
          "vendor",
          "vendor_new",
          "confirm",
        ],
        { step: "done" },
        { status: "discarded" },
      );
      await answerCallback(cb.id, next ? "Verworfen" : undefined);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await deleteJobPhotos(db, job.photo_paths);
      await sendMessage(chatId, "🗑️ Verworfen – ich habe nichts gespeichert.");
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

    case "skipprice": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await advanceTo(db, job, chatId, "price", { price: null });
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
      await sendMessage(chatId, "Wie heisst der Händler?", skipVendorKeyboard(job.id));
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

    case "restock": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await acceptRestock(db, job, chatId);
      return;
    }

    case "confirm": {
      const ok = await confirmAndSave(db, job, chatId);
      await answerCallback(cb.id, ok ? "Ich speichere …" : undefined);
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

  // Feste Menüleiste unten geht immer vor (auch wenn ein Foto-Eintrag auf Text wartet).
  const menuKey = menuKeyFor(text);
  if (menuKey) {
    await sendMainMenu(chatId, menuKey);
    return;
  }
  if (/^\/(reset|vergessen)\b/i.test(text)) {
    await resetChat(chatId);
    return;
  }
  if (/^\/id\b/i.test(text)) {
    await sendMessage(chatId, `Deine Telegram-ID ist <code>${actor.telegramUserId}</code> (${escapeHtml(actor.name)}).`, MAIN_KEYBOARD);
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(chatId, `Hallo ${escapeHtml(actor.name)}!\n\n${HELP_TEXT}`, MAIN_KEYBOARD);
    return;
  }

  // Wartet eine Verkostung oder ein Foto-Eintrag auf eine Eingabe (Eindrücke, Anzahl,
  // Preis, …), geht der Text dorthin; sonst ist es eine Frage an den Chat-Modus.
  const db = createAdminClient();
  const tasting = await findTastingAwaitingText(db, chatId);
  if (tasting) {
    await handleTastingText(tasting.id, tasting.draft, chatId, text);
    return;
  }
  const job = await findJobAwaitingText(db, chatId);
  const state = job ? jobState(job) : null;
  if (!job || !state) {
    await handleChatMessage(chatId, text, actor);
    return;
  }

  switch (state.step) {
    case "describe": {
      await startTextIngest(chatId, text, job.id);
      return;
    }
    case "vintage": {
      const year = parseVintageAnswer(text);
      if (year === undefined) {
        await sendMessage(chatId, "Schreib mir bitte nur die Jahreszahl (z. B. <i>2019</i>) – oder tippe „Ohne Jahrgang (NV)“.");
        return;
      }
      await setVintage(db, job, chatId, year);
      return;
    }
    case "producer": {
      const producer = text.replace(/\s+/g, " ").trim();
      if (producer.length < 2 || producer.length > 120) {
        await sendMessage(chatId, "Schreib mir bitte den Namen des Produzenten.");
        return;
      }
      await setProducer(db, job, chatId, producer);
      return;
    }
    case "correcting": {
      await sendMessage(chatId, "✏️ Ich übernehme die Korrektur …");
      after(() => correctJob(job, state, chatId, text));
      return;
    }
    case "quantity": {
      const quantity = parseQuantity(text);
      if (!quantity) {
        await sendMessage(chatId, "Schreib mir bitte eine Anzahl zwischen 1 und 999.");
        return;
      }
      await advanceTo(db, job, chatId, "quantity", { quantity });
      return;
    }
    case "price": {
      const price = parsePrice(text);
      if (price == null) {
        await sendMessage(chatId, "Schreib mir bitte einen Preis wie <i>24.50</i> – oder tippe „Überspringen“.");
        return;
      }
      await advanceTo(db, job, chatId, "price", { price });
      return;
    }
    case "regular_price": {
      const regularPrice = parsePrice(text);
      if (regularPrice == null) {
        await sendMessage(chatId, "Schreib mir bitte einen Preis wie <i>29.90</i> – oder tippe einen Knopf.");
        return;
      }
      await advanceTo(db, job, chatId, "regular_price", { regular_price: regularPrice });
      return;
    }
    case "vendor":
    case "vendor_new": {
      const name = text.replace(/\s+/g, " ").trim();
      if (name.length < 2 || name.length > 80) {
        await sendMessage(chatId, "Schreib mir bitte den Namen des Händlers (2–80 Zeichen) – oder tippe „Überspringen“.");
        return;
      }
      const vendor = await resolveVendor(db, name);
      await advanceTo(db, job, chatId, ["vendor", "vendor_new"], { vendor_id: vendor.id, vendor_name: vendor.name });
      return;
    }
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
    await sendMessage(chatId, "Das konnte ich nicht übernehmen. Formulier die Korrektur bitte nochmals.");
  }
}
