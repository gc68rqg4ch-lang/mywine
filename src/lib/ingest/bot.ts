import "server-only";

import { after } from "next/server";
import { formatBottles, formatMoney, wineTitle } from "@/lib/format";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  answerCallback,
  clearKeyboard,
  downloadFile,
  escapeHtml,
  sendMessage,
} from "@/lib/telegram/api";
import { appBaseUrl, telegramConfig } from "@/lib/telegram/config";
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
  locationKeyboard,
  parseCallbackData,
  parsePrice,
  parseQuantity,
  priceKeyboard,
  regularPriceKeyboard,
  proposalMessage,
  quantityKeyboard,
  reviewKeyboard,
} from "./messages";
import {
  applyCorrection,
  enrichFromWeb,
  recognizeLabel,
  type LabelImage,
} from "./recognize";
import type { IngestState, StorageRoom, WineProposal } from "./schema";
import { createInventoryItem, findWine, mergeWithKnownWine, resolveWine } from "./wines";

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
  const { allowedUserId } = telegramConfig();

  if (update.callback_query) {
    const cb = update.callback_query;
    if (cb.from.id !== allowedUserId) return;
    await handleCallback(cb);
    return;
  }

  const msg = update.message;
  if (!msg || msg.from?.id !== allowedUserId) return;

  if (msg.photo?.length || msg.document) {
    await handlePhoto(msg);
  } else if (msg.text) {
    await handleText(msg);
  }
}

// ---------------------------------------------------------------------------
// Fotos / Album

async function handlePhoto(msg: TgMessage) {
  const chatId = msg.chat.id;
  const file = pickImage(msg);
  if (!file) {
    await sendMessage(chatId, "Bitte schick Fotos (JPEG, PNG oder WebP, max. 5 MB).");
    return;
  }

  const db = createAdminClient();
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
    const known = await findWine(db, proposal.name, proposal.producer);
    if (known) {
      proposal = mergeWithKnownWine(proposal, known);
    } else {
      const web = await enrichFromWeb(proposal).catch((error) => {
        console.error("web enrichment failed", error);
        return null;
      });
      if (web) {
        proposal = web.proposal;
        enriched = { filled: web.filled, sources: web.sources };
      }
    }

    const state: IngestState = {
      step: "review",
      proposal,
      recognition: {
        model: recognition.model,
        confidence: recognition.confidence,
        notes: recognition.notes,
        enriched_fields: enriched.filled,
        sources: enriched.sources,
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

async function handleCallback(cb: TgCallbackQuery) {
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
    await answerCallback(cb.id, "Dieser Eintrag ist abgeschlossen.");
    await clearKeyboard(chatId, messageId);
    return;
  }

  switch (parsed.action) {
    case "save": {
      if (!state.proposal.name || !state.proposal.producer) {
        await answerCallback(cb.id, "Name und Produzent fehlen – bitte zuerst korrigieren.");
        return;
      }
      const next = await advanceJob(db, job, "review", { step: "location" });
      await answerCallback(cb.id);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await sendMessage(chatId, "Wo lagerst du die Flaschen?", locationKeyboard(job.id));
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
        ["review", "correcting", "location", "quantity", "price", "regular_price"],
        { step: "done" },
        { status: "discarded" },
      );
      await answerCallback(cb.id, next ? "Verworfen" : undefined);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await deleteJobPhotos(db, job.photo_paths);
      await sendMessage(chatId, "🗑️ Verworfen.");
      return;
    }

    case "loc": {
      const room: StorageRoom | null =
        parsed.value === "keller" ? "Weinkeller" : parsed.value === "wohnzimmer" ? "Wohnzimmer" : null;
      if (!room) return answerCallback(cb.id);
      const next = await advanceJob(db, job, "location", { step: "quantity", storage_room: room });
      await answerCallback(cb.id);
      if (!next) return;
      await clearKeyboard(chatId, messageId);
      await sendMessage(
        chatId,
        `📍 ${room}. Wie viele Flaschen? (Button oder Zahl schreiben)`,
        quantityKeyboard(job.id),
      );
      return;
    }

    case "qty": {
      const quantity = parseQuantity(parsed.value ?? "");
      if (!quantity) return answerCallback(cb.id);
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await setQuantity(db, job, chatId, quantity);
      return;
    }

    case "skipprice": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await setPaidPrice(db, job, chatId, null);
      return;
    }

    case "sameprice": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await setRegularPriceAndSave(db, job, chatId, state.price ?? null);
      return;
    }

    case "skipregular": {
      await answerCallback(cb.id);
      await clearKeyboard(chatId, messageId);
      await setRegularPriceAndSave(db, job, chatId, null);
      return;
    }
  }
}

async function setQuantity(db: AdminClient, job: IngestJob, chatId: number, quantity: number) {
  const next = await advanceJob(db, job, "quantity", { step: "price", quantity });
  if (!next) return;
  await sendMessage(
    chatId,
    `${formatBottles(quantity)}. Was hast du bezahlt? (CHF pro Flasche)`,
    priceKeyboard(job.id),
  );
}

async function setPaidPrice(db: AdminClient, job: IngestJob, chatId: number, price: number | null) {
  const next = await advanceJob(db, job, "price", { step: "regular_price", price });
  if (!next) return;
  await sendMessage(
    chatId,
    "Normalpreis? (oder überspringen)",
    regularPriceKeyboard(job.id, price),
  );
}

async function setRegularPriceAndSave(
  db: AdminClient,
  job: IngestJob,
  chatId: number,
  regularPrice: number | null,
) {
  const saving = await advanceJob(db, job, "regular_price", {
    step: "saving",
    regular_price: regularPrice,
  });
  if (!saving) return;
  after(() => saveJob(saving, chatId));
}

// ---------------------------------------------------------------------------
// Textantworten (Korrektur, Anzahl, Preise)

async function handleText(msg: TgMessage) {
  const chatId = msg.chat.id;
  const text = msg.text!.trim();

  if (text.startsWith("/")) {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  const db = createAdminClient();
  const job = await findJobAwaitingText(db, chatId);
  const state = job ? jobState(job) : null;
  if (!job || !state) {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  switch (state.step) {
    case "correcting": {
      await sendMessage(chatId, "✏️ Übernehme die Korrektur …");
      after(() => correctJob(job, state, chatId, text));
      return;
    }
    case "quantity": {
      const quantity = parseQuantity(text);
      if (!quantity) {
        await sendMessage(chatId, "Bitte eine Anzahl zwischen 1 und 999 schreiben.");
        return;
      }
      await setQuantity(db, job, chatId, quantity);
      return;
    }
    case "price": {
      const price = parsePrice(text);
      if (price == null) {
        await sendMessage(chatId, "Bitte einen Preis wie <i>24.50</i> schreiben oder „Überspringen“ tippen.");
        return;
      }
      await setPaidPrice(db, job, chatId, price);
      return;
    }
    case "regular_price": {
      const regularPrice = parsePrice(text);
      if (regularPrice == null) {
        await sendMessage(chatId, "Bitte einen Preis wie <i>29.90</i> schreiben oder einen Button tippen.");
        return;
      }
      await setRegularPriceAndSave(db, job, chatId, regularPrice);
      return;
    }
  }
}

async function correctJob(job: IngestJob, state: IngestState, chatId: number, correction: string) {
  const db = createAdminClient();
  try {
    let proposal: WineProposal = await applyCorrection(state.proposal, correction);
    let enriched = state.recognition;

    const known = await findWine(db, proposal.name, proposal.producer);
    if (known) {
      proposal = mergeWithKnownWine(proposal, known);
    } else if (
      proposal.name !== state.proposal.name ||
      proposal.producer !== state.proposal.producer
    ) {
      // Anderer Wein als zuvor: fehlende Angaben nochmals per Websuche ergänzen.
      const web = await enrichFromWeb(proposal).catch(() => null);
      if (web) {
        proposal = web.proposal;
        enriched = { ...enriched, enriched_fields: web.filled, sources: web.sources };
      }
    }

    const next = await advanceJob(
      db,
      job,
      "correcting",
      { step: "review", proposal, recognition: enriched },
      { matched_wine_id: known?.id ?? null },
    );
    if (!next) return;
    await sendMessage(chatId, proposalMessage(jobState(next)!, Boolean(known)), reviewKeyboard(job.id));
  } catch (error) {
    console.error("correction failed", error);
    // Der Job bleibt im Korrekturmodus – die nächste Textantwort ist ein neuer Versuch.
    await sendMessage(chatId, "Das konnte ich nicht übernehmen. Bitte formuliere die Korrektur nochmals.");
  }
}

// ---------------------------------------------------------------------------
// Speichern

async function saveJob(job: IngestJob, chatId: number) {
  const db = createAdminClient();
  const state = jobState(job)!;
  try {
    const wineId = await resolveWine(db, state.proposal, job.matched_wine_id);
    const itemId = await createInventoryItem(db, {
      wineId,
      proposal: state.proposal,
      quantity: state.quantity ?? 1,
      price: state.price ?? null,
      regularPrice: state.regular_price ?? null,
      storageRoom: state.storage_room ?? "Weinkeller",
      photoPaths: job.photo_paths,
    });

    await advanceJob(
      db,
      job,
      "saving",
      { step: "done" },
      { status: "confirmed", inventory_item_id: itemId, matched_wine_id: wineId },
    );

    const base = appBaseUrl();
    const title = escapeHtml(
      `${state.proposal.producer} – ${wineTitle({ name: state.proposal.name, vintage_year: state.proposal.vintage_year })}`,
    );
    const prices = [
      state.price != null ? `bezahlt ${formatMoney(state.price, "CHF")}` : null,
      state.regular_price != null ? `Normalpreis ${formatMoney(state.regular_price, "CHF")}` : null,
    ].filter(Boolean);
    const priceLine = prices.length ? `\n${prices.join(" · ")}` : "";
    const link = base ? `\n<a href="${base}/flasche/${itemId}">In MyWine öffnen</a>` : "";
    await sendMessage(
      chatId,
      `✅ Gespeichert: ${formatBottles(state.quantity ?? 1)} ${title} · ${state.storage_room}${priceLine}${link}`,
    );
  } catch (error) {
    await failJob(db, job.id, chatId, "Speichern ist fehlgeschlagen", error);
  }
}

async function failJob(db: AdminClient, jobId: string, chatId: number, message: string, error: unknown) {
  console.error(message, error);
  const detail = error instanceof Error ? error.message : String(error);
  await db
    .from("ingest_jobs")
    .update({ status: "failed", error: detail.slice(0, 1000) })
    .eq("id", jobId);
  await sendMessage(chatId, `❌ ${escapeHtml(message)}. Bitte schick die Fotos nochmals.`).catch(
    () => undefined,
  );
}
