import "server-only";

// Preis beim Einbuchen suchen („🔎 Such du“ bei Antoine): Preis pro Flasche in CHF bei Schweizer
// Händlern – genau dieser Wein bzw. diese Spirituose, gleicher Jahrgang, gleiche Flaschengrösse.
// Quellen: zuerst der Shop des genannten Händlers, dann die bekannten Schweizer Shops
// (SHOP_DOMAINS), dann die Websuche eingeschränkt auf Schweizer Händler (.ch, CHF). Zeigt ein Shop
// Aktions- und Normalpreis, gilt der Normalpreis.
//   Treffer (Jahrgang und Grösse gleich) → direkt in die Charge (nur leere Felder; price_source
//     research, price_note), Antoine meldet ihn mit „✏️ Ändern“.
//   Nur anderer Jahrgang bzw. andere Grösse → nichts speichern, Antoine fragt „Übernehmen?“.
//   Nichts → Antoine fragt nach dem Preis (wie beim Einbuchen).
// Läuft im Hintergrund als research_jobs-Auftrag „price“ (ohne Migration direkt nach der Antwort).

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { webResearch } from "@/lib/ingest/recognize";
import { apiProblem } from "@/lib/ai/api-errors";
import { T } from "@/lib/bot/texts";
import { formatMoney, todayIso } from "@/lib/format";
import { later } from "@/lib/later";
import { sendMessage } from "@/lib/telegram/api";
import type { TgInlineKeyboard } from "@/lib/telegram/types";
import { giftValueKeyboard, priceKeyboard, priceOfferKeyboard, regularPriceKeyboard } from "@/lib/ingest/messages";
import type { IngestState, IngestStep, PriceOffer } from "@/lib/ingest/schema";
import { findShopPages, shopDocuments, shopPagesNote } from "./shops";
import { SHOP_DOMAINS } from "./shops/match";
import type { ResearchOutcome } from "./wine";
export { priceNoteHint } from "./price-note";

type Db = SupabaseClient<Database>;
export type PriceMode = "both" | "regular";

export const PriceSchema = z.object({
  found: z.boolean().describe("true nur, wenn ein Schweizer Händler genau diesen Wein bzw. diese Spirituose mit Preis in CHF anbietet"),
  same_wine: z.boolean().describe("true nur, wenn Name und Produzent genau passen"),
  merchant: z.string().describe("Name des Händlers, z. B. „Mövenpick“; leer ohne Fund"),
  url: z.string().describe("Adresse der Produktseite (https://…); leer ohne Fund"),
  currency: z.string().describe("Währung des Preises, z. B. „CHF“"),
  price: z.number().describe("Aktueller Verkaufspreis pro Flasche; 0 = keiner"),
  regular_price: z.number().describe("Normalpreis pro Flasche, falls der Shop einen Aktionspreis zeigt („statt“, durchgestrichen); sonst 0"),
  vintage: z.number().describe("Jahrgang des Angebots; 0 = ohne Jahrgang"),
  size_ml: z.number().describe("Flaschengrösse des Angebots in ml (75 cl = 750); 0 = nicht genannt"),
  quote: z.string().describe("Wörtliches Zitat mit dem Preis (≤ 20 Wörter); leer ohne Fund"),
});
export type PriceRaw = z.infer<typeof PriceSchema>;

export type PriceFinding =
  | { kind: "exact"; amount: number; merchant: string; url: string; year: number | null; sizeMl: number }
  | { kind: "other"; amount: number; merchant: string; url: string; year: number | null; sizeMl: number }
  | { kind: "none" };

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Schweizer Händler: Domain .ch bzw. einer der bekannten Schweizer Shops (moevenpick-wein.com). */
export function swissMerchantUrl(url: string) {
  const host = hostOf(url);
  return host != null && (host.endsWith(".ch") || SHOP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)));
}

/** Übliche Grösse, wenn das Angebot keine nennt (Wein 75 cl, Spirituose 70 cl). */
const standardSize = (type: string | null | undefined) => (type === "spirit" ? 700 : 750);

/**
 * Antwort prüfen (rein): nur CHF, nur Schweizer Händler (https), passender Wein, Betrag plausibel.
 * Aktions- und Normalpreis → der Normalpreis. Jahrgang und Grösse gleich → exact, sonst other.
 */
export function evaluatePrice(raw: PriceRaw | null, want: { year: number | null; sizeMl: number | null; type?: string | null }): PriceFinding {
  if (!raw || !raw.found || !raw.same_wine) return { kind: "none" };
  if (raw.currency.trim().toUpperCase() !== "CHF" || !swissMerchantUrl(raw.url) || !raw.quote.trim()) return { kind: "none" };
  const amount = raw.regular_price > raw.price ? raw.regular_price : raw.price;
  if (!(amount > 0 && amount < 100_000)) return { kind: "none" };
  const size = want.sizeMl ?? standardSize(want.type);
  const offerSize = raw.size_ml > 0 ? Math.round(raw.size_ml) : standardSize(want.type);
  const year = raw.vintage > 0 ? Math.round(raw.vintage) : null;
  const finding = { amount: Math.round(amount * 100) / 100, merchant: raw.merchant.trim() || hostOf(raw.url)!, url: raw.url, year, sizeMl: offerSize };
  return year === want.year && offerSize === size ? { kind: "exact", ...finding } : { kind: "other", ...finding };
}

export type PriceWine = { name: string; producer: string | null; type: string | null; country: string | null; region: string | null; appellation: string | null };

/** Shop-Seiten und Websuche. Fehler (auch API-Limit) werden weitergegeben. */
export async function researchPrice(wine: PriceWine, year: number | null, sizeMl: number | null, vendor: string | null): Promise<PriceFinding> {
  if (!wine.name) return { kind: "none" };
  const size = sizeMl ?? standardSize(wine.type);
  const pages = await findShopPages({ name: wine.name, producer: wine.producer, appellation: wine.appellation, region: wine.region, country: wine.country }, [year], {
    vendors: vendor ? [vendor] : [],
  }).catch(() => []);
  const raw = await webResearch({
    prompt: `Gesucht ist der Preis pro Flasche in CHF bei einem Schweizer Händler für: ${JSON.stringify({
      name: wine.name,
      produzent: wine.producer,
      art: wine.type === "spirit" ? "Spirituose" : "Wein",
      jahrgang: year ?? "ohne Jahrgang",
      flaschengroesse: clSize(size),
      land: wine.country,
      region: wine.region,
    })}
- Nur Schweizer Händler mit Preisen in CHF (Domain .ch bzw. moevenpick-wein.com). Keine ausländischen Shops, keine Preise in EUR oder anderen Währungen, keine Preisvergleichs- oder Auktionsseiten.
- Reihenfolge: ${vendor ? `zuerst der Shop von „${vendor}“ (falls es einen gibt), dann ` : ""}${SHOP_DOMAINS.join(", ")}, dann andere Schweizer Weinhändler (.ch).
- Genau dieser ${wine.type === "spirit" ? "Spirituose" : "Wein"} (Name und Produzent), möglichst ${year != null ? `Jahrgang ${year}` : "ohne Jahrgang"} und ${clSize(size)}. Gibt es das nur in einem anderen Jahrgang bzw. einer anderen Grösse, melde diesen mit seinem Jahrgang und seiner Grösse.
- Zeigt der Shop einen Aktionspreis und einen Normalpreis („statt“, durchgestrichen), gib beide an: price = Aktionspreis, regular_price = Normalpreis.
- Preis pro Flasche (nicht pro Karton). Nichts gefunden: found false, Rest leer bzw. 0.${shopPagesNote(pages)}`,
    toolName: "report_price",
    toolDescription: "Meldet den gefundenen Preis pro Flasche in CHF mit Händler und Quelle.",
    schema: PriceSchema,
    maxSearches: 4,
    pages: shopDocuments(pages),
  });
  return evaluatePrice(raw, { year, sizeMl: size, type: wine.type });
}

/** Spalten fehlen (Migration noch nicht eingespielt)? */
const missingColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST204", "42703"].includes(error.code ?? "") || /price_(source|note)/.test(error.message ?? ""));

type PriceValues = { purchase_price?: number | null; regular_price?: number | null; is_gift?: boolean; gift_from?: string | null };

/**
 * Preise einer Charge setzen, mit Herkunft (manual/research) und Notiz. onlyEmpty: nur Felder,
 * die noch leer sind (recherchierte Preise überschreiben nie eingegebene). Vor der Migration ohne
 * Herkunft. Gibt zurück, ob etwas geändert wurde.
 */
export async function updateItemPrices(db: Db, itemId: string, values: PriceValues, source: "manual" | "research", note: string | null, onlyEmpty = false) {
  let changes = values;
  if (onlyEmpty) {
    const { data: item, error } = await db.from("inventory_items").select("purchase_price, regular_price").eq("id", itemId).maybeSingle();
    if (error) throw error;
    if (!item) return false;
    changes = Object.fromEntries(Object.entries(values).filter(([k]) => item[k as "purchase_price" | "regular_price"] == null));
    if (!Object.keys(changes).length) return false;
  }
  const write = (v: Database["public"]["Tables"]["inventory_items"]["Update"]) => {
    let q = db.from("inventory_items").update(v).eq("id", itemId);
    // Gleichzeitig von Hand gesetzt? Dann nichts überschreiben.
    if (onlyEmpty) for (const k of Object.keys(changes) as ("purchase_price" | "regular_price")[]) q = q.is(k, null);
    return q.select("id");
  };
  let { data, error } = await write({ ...changes, price_source: source, price_note: note });
  if (missingColumn(error)) ({ data, error } = await write(changes));
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Flaschengrösse wie auf dem Etikett: „75 cl“, „150 cl“. */
export const clSize = (ml: number | null | undefined) => (ml ? `${Math.round(ml / 10)} cl` : null);

/** „Mövenpick, 2019, 75 cl“ */
export const offerDetails = (o: { merchant: string; year: number | null; sizeMl?: number | null; size_ml?: number | null }) =>
  [o.merchant, o.year ?? "ohne Jahrgang", clSize(o.sizeMl ?? o.size_ml)].filter(Boolean).join(", ");

/** price_note: „Mövenpick · 2019 · 75 cl · 29.10.2026 · https://…“ */
export const priceNote = (o: { merchant: string; year: number | null; sizeMl?: number | null; size_ml?: number | null; url: string }) => {
  const [y, m, d] = todayIso().split("-");
  return [o.merchant, o.year ?? "ohne Jahrgang", clSize(o.sizeMl ?? o.size_ml), `${d}.${m}.${y}`, o.url].filter(Boolean).join(" · ").slice(0, 500);
};

const money = (v: number) => formatMoney(v, "CHF")!;

/** „✏️ Ändern“ unter der Meldung: die normalen Preisfragen für diese Charge (pr:fix:<charge>:<b|r>). */
export const priceFixKeyboard = (itemId: string, mode: PriceMode): TgInlineKeyboard => ({
  inline_keyboard: [[{ text: "✏️ Ändern", callback_data: `pr:fix:${itemId}:${mode === "both" ? "b" : "r"}` }]],
});
export const isPriceCallback = (data: string | undefined) => /^pr:fix:[0-9a-f-]{36}:[br]$/.test(data ?? "");
export function parsePriceCallback(data: string | undefined): { itemId: string; mode: PriceMode } | null {
  const m = (data ?? "").match(/^pr:fix:([0-9a-f-]{36}):([br])$/);
  return m ? { itemId: m[1], mode: m[2] === "b" ? "both" : "regular" } : null;
}

type ItemRow = {
  id: string;
  wine_id: string;
  vintage_year: number | null;
  bottle_size_ml: number | null;
  quantity: number;
  purchase_price: number | null;
  regular_price: number | null;
  is_gift: boolean;
  gift_from: string | null;
  vendor: { name: string | null } | null;
  wine: (PriceWine & { name: string }) | null;
};

async function loadItem(db: Db, itemId: string): Promise<ItemRow | null> {
  const { data, error } = await db
    .from("inventory_items")
    .select("id, wine_id, vintage_year, bottle_size_ml, quantity, purchase_price, regular_price, is_gift, gift_from, vendor:vendors(name), wine:wines(name, producer, type, country, region, appellation)")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as ItemRow | null;
}

/**
 * Preis-Rückfrage als eigene kleine Erfassung zur schon gespeicherten Charge (ingest_jobs): die
 * Antworten laufen durch die normalen Preisschritte und ändern danach nur die Preise der Charge.
 */
export async function startPriceFollowup(
  db: Db,
  chatId: number,
  item: ItemRow,
  mode: PriceMode,
  step: IngestStep,
  extra: Partial<IngestState> = {},
) {
  const state = {
    step,
    source: "text",
    proposal: { name: item.wine?.name ?? "", producer: item.wine?.producer ?? null, vintage_year: item.vintage_year, type: item.wine?.type ?? null },
    recognition: { model: "", confidence: 1, notes: null, enriched_fields: [], sources: [] },
    quantity: item.quantity,
    price_followup: { item_id: item.id },
    // Nur den Normalpreis: der bezahlte Preis bzw. das Geschenk bleibt, wie es ist.
    ...(mode === "regular" ? { price: item.purchase_price, ...(item.is_gift ? { is_gift: true, gift_from: item.gift_from } : {}) } : {}),
    ...extra,
  } as unknown as IngestState;
  // Ältere Preis-Rückfragen zur selben Charge verfallen.
  await db.from("ingest_jobs").update({ status: "discarded" }).eq("telegram_chat_id", chatId).eq("status", "needs_review").eq("inventory_item_id", item.id);
  const { data, error } = await db
    .from("ingest_jobs")
    .insert({ source: "text", telegram_chat_id: chatId, status: "needs_review", extracted: state as unknown as Json, inventory_item_id: item.id, matched_wine_id: item.wine_id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Normale Preisfrage zur Charge stellen (nach „✏️ Ändern“, „Selbst eingeben“ bzw. ohne Fund). */
export async function askPrice(db: Db, chatId: number, item: ItemRow, mode: PriceMode, text?: string) {
  if (mode === "both") {
    const jobId = await startPriceFollowup(db, chatId, item, mode, "price");
    await sendMessage(chatId, text ?? T.pricePaid(item.quantity === 1 ? "1 Flasche" : `${item.quantity} Flaschen`), priceKeyboard(jobId, false));
    return;
  }
  const jobId = await startPriceFollowup(db, chatId, item, mode, "regular_price");
  const keyboard = item.is_gift ? giftValueKeyboard(jobId, false) : regularPriceKeyboard(jobId, null, false);
  await sendMessage(chatId, text ?? (item.is_gift ? T.giftValueAsk() : T.regularPrice()), keyboard);
}

/** „✏️ Ändern“ bzw. „Selbst eingeben“ für eine Charge. */
export async function askPriceForItem(db: Db, chatId: number, itemId: string, mode: PriceMode) {
  const item = await loadItem(db, itemId);
  if (!item) return false;
  await askPrice(db, chatId, item, mode);
  return true;
}

/** Gefundenen (bzw. übernommenen) Preis in die Charge – nur leere Felder, Herkunft research. */
export async function storeFoundPrice(db: Db, itemId: string, offer: { amount: number; merchant: string; url: string; year: number | null; sizeMl?: number | null; size_ml?: number | null }, mode: PriceMode) {
  const values = mode === "both" ? { purchase_price: offer.amount, regular_price: offer.amount } : { regular_price: offer.amount };
  return updateItemPrices(db, itemId, values, "research", priceNote(offer), true);
}

export type PriceJobParams = { item_id: string; mode: PriceMode; chat_id: number };

/** Preissuche für eine Charge ausführen und Antoine melden lassen (Auftrag „price“). */
export async function runPriceSearch(db: Db, p: PriceJobParams): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const done = (filled: string[] = []): ResearchOutcome => ({ status: filled.length ? "filled" : "nothing", filled, suggested: 0, seconds: seconds() });
  try {
    const item = await loadItem(db, p.item_id);
    if (!item?.wine) return done();
    // Schon von Hand ausgefüllt (z. B. inzwischen in der App)? Dann nichts suchen.
    const empty = p.mode === "both" ? item.purchase_price == null || item.regular_price == null : item.regular_price == null;
    if (!empty) return done();
    const finding = await researchPrice(item.wine, item.vintage_year, item.bottle_size_ml, item.vendor?.name ?? null);
    if (finding.kind === "exact") {
      const saved = await storeFoundPrice(db, item.id, finding, p.mode);
      if (!saved) return done();
      await sendMessage(p.chat_id, T.priceFound(money(finding.amount), offerDetails(finding), p.mode === "regular"), priceFixKeyboard(item.id, p.mode));
      return done([`${p.mode === "regular" ? "Normalpreis" : "Preis"} ${money(finding.amount)} (${offerDetails(finding)})`]);
    }
    if (finding.kind === "other") {
      const offer: PriceOffer = { amount: finding.amount, merchant: finding.merchant, url: finding.url, year: finding.year, size_ml: finding.sizeMl, mode: p.mode };
      const jobId = await startPriceFollowup(db, p.chat_id, item, p.mode, "price_offer", { price_offer: offer });
      const what = finding.year !== item.vintage_year ? (finding.year != null ? `Jahrgang ${finding.year}` : "ohne Jahrgang") : clSize(finding.sizeMl) ?? "andere Grösse";
      await sendMessage(p.chat_id, T.priceOther(what, money(finding.amount), finding.merchant), priceOfferKeyboard(jobId));
      return done();
    }
    await askPrice(db, p.chat_id, item, p.mode, p.mode === "both" ? T.priceNotFound : T.regularNotFound);
    return done();
  } catch (error) {
    const problem = apiProblem(error);
    console.error("price research failed", p.item_id, problem?.message ?? (error instanceof Error ? error.message : error));
    return { status: "error", filled: [], suggested: 0, seconds: seconds(), error: problem ?? { kind: "other", message: "Die Preissuche ist fehlgeschlagen." } };
  }
}

/**
 * Nach dem Speichern einplanen: Auftrag „price“ in research_jobs (Worker im Hintergrund). Ohne
 * Migration (Tabelle bzw. Auftragsart fehlt): direkt nach der Antwort ausführen.
 */
export async function schedulePriceSearch(db: Db, p: { wineId: string; itemId: string; chatId: number; mode: PriceMode; personId: string | null }) {
  const params: PriceJobParams = { item_id: p.itemId, mode: p.mode, chat_id: p.chatId };
  try {
    const { enqueueRun, kickWorker } = await import("./jobs");
    const queued = await enqueueRun(db, [{ wineId: p.wineId, kind: "price", params }], p.personId);
    if ("runId" in queued) {
      kickWorker();
      return;
    }
  } catch (error) {
    // Auftragsart „price“ vor der Migration (Check) – dann direkt.
    if ((error as { code?: string } | null)?.code !== "23514") console.error("price search enqueue failed", error);
  }
  later(async () => {
    const outcome = await runPriceSearch(db, params);
    if (outcome.error) console.error("price search failed", p.itemId, outcome.error.message);
  });
}
