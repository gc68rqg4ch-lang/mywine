import { appendNote, bestBeforeSentence, bestBeforeInText, formatBestBefore, parseBestBefore, toBestBeforeValue } from "./best-before";
import "server-only";

// Gemeinsamer Ablauf der Erfassung (Foto und Text) nach der Erkennung: Kaufangaben
// abfragen – nur, was noch fehlt –, bei Text vorher Nachkauf/Produzent klären und
// am Ende eine Zusammenfassung zeigen; dann speichern.

import { cleanGiftFrom, giftInText, giftValueInText } from "./gift";
import { REGULAR_HINT, pricesInText } from "./prices";
import { scheduleTasteProfile } from "@/lib/research/taste-auto";
import { scheduleDrinkWindow } from "@/lib/research/drink-window-auto";
import { asDrinkSource, drinkWindowHint, drinkWindowText, saveVintageWindow } from "@/lib/cellar/drink-window";
import { ensureVintage } from "@/lib/cellar/vintage-row";
import { sourceNote } from "@/lib/research/compare";
import { later } from "@/lib/later";
import { apiLimitForIngest, apiProblemForBot } from "@/lib/ai/api-errors";
import { savedWineKeyboard } from "@/lib/chat/menu";
import type { Database } from "@/lib/database.types";
import { formatBottles, formatMoney, positiveAmount, todayIso, wineTitle } from "@/lib/format";
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
  categoryKeyboard,
  confirmKeyboard,
  kindKeyboard,
  newCategoryKeyboard,
  locationKeyboard,
  proposalMessage,
  reviewKeyboard,
  vintageKeyboard,
  giftFromKeyboard,
  giftValueKeyboard,
  priceKeyboard,
  priceLine,
  quantityInText,
  quantityKeyboard,
  regularPriceKeyboard,
  restockKeyboard,
  similarKeyboard,
  similarLabel,
  textSummaryMessage,
  vendorKeyboard,
  wineSummaryLines,
} from "./messages";
import { enrichFromWeb, parseTextEntry, type RecognitionResult } from "./recognize";
import { mainOptions, spiritStart, storeSpiritFields } from "./spirit-flow";
import { scheduleSpiritResearch } from "@/lib/research/spirit-auto";
import { scheduleOpenKeep } from "@/lib/research/open-keep-auto";
import type { SpiritCategory } from "@/lib/spirits/categories";
import { needsVintage, type IngestState, type IngestStep, type WineProposal } from "./schema";
import { completeWineName } from "./wine-names";
import {
  createInventoryItem,
  findSimilarWines,
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
  /** Erste Frage an die Person (ohne vorherige Rückfrage): weitere Fotos innert 15 s gehören dazu. */
  options: { firstQuestion?: boolean } = {},
) {
  try {
    let proposal = recognition.proposal;
    let enriched: { filled: IngestState["recognition"]["enriched_fields"]; sources: string[] } = { filled: [], sources: [] };

    // Zuerst gegen bestehende Weine abgleichen; ein Durchgang Websuche für alles, was fehlt
    // (Stammdaten, Trinkfenster, Rebsorten mit %) – auch bei bekannten Weinen; Vorhandenes bleibt.
    const known = await findWine(db, proposal.name, proposal.producer);
    if (known) proposal = mergeWithKnownWine(proposal, known);
    // Spirituose (bzw. unsicher): keine Wein-Recherche (Trinkfenster, Rebsorten) – die Recherche
    // der Spirituose läuft nach dem Einbuchen im Hintergrund.
    const spirit = await spiritStart(db, proposal, recognition.spirit, known);
    proposal = spirit.proposal;
    const web =
      spirit.spirit || spirit.unsure
        ? null
        : await enrichFromWeb(proposal).catch((error) => {
            console.error("web enrichment failed", error);
            return null;
          });
    if (web) {
      proposal = web.proposal;
      enriched = { filled: web.filled, sources: web.sources };
    }
    const grapes = spirit.spirit || spirit.unsure ? { shares: proposal.grape_shares, source: null, sources: [] as string[] } : await resolveGrapes(db, proposal, known?.id ?? null, web ? web.grapes : undefined);
    proposal = { ...proposal, grape_shares: grapes.shares };

    const gift = giftInText(caption);
    const captionQuantity = quantityInText(caption);
    // Preise im Bildtext: ein Preis = bezahlt; „49 statt 66“ = beide; „Normalpreis 66“ = nur der.
    const captionPrices = gift ? { paid: null, regular: null } : pricesInText(caption);
    const state: IngestState = {
      step: "review",
      intent: "bought",
      ...spirit.patch,
      ...(options.firstQuestion ? { photo_join: true } : {}),
      ...(gift ? giftPatch(gift.from, giftValueInText(caption)) : {}),
      // Anzahl im Bildtext („6 Flaschen“): nicht nochmals fragen.
      ...(captionQuantity ? { quantity: captionQuantity } : {}),
      ...(captionPrices.paid != null ? { price: captionPrices.paid } : {}),
      ...(captionPrices.regular != null ? { regular_price: captionPrices.regular } : {}),
      proposal,
      // Jahrgang nicht sicher gelesen → vor dem Speichern nachfragen.
      ...(proposal.vintage_year != null && !recognition.vintageCertain ? { vintage_uncertain: true } : {}),
      grape_source: grapes.source,
      drink_from_year: web?.drink.from ?? null,
      drink_until_year: web?.drink.until ?? null,
      // Ablaufdatum vom Etikett, sonst aus dem Bildtext („haltbar bis 09/2028“).
      ...bestBeforeState(recognition.bestBefore ?? (bestBeforeInText(caption) && toBestBeforeValue(bestBeforeInText(caption)!))),
      recognition: {
        model: recognition.model,
        confidence: recognition.confidence,
        notes: recognition.notes,
        enriched_fields: enriched.filled,
        sources: [...enriched.sources, ...grapes.sources].slice(0, 8),
        ...(recognition.imageSides ? { image_sides: recognition.imageSides } : {}),
      },
    };

    // Kein exakter Treffer, aber ein ähnlicher bestehender Wein (andere Schreibweise): erst fragen.
    const similar = known ? [] : await findSimilarWines(db, proposal.name, proposal.producer);
    const { error } = await db
      .from("ingest_jobs")
      .update({
        status: "needs_review",
        extracted: toJson(similar.length ? { ...state, step: "similar", similar_ids: similar.map((w) => w.id) } : state),
        confidence: Math.round(recognition.confidence * 100) / 100,
        matched_wine_id: known?.id ?? null,
      })
      .eq("id", jobId);
    if (error) throw error;

    if (similar.length) await askSimilar(chatId, jobId, similar);
    else await sendMessage(chatId, proposalMessage(state, Boolean(known), await summaryExtras(db, known?.id ?? null, state)), reviewKeyboard(jobId));
  } catch (error) {
    await failJob(db, jobId, chatId, "Die Erkennung ist fehlgeschlagen", error);
  }
}

// ---------------------------------------------------------------------------
// Schritte

/**
 * Geschenk: Preis 0, kein Händler; from = Name (undefined = noch fragen, null = unbekannt);
 * value = Normalpreis/Wert pro Flasche (undefined = noch fragen).
 */
export function giftPatch(from: string | null | undefined, value?: number | null): Partial<IngestState> {
  return {
    is_gift: true,
    price: 0,
    ...(from !== undefined && from !== null ? { gift_from: from } : {}),
    ...(value != null ? { regular_price: value } : {}),
  };
}

/** Nächster Schritt: die erste noch fehlende Kaufangabe, sonst Zusammenfassung (Text) bzw. Speichern. */
export function nextPurchaseStep(state: IngestState): IngestStep {
  // Zuerst klären: Wein oder Spirituose? Bei Spirituosen die Kategorie (neue erst nach „Anlegen“).
  if (state.kind_unsure) return "kind";
  if (state.proposal.type === "spirit" && state.spirit && !state.spirit.done) return state.spirit.newCategory ? "category" : "category_main";
  if (needsVintage(state)) return "vintage";
  if (state.storage_room === undefined) return "location";
  if (state.quantity === undefined) return "quantity";
  // Geschenk: nur noch „Von wem?“ (falls nicht schon bekannt) – kein Preis, Händler oder Kaufdatum.
  if (state.is_gift) {
    if (state.gift_from === undefined) return "gift_from";
    // Danach der Normalpreis (Wert der Flasche) – „🤷 Weiss ich nicht“ = null.
    if (state.regular_price === undefined) return "regular_price";
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
  let step = nextPurchaseStep(merged);
  const vendors = step === "vendor" ? await listVendors(db) : [];
  const mains = step === "category_main" ? await mainOptions(db).catch(() => [] as SpiritCategory[]) : [];
  // Keine Kategorien ladbar (z. B. vor der Migration): ohne Kategorie weiter.
  if (step === "category_main" && !mains.length && merged.spirit) {
    patch = { ...patch, spirit: { ...merged.spirit, done: true } };
    step = nextPurchaseStep({ ...merged, ...patch });
  }
  const next = await advanceJob(db, job, from, {
    ...patch,
    step,
    ...(step === "vendor" ? { vendor_options: vendors.map((v) => v.id) } : {}),
    ...(step === "category_main" ? { category_options: mains.map((c) => c.id) } : {}),
  });
  if (!next) return null;
  await askFor(next, chatId, vendors, mains);
  return next;
}

async function askFor(job: IngestJob, chatId: number, vendors: { id: string; name: string }[], mains: SpiritCategory[] = []) {
  const state = jobState(job)!;
  switch (state.step) {
    case "kind":
      await sendMessage(chatId, T.kindAsk(), kindKeyboard(job.id));
      return;
    case "category": {
      const c = state.spirit?.newCategory;
      if (c) await sendMessage(chatId, T.newCategoryAsk(c.name, c.parentName), newCategoryKeyboard(job.id));
      return;
    }
    case "category_main":
      await sendMessage(chatId, T.chooseCategory, categoryKeyboard(job.id, mains.map((c) => c.name), "main"));
      return;
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
      if (state.is_gift) await sendMessage(chatId, T.giftValueAsk(), giftValueKeyboard(job.id));
      // Nach einem Betrag: „Ist das auch der Normalpreis?“; ohne Betrag: nach dem Normalpreis fragen.
      else if (state.price != null) await sendMessage(chatId, T.sameAsRegular(), regularPriceKeyboard(job.id, state.price));
      else await sendMessage(chatId, T.regularPrice(), regularPriceKeyboard(job.id, null));
      return;
    case "vendor":
      await sendMessage(
        chatId,
        T.vendorAsk(vendors.length > 0),
        vendorKeyboard(job.id, vendors),
      );
      return;
    case "confirm":
      await sendMessage(chatId, textSummaryMessage(state, await summaryExtras(createAdminClient(), job.matched_wine_id, state)), confirmKeyboard(job.id));
      return;
    case "saving":
      later(() => saveJob(job, chatId));
      return;
  }
}

/** [Ja] in der Zusammenfassung: speichern. */
export async function confirmAndSave(db: AdminClient, job: IngestJob, chatId: number) {
  const saving = await advanceJob(db, job, "confirm", { step: "saving" });
  if (saving) later(() => saveJob(saving, chatId));
  return Boolean(saving);
}

// ---------------------------------------------------------------------------
// Speichern

/** Trinkfenster in wine_vintages übernehmen, ohne vorhandene Angaben zu überschreiben. */
export async function storeDrinkWindow(db: AdminClient, wineId: string, state: IngestState) {
  const from = state.drink_from_year ?? null;
  const until = state.drink_until_year ?? null;
  const year = state.proposal.vintage_year;
  // Mit Ablaufdatum übernimmt storeBestBefore (Herkunft „label“); NV nur dort.
  if ((from == null && until == null) || year == null || parseBestBefore(state.best_before)) return;
  try {
    const { data: existing } = await db
      .from("wine_vintages")
      .select("id, drink_from_year, drink_until_year")
      .eq("wine_id", wineId)
      .eq("vintage_year", year)
      .maybeSingle();
    // Aus der Recherche beim Erfassen: Herkunft „research“, Quelle aus den Recherche-Quellen.
    const note = sourceNote(state.recognition.sources ?? []);
    if (!existing || (existing.drink_from_year == null && existing.drink_until_year == null)) {
      await saveVintageWindow(db, { rowId: existing?.id ?? null, wineId, year }, { drink_from_year: from, drink_until_year: until }, "research", note);
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
    // Spirituose: Kategorie, Alter, Fass, Destilliert, Abgefüllt (nur Leeres).
    await storeSpiritFields(db, wineId, state);
    await storeGrapes(db, wineId, state);
    // Jahrgang gleich mit anlegen: die Hintergrund-Suchen (Profil, Trinkfenster) finden ihn dann
    // schon vor und schreiben nur noch ihre Felder (ensureVintage ist auch bei Gleichzeitigkeit sicher).
    await ensureVintage(db, wineId, state.proposal.vintage_year).catch((error) => console.error("ensure vintage failed", error));
    await storeDrinkWindow(db, wineId, state);
    await storeBestBefore(db, wineId, state);
    // Händler aus dem Text erst jetzt anlegen bzw. zuordnen.
    const vendor =
      state.vendor_id === undefined && state.vendor_name ? await resolveVendor(db, state.vendor_name) : null;
    const itemId = await createInventoryItem(db, {
      wineId,
      proposal: state.proposal,
      quantity: state.quantity ?? 1,
      price: state.is_gift ? 0 : (state.price ?? null),
      regularPrice: state.regular_price ?? null,
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
      ? [T.giftLine(cleanGiftFrom(state.gift_from)), state.regular_price != null ? `Normalpreis ${formatMoney(state.regular_price, "CHF")}` : null].filter(
          (p): p is string => p != null,
        )
      : [priceLine(state.price, state.regular_price)].filter((p): p is string => p != null);
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
    // Geschmacksprofil und Trinkfenster für genau diesen Jahrgang im Hintergrund (auch beim Nachkauf,
    // falls noch keins da ist). Das Trinkfenster läuft danach, damit Etikett/Recherche Vorrang haben.
    scheduleTasteProfile(wineId, state.proposal.vintage_year ?? null);
    // Spirituosen: kein Trinkfenster, dafür die fehlenden Angaben recherchieren.
    if (state.proposal.type === "spirit") scheduleSpiritResearch(wineId);
    else scheduleDrinkWindow(wineId, state.proposal.vintage_year ?? null);
    // Likörwein bzw. Likör (Spirituose der Kategorie Likör): wie lange eine offene Flasche gut bleibt.
    if (state.proposal.type === "fortified" || state.proposal.type === "spirit") scheduleOpenKeep(wineId);
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
  // Kontingent aufgebraucht: die Erfassung bleibt offen und wartet auf eine Beschreibung als
  // Text (Fotos bleiben am Eintrag) – statt „fehlgeschlagen“. Läuft wie jede Rückfrage nach 10 Min. ab.
  const limit = apiLimitForIngest(error, fromText);
  if (limit) {
    console.error("api limit reached", message);
    const { data: current } = await db.from("ingest_jobs").select("extracted").eq("id", jobId).maybeSingle();
    const caption = (current?.extracted as { caption?: string } | null)?.caption;
    await db
      .from("ingest_jobs")
      .update({ status: "needs_review", error: null, extracted: toJson({ step: "describe", source: "text", ...(caption ? { caption } : {}) } as IngestState) })
      .eq("id", jobId);
    await sendMessage(chatId, escapeHtml(limit), cancelKeyboard(jobId)).catch(() => undefined);
    return;
  }
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

/**
 * Bezahlt und Normalpreis aus dem Freitext: was im Text eindeutig steht (pricesInText), sonst die
 * Erkennung. Ein einzelner Preis ohne Stichwort „normal/statt/UVP“ gilt immer als bezahlt.
 */
export function textPurchasePrices(text: string, p: { price: number; regular_price: number }) {
  const found = pricesInText(text);
  let paid = positiveAmount(p.price);
  let regular = positiveAmount(p.regular_price);
  if (paid == null && regular != null && !REGULAR_HINT.test(text)) [paid, regular] = [regular, null];
  // Eindeutig im Text Genanntes gilt; die Erkennung ergänzt, ohne denselben Betrag doppelt zu vergeben.
  return {
    paid: found.paid ?? (paid != null && paid !== found.regular ? paid : null),
    regular: found.regular ?? (regular != null && regular !== found.paid ? regular : null),
  };
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
  later(() => processTextJob(jobIdFinal, chatId, text.slice(0, 2000)));
}

/** Erkennung, Recherche und erste Rückfrage (läuft per later(); exportiert für Tests). */
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
    // Spirituose (bzw. unsicher): keine Wein-Recherche; Recherche der Spirituose nach dem Einbuchen.
    const spirit = await spiritStart(db, proposal, parsed.spirit, known);
    proposal = spirit.proposal;
    // Ein Durchgang für alles, was fehlt – auch bei bekannten Weinen (deren Lücken).
    const web =
      spirit.spirit || spirit.unsure
        ? null
        : await enrichFromWeb(proposal).catch((error) => {
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

    const grapes = spirit.spirit || spirit.unsure ? { shares: proposal.grape_shares, source: null, sources: [] as string[] } : await resolveGrapes(db, proposal, known?.id ?? null, web ? web.grapes : undefined);
    proposal = { ...proposal, grape_shares: grapes.shares };

    const p = parsed.purchase;
    const gift = giftInText(text);
    const prices = textPurchasePrices(text, p);
    const restockCandidate = known ? await inStock(db, known.id, proposal.vintage_year) : false;
    const base: IngestState = {
      step: "researching",
      source: "text",
      ...spirit.patch,
      proposal,
      grape_source: grapes.source,
      recognition: { ...enriched, sources: [...enriched.sources, ...grapes.sources].slice(0, 8) },
      drink_from_year: drink.from,
      drink_until_year: drink.until,
      // Ablaufdatum aus dem Text (eindeutig im Text, sonst die Erkennung).
      ...bestBeforeState((bestBeforeInText(text) && toBestBeforeValue(bestBeforeInText(text)!)) ?? parsed.bestBefore),
      ...(p.storage_room ? { storage_room: p.storage_room } : {}),
      ...(Number.isInteger(p.quantity) && p.quantity > 0 && p.quantity <= 999
        ? { quantity: p.quantity }
        : quantityInText(text)
          ? { quantity: quantityInText(text)! }
          : {}),
      // Preise aus dem Text: 0, negativ oder ungültig = nicht genannt → Antoine fragt nach.
      ...(prices.paid != null ? { price: prices.paid } : {}),
      ...(prices.regular != null ? { regular_price: prices.regular } : {}),
      ...(p.vendor.trim() ? { vendor_name: p.vendor.trim().replace(/\s+/g, " ").slice(0, 80) } : {}),
      // Geschenk im Text („Geschenk von Marc“): direkt übernehmen, Preisfrage entfällt.
      ...(p.gift || gift
        ? giftPatch(cleanGiftFrom(p.gift_from) ?? gift?.from, positiveAmount(p.regular_price) ?? giftValueInText(text))
        : {}),
    };
    // Jahrgang zuerst: davon hängt ab, ob es ein Nachkauf ist.
    // Kein exakter Treffer, aber ein ähnlicher bestehender Wein: zuerst „Meinst du …?“
    const similar = known ? [] : await findSimilarWines(db, proposal.name, proposal.producer);
    const step: IngestStep = similar.length ? "similar" : restockCandidate && !needsVintage(base) ? "restock" : textStep(base);
    const vendors = step === "vendor" ? await listVendors(db) : [];
    const mains = step === "category_main" ? await mainOptions(db).catch(() => [] as SpiritCategory[]) : [];
    const state: IngestState = {
      ...base,
      step,
      ...(step === "vendor" ? { vendor_options: vendors.map((v) => v.id) } : {}),
      ...(step === "category_main" ? { category_options: mains.map((c) => c.id) } : {}),
      ...(similar.length ? { similar_ids: similar.map((w) => w.id) } : {}),
    };

    const { data: job, error } = await db
      .from("ingest_jobs")
      .update({ status: "needs_review", extracted: toJson(state), matched_wine_id: known?.id ?? null })
      .eq("id", jobId)
      .select("*")
      .single();
    if (error) throw error;

    await sendMessage(chatId, wineSummaryLines(state).join("\n"));
    if (step === "similar") {
      await askSimilar(chatId, jobId, similar);
    } else if (step === "restock") {
      await sendMessage(
        chatId,
        T.restockAskOrRename,
        restockKeyboard(jobId),
      );
    } else if (step === "producer") {
      await sendMessage(chatId, T.producerAsk, cancelKeyboard(jobId));
    } else {
      await askFor(job, chatId, vendors, mains);
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
    const stocked = Boolean(job.matched_wine_id) && (await inStock(db, job.matched_wine_id!, year));
    // Wein schon bestätigt („Ja, dieser“): Nachkauf ohne weitere Frage.
    if (stocked && state.wine_confirmed) patch.restock = true;
    else if (stocked) {
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
  const cleaned = producer.replace(/\s+/g, " ").trim().slice(0, 120);
  // Nur Stufe („Reserva“) → jetzt mit Marke („Legaris Reserva“).
  let proposal: WineProposal = { ...state.proposal, name: completeWineName(state.proposal.name, cleaned), producer: cleaned };
  const known = await findWine(db, proposal.name, proposal.producer);
  if (known) proposal = mergeWithKnownWine(proposal, known);
  const similar = known || state.new_wine ? [] : await findSimilarWines(db, proposal.name, proposal.producer);
  if (similar.length) {
    const next = await advanceJob(db, job, "producer", { step: "similar", proposal, similar_ids: similar.map((w) => w.id) });
    if (next) await askSimilar(chatId, job.id, similar);
    return;
  }
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

// ---------------------------------------------------------------------------
// Ähnlicher bestehender Wein („Meinst du …?“)

/** Text-Erfassung: nächster Schritt nach dem Abgleich – Jahrgang, Produzent, dann die Kaufangaben. */
function textStep(state: IngestState): IngestStep {
  if (needsVintage(state)) return "vintage";
  if (!state.proposal.producer) return "producer";
  return nextPurchaseStep(state);
}

async function askSimilar(chatId: number, jobId: string, wines: { name: string; producer: string | null }[]) {
  const text = wines.length === 1 ? T.similarOne(escapeHtml(similarLabel(wines[0]))) : T.similarMany();
  await sendMessage(chatId, text, similarKeyboard(jobId, wines));
}

/**
 * Antwort auf „Meinst du …?“: index = gewählter bestehender Wein (→ dessen Name und Produzent,
 * als Nachkauf, wenn er mit dem Jahrgang im Bestand liegt), null = „Nein, neuer Wein“.
 */
export async function chooseSimilar(db: AdminClient, job: IngestJob, chatId: number, index: number | null) {
  const state = jobState(job)!;
  const id = index == null ? null : state.similar_ids?.[index];
  if (index != null && !id) return null;
  const { data: wine, error } = id ? await db.from("wines").select("*").eq("id", id).maybeSingle() : { data: null, error: null };
  if (error) throw error;

  const proposal = wine ? mergeWithKnownWine(state.proposal, wine) : state.proposal;
  const patch: Partial<IngestState> = { proposal, similar_ids: undefined, ...(wine ? { wine_confirmed: true } : { new_wine: true }) };
  const columns = { matched_wine_id: wine?.id ?? null };

  if (state.source !== "text") {
    const next = await advanceJob(db, job, "similar", { ...patch, step: "review" }, columns);
    if (next) await sendMessage(chatId, proposalMessage(jobState(next)!, Boolean(wine), await summaryExtras(db, wine?.id ?? null, jobState(next)!)), reviewKeyboard(job.id));
    return next;
  }
  if (wine && !needsVintage({ ...state, ...patch })) patch.restock = await inStock(db, wine.id, proposal.vintage_year);
  const merged: IngestState = { ...state, ...patch };
  const step = textStep(merged);
  const vendors = step === "vendor" ? await listVendors(db) : [];
  const next = await advanceJob(db, job, "similar", { ...patch, step, ...(step === "vendor" ? { vendor_options: vendors.map((v) => v.id) } : {}) }, columns);
  if (!next) return null;
  if (step === "producer") await sendMessage(chatId, T.producerAsk, cancelKeyboard(job.id));
  else await askFor(next, chatId, vendors);
  return next;
}

// ---------------------------------------------------------------------------
// Ablaufdatum (Mindesthaltbarkeit) vom Etikett

/**
 * Ablaufdatum in den Zustand: best_before und Trinkfenster „bis“ = Jahr des Datums (das Etikett
 * geht der Recherche vor; „ab“ bleibt, wie es ist). Ohne Datum: ein früher daraus gesetztes
 * „bis“ fällt weg.
 */
export function bestBeforeState(value: string | null | undefined, before?: Pick<IngestState, "best_before" | "drink_until_year">): Partial<IngestState> {
  const bb = parseBestBefore(value);
  if (bb) return { best_before: toBestBeforeValue(bb), drink_until_year: bb.year };
  const old = parseBestBefore(before?.best_before);
  return { best_before: undefined, ...(old && before?.drink_until_year === old.year ? { drink_until_year: null } : {}) };
}

/** Bestehendes Trinkfenster „bis“ dieses Weins und Jahrgangs (null = keins bzw. neuer Wein). */
async function existingDrinkUntil(db: AdminClient, wineId: string | null, year: number | null) {
  if (!wineId) return null;
  let q = db.from("wine_vintages").select("*").eq("wine_id", wineId);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

/**
 * Hinweise für die Zusammenfassung aus der DB: das gespeicherte Trinkfenster eines bekannten
 * Weins (falls der Vorschlag keins hat; Schätzung mit „≈“, „bald trinken“ / „über dem Höhepunkt“)
 * und – mit Ablaufdatum – ein schon anders gefülltes Trinkfenster, das bleibt.
 */
export async function summaryExtras(db: AdminClient, wineId: string | null, state: IngestState): Promise<string[]> {
  const bb = parseBestBefore(state.best_before);
  const existing = await existingDrinkUntil(db, wineId, state.proposal.vintage_year).catch(() => null);
  if (!bb) {
    const own = state.drink_from_year != null || state.drink_until_year != null;
    const text = own ? null : drinkWindowText(existing?.drink_from_year ?? null, existing?.drink_until_year ?? null, existing?.drink_window_source);
    if (!text) return [];
    const hint = drinkWindowHint(existing?.drink_until_year ?? null);
    return [`⏳ Trinkreife ${escapeHtml(text)}${existing?.drink_window_source === "estimate" ? " (geschätzt)" : ""}${hint ? ` – ${hint}` : ""}`];
  }
  const until = existing?.drink_until_year ?? null;
  const from = existing?.drink_from_year ?? null;
  if (until != null && until !== bb.year) return [T.bestBeforeKeepsUntil(until, formatBestBefore(bb))];
  if (until == null && from != null && from > bb.year) return [T.bestBeforeKeepsFrom(from, formatBestBefore(bb))];
  return [];
}

/**
 * Beim Einbuchen: „bis“ = Jahr des Ablaufdatums (nur wenn leer und mit „ab“ verträglich) und
 * „Haltbar bis …“ an die Notiz des Jahrgangs hängen – auch ohne Jahrgang (NV). Nie überschreiben.
 */
export async function storeBestBefore(db: AdminClient, wineId: string, state: IngestState) {
  const bb = parseBestBefore(state.best_before);
  if (!bb) return;
  const year = state.proposal.vintage_year;
  try {
    let q = db.from("wine_vintages").select("*").eq("wine_id", wineId);
    q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw error;
    const notes = appendNote(row?.notes, bestBeforeSentence(bb));
    const fits = row?.drink_from_year == null || row.drink_from_year <= bb.year;
    const fill = row?.drink_until_year == null && fits;
    const until = fill ? bb.year : (row?.drink_until_year ?? null);
    // Herkunft „label“ nur, wenn das Etikett das Trinkfenster bestimmt; sonst bleibt die bisherige.
    const keep = row ? asDrinkSource((row as { drink_window_source?: unknown }).drink_window_source) : null;
    await saveVintageWindow(
      db,
      { rowId: row?.id ?? null, wineId, year },
      { drink_from_year: row?.drink_from_year ?? null, drink_until_year: until, notes },
      fill ? "label" : keep,
      fill ? bestBeforeSentence(bb) : ((row as { drink_window_note?: string | null } | null)?.drink_window_note ?? null),
    );
  } catch (error) {
    // Die Flasche ist gespeichert; Ablaufdatum lässt sich in der App nachtragen.
    console.error("storing best before failed", error);
  }
}
