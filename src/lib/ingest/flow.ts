import "server-only";

// Gemeinsamer Ablauf der Erfassung (Foto und Text) nach der Erkennung: Kaufangaben
// abfragen – nur, was noch fehlt –, bei Text vorher Nachkauf/Produzent klären und
// am Ende eine Zusammenfassung zeigen; dann speichern.

import { after } from "next/server";
import { formatBottles, formatMoney, todayIso, wineTitle } from "@/lib/format";
import { researchGrapeShares } from "@/lib/grapes/research";
import { hasAnyPercent, hasCompletePercents, type GrapeShare, type GrapeSource } from "@/lib/grapes/shares";
import { loadGrapeShares, replaceGrapeShares } from "@/lib/grapes/store";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import { labelKinds } from "@/lib/media/pick";
import { saveWineMedia } from "@/lib/media/store";
import { PHOTO_BUCKET, advanceJob, jobState, toJson, type IngestJob } from "./jobs";
import {
  confirmKeyboard,
  locationKeyboard,
  priceKeyboard,
  quantityKeyboard,
  regularPriceKeyboard,
  restockKeyboard,
  textSummaryMessage,
  vendorKeyboard,
  wineSummaryLines,
} from "./messages";
import { enrichFromWeb, parseTextEntry } from "./recognize";
import type { IngestState, IngestStep, WineProposal } from "./schema";
import {
  createInventoryItem,
  findWine,
  findWineByName,
  listVendors,
  mergeWithKnownWine,
  resolveVendor,
  resolveWine,
} from "./wines";

export const TEXT_SOURCE = "text";

// ---------------------------------------------------------------------------
// Rebsorten

type ResolvedGrapes = {
  shares: GrapeShare[];
  source: Exclude<IngestState["grape_source"], undefined>;
  sources: string[];
};

/**
 * Rebsorten für den Vorschlag: vollständige Prozente vom Etikett, sonst bereits
 * gespeicherte Prozente des bekannten Weins für diesen Jahrgang, sonst Recherche.
 * Findet die Recherche keine Prozente, gewinnen die Rebsorten vom Etikett.
 */
export async function resolveGrapes(
  db: AdminClient,
  proposal: WineProposal,
  knownWineId: string | null,
): Promise<ResolvedGrapes> {
  const label = proposal.grape_shares;
  if (hasCompletePercents(label)) return { shares: label, source: "label", sources: [] };

  const stored = knownWineId
    ? await loadGrapeShares(db, knownWineId, proposal.vintage_year).catch(() => null)
    : null;
  if (stored && stored.vintageYear === proposal.vintage_year && hasAnyPercent(stored.shares)) {
    return { shares: stored.shares, source: "existing", sources: [] };
  }

  if (proposal.name && proposal.producer) {
    const research = await researchGrapeShares(
      { ...proposal, name: proposal.name, producer: proposal.producer },
      label.map((s) => s.grape),
    ).catch((error) => {
      console.error("grape research failed", error);
      return null;
    });
    if (research && (hasAnyPercent(research.shares) || label.length === 0)) {
      return { shares: research.shares, source: "research", sources: research.sources };
    }
  }

  if (label.length) return { shares: label, source: "label", sources: [] };
  if (stored) return { shares: stored.shares, source: "existing", sources: [] };
  return { shares: [], source: null, sources: [] };
}

// ---------------------------------------------------------------------------
// Schritte

/** Nächster Schritt: die erste noch fehlende Kaufangabe, sonst Zusammenfassung (Text) bzw. Speichern. */
export function nextPurchaseStep(state: IngestState): IngestStep {
  if (state.storage_room === undefined) return "location";
  if (state.quantity === undefined) return "quantity";
  if (state.price === undefined) return "price";
  if (state.regular_price === undefined) return "regular_price";
  if (state.vendor_id === undefined && !state.vendor_name) return "vendor";
  return state.source === "text" ? "confirm" : "saving";
}

/**
 * Übernimmt Angaben (patch) und geht zum nächsten fehlenden Schritt weiter – mit der
 * passenden Frage. Atomar über advanceJob (schützt vor Doppelklicks).
 */
export async function advanceTo(
  db: AdminClient,
  job: IngestJob,
  chatId: number,
  from: IngestStep | IngestStep[],
  patch: Partial<IngestState>,
) {
  const merged = { ...jobState(job)!, ...patch };
  const step = nextPurchaseStep(merged);
  const vendors = step === "vendor" ? await listVendors(db) : [];
  const next = await advanceJob(db, job, from, {
    ...patch,
    step,
    ...(step === "vendor" ? { vendor_options: vendors.map((v) => v.id) } : {}),
  });
  if (!next) return null;
  await askFor(next, chatId, vendors);
  return next;
}

async function askFor(job: IngestJob, chatId: number, vendors: { id: string; name: string }[]) {
  const state = jobState(job)!;
  switch (state.step) {
    case "location":
      await sendMessage(chatId, "Wo lagerst du die Flaschen?", locationKeyboard(job.id));
      return;
    case "quantity":
      await sendMessage(
        chatId,
        `📍 ${state.storage_room}. Wie viele Flaschen? (Button oder Zahl schreiben)`,
        quantityKeyboard(job.id),
      );
      return;
    case "price":
      await sendMessage(
        chatId,
        `${formatBottles(state.quantity ?? 1)}. Was hast du bezahlt? (CHF pro Flasche)`,
        priceKeyboard(job.id),
      );
      return;
    case "regular_price":
      await sendMessage(chatId, "Normalpreis? (oder überspringen)", regularPriceKeyboard(job.id, state.price ?? null));
      return;
    case "vendor":
      await sendMessage(
        chatId,
        vendors.length ? "Händler? (Button oder Namen schreiben)" : "Händler? (Namen schreiben oder überspringen)",
        vendorKeyboard(job.id, vendors),
      );
      return;
    case "confirm":
      await sendMessage(chatId, textSummaryMessage(state), confirmKeyboard(job.id));
      return;
    case "saving":
      after(() => saveJob(job, chatId));
      return;
  }
}

/** [Ja] in der Zusammenfassung: speichern. */
export async function confirmAndSave(db: AdminClient, job: IngestJob, chatId: number) {
  const saving = await advanceJob(db, job, "confirm", { step: "saving" });
  if (saving) after(() => saveJob(saving, chatId));
  return Boolean(saving);
}

// ---------------------------------------------------------------------------
// Speichern

/** Trinkfenster in wine_vintages übernehmen, ohne vorhandene Angaben zu überschreiben. */
async function storeDrinkWindow(db: AdminClient, wineId: string, state: IngestState) {
  const from = state.drink_from_year ?? null;
  const until = state.drink_until_year ?? null;
  const year = state.proposal.vintage_year;
  if ((from == null && until == null) || year == null) return;
  try {
    const { data: existing } = await db
      .from("wine_vintages")
      .select("id, drink_from_year, drink_until_year")
      .eq("wine_id", wineId)
      .eq("vintage_year", year)
      .maybeSingle();
    if (!existing) {
      await db.from("wine_vintages").insert({ wine_id: wineId, vintage_year: year, drink_from_year: from, drink_until_year: until });
    } else if (existing.drink_from_year == null && existing.drink_until_year == null) {
      await db.from("wine_vintages").update({ drink_from_year: from, drink_until_year: until }).eq("id", existing.id);
    }
  } catch (error) {
    // Die Flasche trotzdem speichern; das Trinkfenster lässt sich nachtragen.
    console.error("storing drink window failed", error);
  }
}

/** Rebsorten des Vorschlags in wine_grape_shares speichern (Jahrgang des Eintrags). */
async function storeGrapes(db: AdminClient, wineId: string, state: IngestState) {
  const source = state.grape_source;
  const shares = state.proposal.grape_shares;
  if (!shares.length || !source || source === "existing") return;
  try {
    await replaceGrapeShares(db, {
      wineId,
      vintageYear: state.proposal.vintage_year,
      shares,
      source: source satisfies GrapeSource,
      // Recherche/Etikett überschreiben keine manuell gepflegten Angaben.
      keepManual: source !== "manual",
    });
  } catch (error) {
    // Die Flasche trotzdem speichern; Rebsorten lassen sich nachrecherchieren.
    console.error("storing grape shares failed", error);
  }
}

const MIME_BY_EXT: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Fotos der Erfassung als wine_media (Vorder-/Rückseite) mit Vorschaubild. Fehler
 * hier verhindern das Speichern der Flasche nicht – die Fotos bleiben in photo_urls.
 */
async function storeJobMedia(
  db: AdminClient,
  paths: string[],
  state: IngestState,
  target: { wineId: string; itemId: string },
) {
  if (!paths.length) return;
  try {
    const kinds = labelKinds(paths.length, state.recognition.image_sides);
    const media = await Promise.all(
      paths.map(async (path, i) => {
        const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
        if (error) throw error;
        return {
          path,
          bytes: new Uint8Array(await data.arrayBuffer()),
          mimeType: MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "image/jpeg",
          kind: kinds[i],
          sortOrder: i,
        };
      }),
    );
    await saveWineMedia(db, { ...target, vintageYear: state.proposal.vintage_year }, media);
  } catch (error) {
    console.error("storing wine media failed", error);
  }
}

export async function saveJob(job: IngestJob, chatId: number) {
  const db = createAdminClient();
  const state = jobState(job)!;
  try {
    // Nachkauf: immer der bestehende Wein, nur eine neue Charge.
    const wineId = await resolveWine(db, state.proposal, job.matched_wine_id);
    await storeGrapes(db, wineId, state);
    await storeDrinkWindow(db, wineId, state);
    // Händler aus dem Text erst jetzt anlegen bzw. zuordnen.
    const vendor =
      state.vendor_id === undefined && state.vendor_name ? await resolveVendor(db, state.vendor_name) : null;
    const itemId = await createInventoryItem(db, {
      wineId,
      proposal: state.proposal,
      quantity: state.quantity ?? 1,
      price: state.price ?? null,
      regularPrice: state.regular_price ?? null,
      vendorId: vendor?.id ?? state.vendor_id ?? null,
      // Kaufdatum = Tag der Erfassung. Das Journal (inventory_events) schreibt die DB per Trigger.
      purchasedAt: todayIso(),
      storageRoom: state.storage_room ?? "Weinkeller",
      photoPaths: job.photo_paths,
    });
    await storeJobMedia(db, job.photo_paths, state, { wineId, itemId });

    await advanceJob(
      db,
      job,
      "saving",
      { step: "done", ...(vendor ? { vendor_id: vendor.id, vendor_name: vendor.name } : {}) },
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
    const vendorName = vendor?.name ?? state.vendor_name;
    if (vendorName) prices.push(`bei ${escapeHtml(vendorName)}`);
    const priceLine = prices.length ? `\n${prices.join(" · ")}` : "";
    const link = base ? `\n<a href="${base}/flasche/${itemId}">In MyWine öffnen</a>` : "";
    const kind = state.restock ? "Nachkauf gespeichert" : "Gespeichert";
    await sendMessage(
      chatId,
      `✅ ${kind}: ${formatBottles(state.quantity ?? 1)} ${title} · ${state.storage_room}${priceLine}${link}`,
    );
  } catch (error) {
    await failJob(db, job.id, chatId, "Speichern ist fehlgeschlagen", error, state.source === "text");
  }
}

export async function failJob(
  db: AdminClient,
  jobId: string,
  chatId: number,
  message: string,
  error: unknown,
  fromText = false,
) {
  console.error(message, error);
  const detail = error instanceof Error ? error.message : String(error);
  await db
    .from("ingest_jobs")
    .update({ status: "failed", error: detail.slice(0, 1000) })
    .eq("id", jobId);
  const retry = fromText ? "Bitte schreib den Eintrag nochmals." : "Bitte schick die Fotos nochmals.";
  await sendMessage(chatId, `❌ ${escapeHtml(message)}. ${retry}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Erfassung per Text

/** „Neuer Wein“: Fotos oder eine Beschreibung erwarten. Ältere offene Beschreibungen verfallen. */
export async function startDescribe(db: AdminClient, chatId: number) {
  await discardDescribe(db, chatId);
  const state = { step: "describe", source: "text" } as unknown as IngestState;
  const { data, error } = await db
    .from("ingest_jobs")
    .insert({ source: TEXT_SOURCE, telegram_chat_id: chatId, status: "needs_review", extracted: toJson(state) })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Wartende Beschreibungen dieses Chats verwerfen (z. B. wenn stattdessen Fotos kommen). */
export async function discardDescribe(db: AdminClient, chatId: number) {
  await db
    .from("ingest_jobs")
    .update({ status: "discarded" })
    .eq("source", TEXT_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "describe");
}

/** Liegt dieser Wein mit diesem Jahrgang schon im Keller (ungeöffnet oder offen)? */
async function inStock(db: AdminClient, wineId: string, year: number | null) {
  let q = db.from("inventory_items").select("id", { count: "exact", head: true }).eq("wine_id", wineId).in("status", ["sealed", "open"]);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const { count } = await q;
  return (count ?? 0) > 0;
}

/**
 * Freitext als neuer Eintrag: erkennen, wie bei Fotos recherchieren (Websuche, Rebsorten,
 * Trinkreife), dann nur nach Fehlendem fragen. jobId: eine wartende Beschreibung
 * (nach „Neuer Wein“), sonst wird ein neuer Eintrag angelegt.
 */
export async function startTextIngest(chatId: number, text: string, jobId?: string) {
  const db = createAdminClient();
  const state = { step: "researching", source: "text" } as unknown as IngestState;
  let id = jobId;
  if (id) {
    const { data } = await db
      .from("ingest_jobs")
      .update({ status: "processing", extracted: toJson(state) })
      .eq("id", id)
      .eq("status", "needs_review")
      .select("id");
    if (!data?.length) return;
  } else {
    const { data, error } = await db
      .from("ingest_jobs")
      .insert({ source: TEXT_SOURCE, telegram_chat_id: chatId, status: "processing", extracted: toJson(state) })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
  }
  await sendMessage(chatId, "✍️ Ich erfasse den Wein und recherchiere die fehlenden Angaben …");
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  const jobIdFinal = id;
  after(() => processTextJob(jobIdFinal, chatId, text.slice(0, 2000)));
}

/** Erkennung, Recherche und erste Rückfrage (läuft per after(); exportiert für Tests). */
export async function processTextJob(jobId: string, chatId: number, text: string) {
  const db = createAdminClient();
  try {
    const parsed = await parseTextEntry(text);
    let proposal = parsed.proposal;
    if (!proposal.name) {
      await db.from("ingest_jobs").update({ status: "discarded", error: "kein Wein erkannt" }).eq("id", jobId);
      await sendMessage(
        chatId,
        "Ich konnte darin keinen Wein erkennen. Schreib z. B. <i>„Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“</i>.",
      );
      return;
    }

    // Bekannter Wein? Über Name + Produzent, ohne Produzent über einen eindeutigen Namen.
    let known = proposal.producer ? await findWine(db, proposal.name, proposal.producer) : await findWineByName(db, proposal.name);
    if (known) proposal = mergeWithKnownWine(proposal, known);

    let enriched: IngestState["recognition"] = { model: "text", confidence: 1, notes: null, enriched_fields: [], sources: [] };
    let drink = { from: null as number | null, until: null as number | null };
    if (!known) {
      const web = await enrichFromWeb(proposal).catch((error) => {
        console.error("web enrichment failed", error);
        return null;
      });
      if (web) {
        proposal = web.proposal;
        enriched = { ...enriched, enriched_fields: web.filled, sources: web.sources };
        drink = web.drink;
      }
      // Den recherchierten Produzenten gibt es vielleicht schon im Keller.
      known = await findWine(db, proposal.name, proposal.producer);
      if (known) proposal = mergeWithKnownWine(proposal, known);
    }

    const grapes = await resolveGrapes(db, proposal, known?.id ?? null);
    proposal = { ...proposal, grape_shares: grapes.shares };

    const p = parsed.purchase;
    const restockCandidate = known ? await inStock(db, known.id, proposal.vintage_year) : false;
    const base: IngestState = {
      step: "researching",
      source: "text",
      proposal,
      grape_source: grapes.source,
      recognition: { ...enriched, sources: [...enriched.sources, ...grapes.sources].slice(0, 8) },
      drink_from_year: drink.from,
      drink_until_year: drink.until,
      ...(p.storage_room ? { storage_room: p.storage_room } : {}),
      ...(p.quantity > 0 && p.quantity <= 999 ? { quantity: p.quantity } : {}),
      ...(p.price > 0 ? { price: p.price } : {}),
      ...(p.regular_price > 0 ? { regular_price: p.regular_price } : {}),
      ...(p.vendor.trim() ? { vendor_name: p.vendor.trim().replace(/\s+/g, " ").slice(0, 80) } : {}),
    };
    const step: IngestStep = restockCandidate ? "restock" : !proposal.producer ? "producer" : nextPurchaseStep(base);
    const vendors = step === "vendor" ? await listVendors(db) : [];
    const state: IngestState = { ...base, step, ...(step === "vendor" ? { vendor_options: vendors.map((v) => v.id) } : {}) };

    const { data: job, error } = await db
      .from("ingest_jobs")
      .update({ status: "needs_review", extracted: toJson(state), matched_wine_id: known?.id ?? null })
      .eq("id", jobId)
      .select("*")
      .single();
    if (error) throw error;

    await sendMessage(chatId, wineSummaryLines(state).join("\n"));
    if (step === "restock") {
      await sendMessage(
        chatId,
        "Diesen Wein mit diesem Jahrgang hast du schon im Keller. Nachkauf zu bestehendem Wein? (Sonst mit genauerem Namen neu schreiben.)",
        restockKeyboard(jobId),
      );
    } else if (step === "producer") {
      await sendMessage(chatId, "Von welchem Produzenten ist der Wein?");
    } else {
      await askFor(job, chatId, vendors);
    }
  } catch (error) {
    await failJob(db, jobId, chatId, "Die Erfassung ist fehlgeschlagen", error, true);
  }
}

/** [Ja, Nachkauf]: nur eine neue Charge zum bestehenden Wein. */
export async function acceptRestock(db: AdminClient, job: IngestJob, chatId: number) {
  return advanceTo(db, job, chatId, "restock", { restock: true });
}

/** Antwort auf „Von welchem Produzenten?“: übernehmen, Bestand prüfen, weiter. */
export async function setProducer(db: AdminClient, job: IngestJob, chatId: number, producer: string) {
  const state = jobState(job)!;
  let proposal: WineProposal = { ...state.proposal, producer: producer.replace(/\s+/g, " ").trim().slice(0, 120) };
  const known = await findWine(db, proposal.name, proposal.producer);
  if (known) proposal = mergeWithKnownWine(proposal, known);
  if (known && (await inStock(db, known.id, proposal.vintage_year))) {
    const next = await advanceJob(db, job, "producer", { step: "restock", proposal }, { matched_wine_id: known.id });
    if (next) {
      await sendMessage(
        chatId,
        "Diesen Wein mit diesem Jahrgang hast du schon im Keller. Nachkauf zu bestehendem Wein?",
        restockKeyboard(job.id),
      );
    }
    return;
  }
  const withWine = known ? ((await advanceJob(db, job, "producer", { proposal }, { matched_wine_id: known.id })) ?? job) : job;
  await advanceTo(db, withWine, chatId, "producer", { proposal });
}
