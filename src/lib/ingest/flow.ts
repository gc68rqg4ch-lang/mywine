import "server-only";

// Gemeinsamer Ablauf der Erfassung (Foto und Text) nach der Erkennung: Kaufangaben
// abfragen – nur, was noch fehlt –, bei Text vorher Nachkauf/Produzent klären und
// am Ende eine Zusammenfassung zeigen; dann speichern.

import { cleanGiftFrom, giftInText } from "./gift";
import { scheduleTasteProfile } from "@/lib/research/taste-auto";
import { after } from "next/server";
import { apiProblemForBot } from "@/lib/ai/api-errors";
import { savedWineKeyboard } from "@/lib/chat/menu";
import type { Database } from "@/lib/database.types";
import { formatBottles, formatMoney, todayIso, wineTitle } from "@/lib/format";
import { researchGrapeShares } from "@/lib/grapes/research";
import { hasAnyPercent, hasCompletePercents, type GrapeShare, type GrapeSource } from "@/lib/grapes/shares";
import { loadGrapeShares, replaceGrapeShares } from "@/lib/grapes/store";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { T } from "@/lib/bot/texts";
import { resolveActor } from "@/lib/telegram/actor";
import { labelKinds } from "@/lib/media/pick";
import { saveWineMedia } from "@/lib/media/store";
import { PHOTO_BUCKET, advanceJob, jobState, toJson, type IngestJob } from "./jobs";
import {
  cancelKeyboard,
  confirmKeyboard,
  locationKeyboard,
  proposalMessage,
  reviewKeyboard,
  vintageKeyboard,
  giftFromKeyboard,
  priceKeyboard,
  quantityKeyboard,
  regularPriceKeyboard,
  restockKeyboard,
  textSummaryMessage,
  vendorKeyboard,
  wineSummaryLines,
} from "./messages";
import { enrichFromWeb, parseTextEntry, type RecognitionResult } from "./recognize";
import { needsVintage, type IngestState, type IngestStep, type WineProposal } from "./schema";
import {
  createInventoryItem,
  findWine,
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
  /** Rebsorten aus der gemeinsamen Recherche (enrichFromWeb); undefined = selbst recherchieren. */
  researched?: { shares: GrapeShare[]; sources: string[] } | null,
): Promise<ResolvedGrapes> {
  const label = proposal.grape_shares;
  if (hasCompletePercents(label)) return { shares: label, source: "label", sources: [] };

  const stored = knownWineId
    ? await loadGrapeShares(db, knownWineId, proposal.vintage_year).catch(() => null)
    : null;
  if (stored && stored.vintageYear === proposal.vintage_year && hasAnyPercent(stored.shares)) {
    return { shares: stored.shares, source: "existing", sources: [] };
  }

  if (researched !== undefined) {
    if (researched && (hasAnyPercent(researched.shares) || label.length === 0)) {
      return { shares: researched.shares, source: "research", sources: researched.sources };
    }
  } else if (proposal.name && proposal.producer) {
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
// Foto: Kauf

/**
 * Foto-Erfassung als Kauf (nach der Erkennung bzw. nach „🛒 Gekauft“): mit bestehenden Weinen
 * abgleichen, Fehlendes per Websuche ergänzen, Rebsorten bestimmen, Vorschlag zeigen.
 */
export async function continuePhotoPurchase(
  db: AdminClient,
  jobId: string,
  chatId: number,
  recognition: RecognitionResult,
  /** Bildtext des Albums: „Geschenk von Marc“ wird direkt übernommen. */
  caption?: string | null,
) {
  try {
    let proposal = recognition.proposal;
    let enriched: { filled: IngestState["recognition"]["enriched_fields"]; sources: string[] } = { filled: [], sources: [] };

    // Zuerst gegen bestehende Weine abgleichen; ein Durchgang Websuche für alles, was fehlt
    // (Stammdaten, Trinkfenster, Rebsorten mit %) – auch bei bekannten Weinen; Vorhandenes bleibt.
    const known = await findWine(db, proposal.name, proposal.producer);
    if (known) proposal = mergeWithKnownWine(proposal, known);
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

    const gift = giftInText(caption);
    const state: IngestState = {
      step: "review",
      intent: "bought",
      ...(gift ? giftPatch(gift.from) : {}),
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

// ---------------------------------------------------------------------------
// Schritte

/**
 * Geschenk: Preis 0, kein Normalpreis, kein Händler; from = Name (undefined = noch fragen,
 * null = unbekannt).
 */
export function giftPatch(from: string | null | undefined): Partial<IngestState> {
  return { is_gift: true, price: 0, regular_price: null, ...(from !== undefined && from !== null ? { gift_from: from } : {}) };
}

/** Nächster Schritt: die erste noch fehlende Kaufangabe, sonst Zusammenfassung (Text) bzw. Speichern. */
export function nextPurchaseStep(state: IngestState): IngestStep {
  if (needsVintage(state)) return "vintage";
  if (state.storage_room === undefined) return "location";
  if (state.quantity === undefined) return "quantity";
  // Geschenk: nur noch „Von wem?“ (falls nicht schon bekannt) – kein Preis, Händler oder Kaufdatum.
  if (state.is_gift) {
    if (state.gift_from === undefined) return "gift_from";
    return state.source === "text" ? "confirm" : "saving";
  }
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
    case "vintage": {
      const guess = state.proposal.vintage_year;
      await sendMessage(
        chatId,
        guess != null ? T.vintageGuess(guess) : T.vintageAsk,
        vintageKeyboard(job.id, guess),
      );
      return;
    }
    case "location":
      await sendMessage(chatId, T.whereStored, locationKeyboard(job.id));
      return;
    case "quantity":
      await sendMessage(
        chatId,
        T.howMany(state.storage_room ?? "Weinkeller"),
        quantityKeyboard(job.id),
      );
      return;
    case "price":
      await sendMessage(
        chatId,
        T.pricePaid(formatBottles(state.quantity ?? 1)),
        priceKeyboard(job.id),
      );
      return;
    case "gift_from":
      await sendMessage(chatId, T.giftFromAsk(), giftFromKeyboard(job.id));
      return;
    case "regular_price":
      await sendMessage(chatId, T.regularPrice, regularPriceKeyboard(job.id, state.price ?? null));
      return;
    case "vendor":
      await sendMessage(
        chatId,
        T.vendorAsk(vendors.length > 0),
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
export async function storeDrinkWindow(db: AdminClient, wineId: string, state: IngestState) {
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

/** Leere Stammdaten eines bestehenden Weins aus der Recherche ergänzen – nie überschreiben. */
export async function fillWineGaps(db: AdminClient, wineId: string, p: WineProposal) {
  try {
    const { data: wine } = await db
      .from("wines")
      .select("country, region, appellation, type, alcohol_content")
      .eq("id", wineId)
      .maybeSingle();
    if (!wine) return;
    const patch: Database["public"]["Tables"]["wines"]["Update"] = {};
    if (wine.country == null && p.country != null) patch.country = p.country;
    if (wine.region == null && p.region != null) patch.region = p.region;
    if (wine.appellation == null && p.appellation != null) patch.appellation = p.appellation;
    if (wine.type == null && p.type != null) patch.type = p.type;
    if (wine.alcohol_content == null && p.alcohol_content != null) patch.alcohol_content = p.alcohol_content;
    if (Object.keys(patch).length) await db.from("wines").update(patch).eq("id", wineId);
  } catch (error) {
    console.error("filling wine gaps failed", error);
  }
}

/** Rebsorten des Vorschlags in wine_grape_shares speichern (Jahrgang des Eintrags). */
export async function storeGrapes(db: AdminClient, wineId: string, state: IngestState) {
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
export async function storeJobMedia(
  db: AdminClient,
  paths: string[],
  state: Pick<IngestState, "proposal" | "recognition">,
  target: { wineId: string; itemId: string | null },
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
    await fillWineGaps(db, wineId, state.proposal);
    await storeGrapes(db, wineId, state);
    await storeDrinkWindow(db, wineId, state);
    // Händler aus dem Text erst jetzt anlegen bzw. zuordnen.
    const vendor =
      state.vendor_id === undefined && state.vendor_name ? await resolveVendor(db, state.vendor_name) : null;
    const itemId = await createInventoryItem(db, {
      wineId,
      proposal: state.proposal,
      quantity: state.quantity ?? 1,
      price: state.is_gift ? 0 : (state.price ?? null),
      regularPrice: state.is_gift ? null : (state.regular_price ?? null),
      vendorId: state.is_gift ? null : (vendor?.id ?? state.vendor_id ?? null),
      isGift: Boolean(state.is_gift),
      giftFrom: state.is_gift ? cleanGiftFrom(state.gift_from) : null,
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

    const prices = state.is_gift
      ? [T.giftLine(cleanGiftFrom(state.gift_from))]
      : [
          state.price != null ? `bezahlt ${formatMoney(state.price, "CHF")}` : null,
          state.regular_price != null ? `Normalpreis ${formatMoney(state.regular_price, "CHF")}` : null,
        ].filter((p): p is string => p != null);
    const vendorName = vendor?.name ?? state.vendor_name;
    if (vendorName && !state.is_gift) prices.push(`bei ${escapeHtml(vendorName)}`);
    // Gleich weiter: Wein-Menü mit dieser Charge (Öffnen, Bewerten, Verkostung, …).
    const actor = await resolveActor(db, chatId).catch(() => null);
    const keyboard = await savedWineKeyboard(
      db,
      { wineId, year: state.proposal.vintage_year, itemId },
      actor ? { personId: actor.personId, name: actor.name } : null,
    ).catch((error: unknown) => {
      console.error("saved wine keyboard failed", error);
      return undefined;
    });
    await sendMessage(chatId, savedMessage(state, prices), keyboard);
    // Geschmacksprofil für genau diesen Jahrgang im Hintergrund (auch beim Nachkauf, falls noch keins da ist).
    scheduleTasteProfile(wineId, state.proposal.vintage_year ?? null);
  } catch (error) {
    await failJob(db, job.id, chatId, "Das Speichern ist mir nicht gelungen", error, state.source === "text");
  }
}

/** „Ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht. …“ (exportiert für Tests). */
export function savedMessage(state: IngestState, prices: string[] = [], random?: () => number) {
  const title = escapeHtml(wineTitle({ name: state.proposal.name, vintage_year: state.proposal.vintage_year }));
  const room = state.storage_room === "Wohnzimmer" ? "im Wohnzimmer" : `im ${state.storage_room ?? "Weinkeller"}`;
  const n = state.quantity ?? 1;
  return [
    T.booked({ bottles: formatBottles(n), wine: title, room, restock: Boolean(state.restock) }, random),
    prices.length ? prices.join(" · ") : null,
    T.bookedFollowUp(n),
  ]
    .filter(Boolean)
    .join("\n");
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
  // API-Limit oder anderer API-Fehler: klar sagen, statt „nochmals schicken“ zu empfehlen.
  const api = apiProblemForBot(error);
  if (api) {
    await sendMessage(chatId, escapeHtml(api)).catch(() => undefined);
    return;
  }
  // Keine technische Meldung – nur: nichts gespeichert, bitte nochmals.
  await sendMessage(chatId, fromText ? T.textError : T.photoError).catch(() => undefined);
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

/** Liegt dieser Wein mit diesem Jahrgang schon im Bestand (ungeöffnet oder offen)? */
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
  await sendMessage(chatId, T.readingText);
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
        T.noWineInText,
      );
      return;
    }

    // Bekannter Wein? Über Name + Produzent, ohne Produzent über einen eindeutigen Namen.
    let known = await findWine(db, proposal.name, proposal.producer);
    if (known) proposal = mergeWithKnownWine(proposal, known);

    let enriched: IngestState["recognition"] = { model: "text", confidence: 1, notes: null, enriched_fields: [], sources: [] };
    let drink = { from: null as number | null, until: null as number | null };
    // Ein Durchgang für alles, was fehlt – auch bei bekannten Weinen (deren Lücken).
    const web = await enrichFromWeb(proposal).catch((error) => {
      console.error("web enrichment failed", error);
      return null;
    });
    if (web) {
      proposal = web.proposal;
      enriched = { ...enriched, enriched_fields: web.filled, sources: web.sources };
      drink = web.drink;
    }
    if (!known) {
      // Den recherchierten Produzenten gibt es vielleicht schon im Bestand.
      known = await findWine(db, proposal.name, proposal.producer);
      if (known) proposal = mergeWithKnownWine(proposal, known);
    }

    const grapes = await resolveGrapes(db, proposal, known?.id ?? null, web ? web.grapes : undefined);
    proposal = { ...proposal, grape_shares: grapes.shares };

    const p = parsed.purchase;
    const gift = giftInText(text);
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
      // Geschenk im Text („Geschenk von Marc“): direkt übernehmen, Preisfrage entfällt.
      ...(p.gift || gift ? giftPatch(cleanGiftFrom(p.gift_from) ?? gift?.from) : {}),
    };
    // Jahrgang zuerst: davon hängt ab, ob es ein Nachkauf ist.
    const step: IngestStep = needsVintage(base)
      ? "vintage"
      : restockCandidate
        ? "restock"
        : !proposal.producer
          ? "producer"
          : nextPurchaseStep(base);
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
        T.restockAskOrRename,
        restockKeyboard(jobId),
      );
    } else if (step === "producer") {
      await sendMessage(chatId, T.producerAsk, cancelKeyboard(jobId));
    } else {
      await askFor(job, chatId, vendors);
    }
  } catch (error) {
    await failJob(db, jobId, chatId, "Die Erfassung ist fehlgeschlagen", error, true);
  }
}

/**
 * Antwort auf die Jahrgangsfrage (Zahl oder „ohne Jahrgang“). Bei der Text-Erfassung
 * danach wie sonst: Nachkauf? Produzent? Dann die Kaufangaben.
 */
export async function setVintage(db: AdminClient, job: IngestJob, chatId: number, year: number | null) {
  const state = jobState(job)!;
  const patch: Partial<IngestState> = {
    proposal: { ...state.proposal, vintage_year: year },
    vintage_confirmed: true,
    vintage_uncertain: false,
  };
  if (state.source === "text" && !state.restock) {
    if (job.matched_wine_id && (await inStock(db, job.matched_wine_id, year))) {
      const next = await advanceJob(db, job, "vintage", { ...patch, step: "restock" });
      if (next) {
        await sendMessage(chatId, T.restockAsk, restockKeyboard(job.id));
      }
      return;
    }
    if (!state.proposal.producer) {
      const next = await advanceJob(db, job, "vintage", { ...patch, step: "producer" });
      if (next) await sendMessage(chatId, T.producerAsk, cancelKeyboard(job.id));
      return;
    }
  }
  await advanceTo(db, job, chatId, "vintage", patch);
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
        T.restockAsk,
        restockKeyboard(job.id),
      );
    }
    return;
  }
  const withWine = known ? ((await advanceJob(db, job, "producer", { proposal }, { matched_wine_id: known.id })) ?? job) : job;
  await advanceTo(db, withWine, chatId, "producer", { proposal });
}
