import "server-only";

// Preis beim Einbuchen suchen (🤷 (Preis suchen) bei Antoine): Preis pro Flasche in CHF bei Schweizer
// Händlern – genau dieser Wein bzw. diese Spirituose, gleicher Jahrgang, gleiche Flaschengrösse.
// Ablauf: direkte Suchen in Schweizer Shops (parallel, DIRECT_SHOPS) → Websuche mit Standort Schweiz
// und festen Suchbegriffen (Marke + Name, price-search.ts) → eigene Prüfung der Produktseiten aus
// allen Suchergebnissen, auch ohne Zusage des Modells. Zeigt ein Shop Aktions- und Normalpreis, gilt
// der Normalpreis; mehrere Händler mit exaktem Treffer → häufigster bzw. mittlerer Preis.
//   Treffer (Jahrgang und Grösse gleich) → direkt in die Charge (nur leere Felder; price_source
//     research, price_note), Antoine meldet ihn mit „✏️ Ändern“.
//   Nur anderer Jahrgang bzw. andere Grösse → nichts speichern, Antoine fragt „Übernehmen?“.
//   Nichts → Antoine fragt nach dem Preis (wie beim Einbuchen).
// Läuft im Hintergrund als research_jobs-Auftrag „price“; params.dry_run = Testlauf ohne Speichern/Senden.

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { webResearch } from "@/lib/ingest/recognize";
import { apiProblem } from "@/lib/ai/api-errors";
import { T } from "@/lib/bot/texts";
import { formatMoney, todayIso } from "@/lib/format";
import { later } from "@/lib/later";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { typeEmoji } from "@/lib/chat/menu-view";
import type { TgInlineKeyboard } from "@/lib/telegram/types";
import { giftValueKeyboard, priceKeyboard, priceOfferKeyboard, regularPriceKeyboard } from "@/lib/ingest/messages";
import type { IngestState, IngestStep, PriceOffer } from "@/lib/ingest/schema";
import { createGetter, findShopPages, shopDocuments, shopPagesNote } from "./shops";
import type { Get } from "./shops/adapters";
import { offerFromShopify, productPage, qualifierMismatch, sameProduct, shopifyDataUrl, sizeFromText, swissPage, yearFromText, type Mismatch, type PageRead, type ProductOffer } from "./price-match";
import {
  brandPageHits,
  compactSearches,
  directShopsFor,
  duplicateQueries,
  hostOf,
  htmlSearchHits,
  pickBest,
  priceQueries,
  productTerm,
  rankHits,
  searchLog,
  searchTitles,
  shopSearchTerms,
  shopifySuggestHits,
  shortUrl,
  swissMerchantUrl,
  swissResultUrls,
  type DirectShop,
  type SearchLog,
} from "./price-search";
import { SHOP_DOMAINS } from "./shops/match";
import type { ResearchOutcome } from "./wine";
export { priceNoteHint } from "./price-note";
export { swissMerchantUrl } from "./price-search";

type Db = SupabaseClient<Database>;
export type PriceMode = "both" | "regular";

export const PriceSchema = z.object({
  found: z.boolean().describe("true, wenn ein Schweizer Händler diesen Wein bzw. diese Spirituose mit Preis in CHF anbietet"),
  same_wine: z.boolean().describe("true, wenn es derselbe Wein bzw. dieselbe Spirituose ist (unterscheidende Namensteile gleich; Grössenangaben und Schreibweisen des Produzenten egal; Riserva/Reserva, Single Cask, Cask Strength, XO/VSOP/VS müssen übereinstimmen)"),
  product_title: z.string().describe("Titel des Angebots im Shop, wörtlich; leer ohne Fund"),
  merchant: z.string().describe("Name des Händlers, z. B. „Mövenpick“; leer ohne Fund"),
  url: z.string().describe("Adresse der Produktseite (https://…); leer ohne Fund"),
  currency: z.string().describe("Währung des Preises, z. B. „CHF“"),
  price: z.number().describe("Aktueller Verkaufspreis pro Flasche; 0 = keiner"),
  regular_price: z.number().describe("Normalpreis pro Flasche, falls der Shop einen Aktionspreis zeigt („statt“, durchgestrichen); sonst 0"),
  vintage: z.number().describe("Jahrgang des Angebots; 0 = ohne Jahrgang"),
  size_ml: z.number().describe("Flaschengrösse des Angebots in ml (75 cl = 750); 0 = nicht genannt"),
  quote: z.string().describe("Wörtliches Zitat mit dem Preis (≤ 20 Wörter); leer ohne Fund"),
  candidate_urls: z.array(z.string()).describe("Weitere Produktseiten Schweizer Shops, die passen könnten (https://…, höchstens 4); sonst leer"),
  reason: z.string().describe("Ein kurzer Satz: was gefunden bzw. warum nichts"),
});
export type PriceRaw = z.infer<typeof PriceSchema>;

/**
 * why: abweichender Zusatz („Angebot ohne Riserva“) – dann kein exakter Treffer. merchants: so
 * viele Händler mit exaktem Treffer (Preis = häufigster bzw. mittlerer).
 */
export type PriceOfferFound = {
  amount: number;
  merchant: string;
  url: string;
  year: number | null;
  sizeMl: number;
  why?: string;
  reason?: string;
  merchants?: number;
  /** Ausverkauft bzw. nicht lieferbar – Preis gilt, Vermerk im price_note. */
  soldOut?: boolean;
  /** Nur laut Modell (Seite selbst nicht lesbar). */
  source?: "model";
};
export type PriceFinding =
  | ({ kind: "exact" } & PriceOfferFound)
  | ({ kind: "other" } & PriceOfferFound)
  | { kind: "none"; reason?: string };

/** Übliche Grösse, wenn das Angebot keine nennt (Wein 75 cl, Spirituose 70 cl). */
const standardSize = (type: string | null | undefined) => (type === "spirit" ? 700 : 750);

export type PriceWant = { year: number | null; sizeMl: number | null; type?: string | null; name?: string; producer?: string | null };

/** Treffer bzw. anderer Jahrgang/andere Grösse (rein). Aktions- und Normalpreis → der Normalpreis. */
function finding(want: PriceWant, o: { price: number; regular: number | null; merchant: string; url: string; year: number | null; sizeMl: number | null; mismatch?: Mismatch; soldOut?: boolean }): PriceFinding {
  const amount = o.regular != null && o.regular > o.price ? o.regular : o.price;
  if (!(amount > 0 && amount < 100_000)) return { kind: "none", reason: "bad_amount" };
  const size = want.sizeMl ?? standardSize(want.type);
  const offerSize = o.sizeMl && o.sizeMl > 0 ? Math.round(o.sizeMl) : standardSize(want.type);
  const found = { amount: Math.round(amount * 100) / 100, merchant: o.merchant, url: o.url, year: o.year, sizeMl: offerSize, ...(o.soldOut ? { soldOut: true } : {}) };
  // Zusatz wie Riserva nur auf einer Seite: oft ein eigenes Produkt – nur mit Rückfrage.
  if (o.mismatch) return { kind: "other", ...found, why: o.mismatch.detail, reason: o.mismatch.reason };
  return o.year === want.year && offerSize === size ? { kind: "exact", ...found } : { kind: "other", ...found };
}

/**
 * Antwort des Modells prüfen (rein): nur CHF, nur Schweizer Händler (https), derselbe Wein (Modell
 * oder eigener Namensvergleich mit dem Titel), Beleg, Betrag plausibel. Ohne Treffer mit Grund
 * (not_found, not_same_wine, not_chf, not_swiss, no_quote, bad_amount).
 */
export function evaluatePrice(raw: PriceRaw | null, want: PriceWant): PriceFinding {
  if (!raw || !raw.found) return { kind: "none", reason: "not_found" };
  const compared = want.name && raw.product_title.trim() ? sameProduct({ name: want.name, producer: want.producer, year: want.year }, raw.product_title) : null;
  const same = raw.same_wine || compared?.same === true;
  if (!same) return { kind: "none", reason: "not_same_wine" };
  // Auch wenn das Modell „derselbe“ meint: Riserva o. Ä. nur auf einer Seite → nachfragen.
  const mismatch = compared?.same ? compared.mismatch : want.name && raw.product_title.trim() ? (qualifierMismatch(want.name, raw.product_title) ?? undefined) : undefined;
  if (raw.currency.trim().toUpperCase() !== "CHF") return { kind: "none", reason: "not_chf" };
  if (!swissMerchantUrl(raw.url)) return { kind: "none", reason: "not_swiss" };
  if (!raw.quote.trim()) return { kind: "none", reason: "no_quote" };
  return finding(want, {
    price: raw.price,
    regular: raw.regular_price > 0 ? raw.regular_price : null,
    merchant: raw.merchant.trim() || hostOf(raw.url)!,
    url: raw.url,
    year: raw.vintage > 0 ? Math.round(raw.vintage) : null,
    sizeMl: raw.size_ml,
    mismatch,
  });
}

/** Händlername aus der Adresse: „casapoli.ch“ → „Casapoli“, „piemont-weine.ch“ → „Piemont-weine“. */
const merchantFromUrl = (url: string) => {
  const host = hostOf(url) ?? "";
  const base = host.split(".").slice(-2, -1)[0] ?? host;
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : host;
};

/** Grösse bzw. Jahrgang aus der Adresse (Flaschenpost: „?_size=750&_vintage=2021“). */
const urlSize = (url: string) => Number(url.match(/[?&]_size=(\d{3,4})\b/)?.[1]) || null;
const urlYear = (url: string) => Number(url.match(/[?&]_vintage=((?:19|20)\d\d)\b/)?.[1]) || null;

/**
 * Produktseite eines Shops abrufen und lesen (Shopify-Daten, sonst die Seite): genau ein Produkt mit
 * Preis, eine Liste (Marken-/Kategorieseite, mehrere Produkte) oder nichts lesbar.
 */
export async function readPage(url: string, get: Get): Promise<PageRead> {
  const host = hostOf(url);
  if (!host) return { kind: "none" };
  const data = shopifyDataUrl(url);
  if (data) {
    const res = await get(data);
    if (res?.status === 200) {
      try {
        const offer = offerFromShopify(JSON.parse(res.text));
        if (offer) {
          // Shopify-Daten nennen keine Adresse: bei Shops ohne .ch die Seite selbst prüfen.
          if (swissMerchantUrl(url)) return { kind: "product", offer };
          const page = await get(url);
          return { kind: "product", offer: { ...offer, swiss: Boolean(page?.text && swissPage(page.text)) } };
        }
      } catch {
        // keine Shopify-Daten – die Seite selbst lesen
      }
    }
  }
  const page = await get(url);
  if (page?.status !== 200 || !page.text) return { kind: "none" };
  const read = productPage(page.text);
  // Grösse aus der Adresse (Flaschenpost „?_size=750“) gilt als Angabe der Seite.
  return read.kind === "product" && read.offer.sizeMl == null ? { kind: "product", offer: { ...read.offer, sizeMl: urlSize(url) ?? sizeFromText(decodeURIComponent(url)) } } : read;
}

/** Kurzform: das Angebot einer Produktseite, sonst null. */
export async function readOffer(url: string, get: Get): Promise<ProductOffer | null> {
  const read = await readPage(url, get);
  return read.kind === "product" ? read.offer : null;
}

export type DirectResult = { shop: string; result: "ok" | "no_hit" | "error"; urls?: string[]; /** Abfragen der Reihe nach */ queries?: string[]; /** Produkte von dieser Markenseite */ brandPage?: string };

export type PriceDiagnostics = {
  raw: Omit<PriceRaw, "quote" | "candidate_urls"> | null;
  verdict: string;
  pages: { url: string; result: string }[];
  /** Vorgegebene Suchbegriffe (Reihenfolge im Prompt). */
  planned?: string[];
  /** Tatsächlich ausgeführte Websuchen, in Reihenfolge, je mit den gefundenen Adressen (gekürzt). */
  queries?: string[];
  searches?: number;
  search_results?: { query: string; urls: string[]; error?: string }[];
  /** Direkte Shop-Suchen: ok (passender Treffer), no_hit, error. */
  direct?: DirectResult[];
  /** Websuchen mit demselben Begriff mehrmals (Gross/Klein egal): Begriff und Anzahl. */
  duplicates?: { query: string; count: number }[];
  /** Händler mit exaktem Treffer (Preis = häufigster bzw. mittlerer). */
  merchants?: number;
  /** Testlauf (dry_run): Ergebnis, ohne zu speichern oder zu senden. */
  finding?: PriceFinding;
};

/**
 * Gefundene Produktseiten selbst prüfen: genau ein Produkt (sonst „listing“), CHF, Schweizer
 * Händler, derselbe Wein laut dem Produktnamen der Seite. Ausverkauft: nur mit Grösse von der
 * Seite. Alle, parallel; Protokoll in Reihenfolge.
 */
async function verifyPages(urls: string[], want: PriceWant & { name: string }, get: Get, log: PriceDiagnostics["pages"]): Promise<PriceOfferFoundKind[]> {
  const results = await Promise.all(
    urls.map(async (url): Promise<{ result: string; found?: PriceOfferFoundKind }> => {
      const read = await readPage(url, get).catch((): PageRead => ({ kind: "none" }));
      if (read.kind === "listing") return { result: `listing:${read.reason}` };
      if (read.kind === "none") return { result: "no_price" };
      const offer = read.offer;
      if (offer.currency !== "CHF") return { result: "not_chf" };
      if (!swissMerchantUrl(url) && !offer.swiss) return { result: "not_swiss" };
      const same = sameProduct({ name: want.name, producer: want.producer, year: want.year }, offer.title, offer.vendor);
      if (!same.same) return { result: `not_same_wine:${same.reason}` };
      if (offer.soldOut && offer.sizeMl == null) return { result: "sold_out_no_size" };
      const f = finding(want, { price: offer.price, regular: offer.regular, merchant: merchantFromUrl(url), url, year: yearFromText(offer.title) ?? urlYear(url), sizeMl: offer.sizeMl, mismatch: same.mismatch, soldOut: offer.soldOut });
      const result = f.kind === "other" && f.reason ? `not_exact:${f.reason}` : f.kind;
      return { result: offer.soldOut && f.kind !== "none" ? `${result}:sold_out` : result, ...(f.kind === "none" ? {} : { found: f }) };
    }),
  );
  results.forEach((r, i) => log.push({ url: urls[i], result: r.result }));
  return results.flatMap((r) => (r.found ? [r.found] : []));
}

/**
 * Modellpreis als Treffer (Quelle „model“), wenn die eigene Prüfung genau diese Seite nicht lesen
 * konnte (no_price, z. B. Bot-Sperre oder Preis nur per JavaScript): CHF, Schweizer Händler,
 * wörtliches Zitat und ein Produkttitel, der laut eigenem Namensvergleich passt. Rein.
 */
export function modelFinding(raw: PriceRaw | null, want: PriceWant & { name: string }, pages: { url: string; result: string }[]): PriceOfferFoundKind | null {
  if (!raw?.found || !raw.url) return null;
  const checked = pages.find((p) => p.url === raw.url);
  if (checked && checked.result !== "no_price") return null;
  if (!raw.product_title.trim() || !sameProduct({ name: want.name, producer: want.producer, year: want.year }, raw.product_title).same) return null;
  const f = evaluatePrice(raw, want);
  return f.kind === "none" ? null : { ...f, source: "model" };
}
type PriceOfferFoundKind = Exclude<PriceFinding, { kind: "none" }>;

/** Zeitlimit je direkter Shop-Suche (alle parallel). */
export const DIRECT_TIMEOUT_MS = 6000;

/** Je Shop höchstens so viele Suchabfragen (Schreibweisen), bis zum ersten Treffer. */
export const MAX_SHOP_QUERIES = 3;
/** Produktlinks einer Markenseite: höchstens so viele prüfen. */
export const MAX_BRAND_PAGE_PRODUCTS = 5;

/**
 * Eine Shop-Suche: die Schreibweisen der Reihe nach (Name, ohne Apostroph, Apostroph als
 * Leerzeichen, Marke + Name – höchstens 3), bis passende Produkte kommen (höchstens 2). Liefert die
 * Suche nur eine Markenseite des Shops, deren Produktlinks (höchstens 5).
 */
async function searchShop(shop: DirectShop, want: { name: string; producer: string | null; year: number | null; sizeMl: number | null; type: string | null }, get: Get): Promise<DirectResult> {
  const queries: string[] = [];
  let reached = false;
  const brandPages: string[] = [];
  try {
    for (const term of shopSearchTerms(want).slice(0, MAX_SHOP_QUERIES)) {
      queries.push(term);
      const res = await get(shop.search(term));
      if (!res || res.status !== 200) continue;
      reached = true;
      let hits;
      if (shop.kind === "shopify") {
        try {
          hits = shopifySuggestHits(JSON.parse(res.text), shop.origin);
        } catch {
          continue;
        }
      } else {
        hits = htmlSearchHits(res.text, shop);
        for (const url of brandPageHits(res.text, shop, want)) if (!brandPages.includes(url)) brandPages.push(url);
      }
      const urls = rankHits(hits, want).map((h) => h.url);
      if (urls.length) return { shop: shop.id, result: "ok", urls, queries };
    }
    // Markenseite (z. B. drinks.ch/de/marken/noah-s-mill.html): deren Produkte prüfen.
    for (const page of brandPages.slice(0, 1)) {
      const res = await get(page);
      if (res?.status !== 200 || !res.text) continue;
      const urls = rankHits(htmlSearchHits(res.text, shop), want, MAX_BRAND_PAGE_PRODUCTS).map((h) => h.url);
      if (urls.length) return { shop: shop.id, result: "ok", urls, queries, brandPage: page };
    }
    return { shop: shop.id, result: reached ? "no_hit" : "error", queries };
  } catch {
    return { shop: shop.id, result: "error", queries };
  }
}

/** Direkte Suchen in den Schweizer Shops, parallel mit Zeitlimit. Wirft nie. */
export async function searchShops(want: { name: string; producer: string | null; year: number | null; sizeMl: number | null; type: string | null }, get: Get): Promise<DirectResult[]> {
  return Promise.all(directShopsFor(want.type).map((shop) => searchShop(shop, want, get)));
}

export type PriceWine = { name: string; producer: string | null; type: string | null; country: string | null; region: string | null; appellation: string | null };

/** So viele Websuchen darf das Modell für die Preissuche machen (die direkten Shop-Suchen liefern das meiste). */
export const PRICE_MAX_SEARCHES = 6;
/** So viele Adressen aus den Suchergebnissen prüft der Code selbst (dazu die gemeldeten). */
export const MAX_RESULT_URLS = 8;

/**
 * Preis suchen: zuerst direkt in Schweizer Shops (parallel), dann die Websuche (Standort Schweiz,
 * feste Suchbegriffe), dann die eigene Prüfung der gefundenen Adressen – auch wenn das Modell
 * nichts meldet. Bester Treffer: exakt vor „other“; mehrere exakte → häufigster bzw. mittlerer
 * Preis. Fehler (auch API-Limit) werden weitergegeben.
 */
export async function researchPrice(
  wine: PriceWine,
  year: number | null,
  sizeMl: number | null,
  vendor: string | null,
  options: { get?: Get } = {},
): Promise<{ finding: PriceFinding; diagnostics: PriceDiagnostics }> {
  const diagnostics: PriceDiagnostics = { raw: null, verdict: "no_name", pages: [] };
  if (!wine.name) return { finding: { kind: "none", reason: "no_name" }, diagnostics };
  const size = sizeMl ?? standardSize(wine.type);
  const want: PriceWant & { name: string } = { year, sizeMl: size, type: wine.type, name: wine.name, producer: wine.producer };
  // Eigenes Abruf-Budget (Shop-Suchen, Produktseiten); die Shop-Adapter haben ihr eigenes.
  const get = options.get ?? createGetter({ maxRequests: 60, timeoutMs: DIRECT_TIMEOUT_MS });
  const found: PriceOfferFoundKind[] = [];

  // 1. Direkte Shop-Suchen (dazu die Händlerseiten der Shop-Adapter als Beilage für das Modell).
  const [direct, pages] = await Promise.all([
    searchShops({ name: wine.name, producer: wine.producer, year, sizeMl: size, type: wine.type }, get),
    findShopPages({ name: wine.name, producer: wine.producer, appellation: wine.appellation, region: wine.region, country: wine.country }, [year], { vendors: vendor ? [vendor] : [] }).catch(() => []),
  ]);
  diagnostics.direct = direct.map((d) => ({ ...d, ...(d.urls ? { urls: d.urls.map(shortUrl) } : {}), ...(d.brandPage ? { brandPage: shortUrl(d.brandPage) } : {}) }));
  const directUrls = [...new Set(direct.flatMap((d) => d.urls ?? []))];
  if (directUrls.length) found.push(...(await verifyPages(directUrls, want, get, diagnostics.pages)));

  // 2. Websuche – nur, wenn die direkten Shop-Suchen keinen exakten Treffer liefern (spart Kosten).
  let raw: PriceRaw | null = null;
  const blocks: Parameters<typeof searchLog>[0] = [];
  const exactHosts = new Set(found.filter((f) => f.kind === "exact").map((f) => hostOf(f.url)));
  if (exactHosts.size === 0) {
    const planned = priceQueries({ name: wine.name, producer: wine.producer, year, sizeMl: size, vendor });
    diagnostics.planned = planned;
    raw = await webResearch({
      prompt: priceSearchPrompt(wine, year, size, vendor, planned) + shopPagesNote(pages),
      toolName: "report_price",
      toolDescription: "Meldet den gefundenen Preis pro Flasche in CHF mit Händler und Quelle.",
      schema: PriceSchema,
      maxSearches: PRICE_MAX_SEARCHES,
      maxRounds: 6,
      pages: shopDocuments(pages),
      onContent: (content) => blocks.push(...(content as unknown as typeof blocks)),
    });
    const searches: SearchLog[] = searchLog(blocks);
    diagnostics.queries = searches.map((x) => x.query.slice(0, 120));
    diagnostics.searches = searches.length;
    const repeated = duplicateQueries(diagnostics.queries);
    if (repeated.length) diagnostics.duplicates = repeated;
    diagnostics.search_results = compactSearches(searches);
    if (raw) {
      const { quote: _quote, candidate_urls: _candidates, ...rest } = raw;
      void _quote;
      void _candidates;
      diagnostics.raw = { ...rest, reason: rest.reason.slice(0, 300), product_title: rest.product_title.slice(0, 200) };
    }
    // 3. Eigene Prüfung: gemeldete Adressen, Schweizer Shops aus allen Suchergebnissen, Händlerseiten.
    const checked = new Set(diagnostics.pages.map((x) => x.url));
    const fromResults = swissResultUrls(searches, searchTitles(blocks), want, MAX_RESULT_URLS);
    const urls = [...new Set([raw?.url ?? "", ...(raw?.candidate_urls ?? []).slice(0, 4), ...fromResults, ...pages.map((x) => x.url)].filter((u) => hostOf(u) && !checked.has(u)))].slice(0, MAX_RESULT_URLS + 4);
    if (urls.length) found.push(...(await verifyPages(urls, want, get, diagnostics.pages)));
    // Seite nicht lesbar, Modell nennt Preis mit Zitat und passendem Titel → als Modell-Treffer.
    const fromModel = modelFinding(raw, want, diagnostics.pages);
    if (fromModel) found.push(fromModel);
  }

  const best = pickBest(found);
  if (best) {
    const { merchants, ...offer } = best;
    const result: PriceFinding = best.kind === "exact" && merchants > 1 ? { ...offer, kind: "exact", merchants } : offer;
    if (best.kind === "exact") diagnostics.merchants = merchants;
    const via = best.source === "model" ? "model" : "page";
    diagnostics.verdict = result.kind === "other" && result.reason ? `not_exact:${result.reason}` : `${result.kind}:${via}`;
    return { finding: result, diagnostics };
  }
  const result = evaluatePrice(raw, want);
  diagnostics.verdict = result.kind === "none" ? (result.reason ?? "none") : result.kind === "other" && result.reason ? `not_exact:${result.reason}` : `${result.kind}:answer`;
  return { finding: result, diagnostics };
}

/** Auftrag an das Modell: feste Suchbegriffe der Reihe nach, Regeln für Händler und Angebot. */
function priceSearchPrompt(wine: PriceWine, year: number | null, size: number, vendor: string | null, planned: string[]) {
  const spirit = wine.type === "spirit";
  const what = spirit ? "Spirituose" : "Wein";
  const same = spirit ? "Dieselbe Spirituose" : "Derselbe Wein";
  const other = spirit ? "keine andere Spirituose" : "keinen anderen Wein";
  return `Gesucht ist der Preis pro Flasche in CHF bei einem Schweizer Händler für: ${JSON.stringify({
    name: wine.name,
    produzent: wine.producer,
    suchname: productTerm(wine),
    art: what,
    jahrgang: year ?? "ohne Jahrgang",
    flaschengroesse: clSize(size),
    land: wine.country,
    region: wine.region,
    haendler_hinweis: vendor,
  })}
- Arbeite diese Suchanfragen genau so und der Reihe nach ab (eine nach der anderen, wörtlich), bis du eine Schweizer Produktseite mit CHF-Preis hast: ${planned.map((q) => `„${q}“`).join(", ")}.
- Jeden Suchbegriff nur einmal – nie denselben Begriff wiederholen. Bringen 2 Suchen keinen Schweizer Treffer, formuliere anders: Name + Kategorie (z. B. „Bourbon“, „Grappa“, „Rotwein“), Name + Grösse + „CHF“, andere Schreibweise. Nie den Händlernamen allein mit Teilen des Namens.
- Der Händler ist nur ein Hinweis, wo gekauft wurde (bei Ketten wie Coop, Denner, Migros, Galaxus oft nicht online) – das Angebot darf von jedem Schweizer Händler sein.
- Nur Schweizer Händler mit Preisen in CHF: Domain .ch bzw. moevenpick-wein.com, andere Domains nur, wenn die Seite CHF-Preise und eine Schweizer Adresse bzw. Versand aus der Schweiz zeigt. Keine ausländischen Shops, keine Preise in EUR oder anderen Währungen, keine Preisvergleichs- oder Auktionsseiten.
- Bekannte Schweizer Shops: ${SHOP_DOMAINS.join(", ")}, drinks.ch, casapoli.ch, flaschenpost.ch, piemont-weine.ch.
- ${same}: massgebend sind die unterscheidenden Teile des Namens und die Art – Gross-/Kleinschreibung, Grössenangaben im Titel („70 cl.“) und andere Schreibweisen des Produzenten (z. B. „Giovanni Poli“ statt „Giovannipoli“, Marke statt Firmenname) machen ${other}. Ein anderes Alter bzw. eine andere Reifezeit („18 mesi“ statt „36 mesi“) schon. Zusätze wie Riserva/Reserva/Reserve, Single Cask, Cask Strength, Vintage, XO/VSOP/VS bezeichnen oft ein eigenes Produkt: Steht so ein Zusatz nur beim gesuchten Namen oder nur im Angebot, melde das Angebot trotzdem (mit wörtlichem Titel), aber same_wine false.
- Möglichst ${year != null ? `Jahrgang ${year}` : "ohne Jahrgang"} und ${clSize(size)}. Gibt es das nur in einem anderen Jahrgang bzw. einer anderen Grösse, melde diesen mit seinem Jahrgang und seiner Grösse.
- Zeigt der Shop einen Aktionspreis und einen Normalpreis („statt“, durchgestrichen), gib beide an: price = Aktionspreis, regular_price = Normalpreis.
- Preis pro Flasche (nicht pro Karton). Gib den Titel des Angebots wörtlich an (product_title). Weitere passende Produktseiten Schweizer Shops in candidate_urls. Nichts gefunden: found false, Rest leer bzw. 0, reason kurz begründen.`;
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

/** „3 Händler“ – bei mehreren Händlern mit exaktem Treffer (Preis = häufigster bzw. mittlerer). */
const merchantCount = (o: { merchants?: number }) => (o.merchants && o.merchants > 1 ? `${o.merchants} Händler` : null);
/** „ausverkauft“ bzw. „laut Suche“ (Preis nur laut Modell). */
const offerFlags = (o: { soldOut?: boolean; source?: "model" }) => [o.soldOut ? "ausverkauft" : null, o.source === "model" ? "laut Suche" : null];

/** „Mövenpick, 2019, 75 cl“ bzw. „Drinks, ohne Jahrgang, 70 cl, 3 Händler“ */
export const offerDetails = (o: { merchant: string; year: number | null; sizeMl?: number | null; size_ml?: number | null; merchants?: number }) =>
  [o.merchant, o.year ?? "ohne Jahrgang", clSize(o.sizeMl ?? o.size_ml), merchantCount(o)].filter(Boolean).join(", ");

/** price_note: „Mövenpick · 2019 · 75 cl · 29.10.2026 · https://…“ (mehrere Händler: „· 3 Händler“ vor dem Datum). */
export const priceNote = (o: { merchant: string; year: number | null; sizeMl?: number | null; size_ml?: number | null; url: string; merchants?: number; soldOut?: boolean; source?: "model" }) => {
  const [y, m, d] = todayIso().split("-");
  return [o.merchant, o.year ?? "ohne Jahrgang", clSize(o.sizeMl ?? o.size_ml), merchantCount(o), ...offerFlags(o), `${d}.${m}.${y}`, o.url].filter(Boolean).join(" · ").slice(0, 500);
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
 * Die Flasche in jeder Preis-Meldung: „🥃 Marolo – Grappa di Barolo Riserva o. J., 70 cl (Geschenk
 * von Dad)“ – damit klar ist, zu welcher Charge eine Frage gehört. HTML-sicher.
 */
export function bottleLabel(item: Pick<ItemRow, "vintage_year" | "bottle_size_ml" | "is_gift" | "gift_from" | "wine">) {
  const w = item.wine;
  const name = [w?.producer, w?.name].filter(Boolean).join(" – ") || "Flasche";
  const gift = item.is_gift ? ` (Geschenk${item.gift_from ? ` von ${item.gift_from}` : ""})` : "";
  const size = clSize(item.bottle_size_ml ?? standardSize(w?.type));
  return `${typeEmoji(w?.type)} <b>${escapeHtml(name)}</b> ${item.vintage_year ?? "o. J."}${size ? `, ${size}` : ""}${escapeHtml(gift)}`;
}

/** Was eine Preis-Rückfrage fragt: nach der Suche ohne Fund, nach „Ändern“/„Selbst eingeben“ bzw. ein Angebot. */
type Ask = "not_found" | "fix" | "offer";

/**
 * Preis-Rückfrage als eigene kleine Erfassung zur schon gespeicherten Charge (ingest_jobs): die
 * Antworten laufen durch die normalen Preisschritte und ändern danach nur die Preise der Charge.
 * held: zurückgehalten (Schritt „price_held“), solange eine andere Erfassung läuft – fängt dann
 * keine Antworten ab und wird erst danach gestellt (releaseHeldPriceQuestions).
 */
export async function startPriceFollowup(
  db: Db,
  chatId: number,
  item: ItemRow,
  mode: PriceMode,
  step: IngestStep,
  ask: Ask,
  extra: Partial<IngestState> = {},
  held = false,
) {
  const state = {
    step: held ? "price_held" : step,
    source: "text",
    proposal: { name: item.wine?.name ?? "", producer: item.wine?.producer ?? null, vintage_year: item.vintage_year, type: item.wine?.type ?? null },
    recognition: { model: "", confidence: 1, notes: null, enriched_fields: [], sources: [] },
    quantity: item.quantity,
    price_followup: { item_id: item.id, label: bottleLabel(item), mode, ask, ...(held ? { held_step: step, held_at: new Date().toISOString() } : {}) },
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

/**
 * Frage zu einer (freigegebenen) Preis-Rückfrage senden – immer mit der Flasche. Nichts gefunden:
 * nur eine Meldung ohne Knöpfe (ein getippter Betrag wird noch gespeichert). Nach „✏️ Ändern“
 * startet 🤷 die Suche erneut.
 */
async function sendPriceQuestion(chatId: number, jobId: string, state: IngestState) {
  const f = state.price_followup!;
  const label = f.label ?? "";
  if (state.step === "price_offer" && state.price_offer) {
    const o = state.price_offer;
    if (o.why) {
      await sendMessage(chatId, T.priceOtherProduct(label, o.why, money(o.amount), o.merchant), priceOfferKeyboard(jobId));
      return;
    }
    const what = o.year !== state.proposal.vintage_year ? (o.year != null ? `Jahrgang ${o.year}` : "ohne Jahrgang") : clSize(o.size_ml) ?? "andere Grösse";
    await sendMessage(chatId, T.priceOther(label, what, money(o.amount), o.merchant), priceOfferKeyboard(jobId));
    return;
  }
  if (f.ask === "not_found") {
    await sendMessage(chatId, state.step === "price" ? T.priceNotFound(label) : T.regularNotFound(label));
    return;
  }
  const search = f.ask === "fix";
  if (state.step === "price") {
    await sendMessage(chatId, `${label}\n${T.pricePaid(state.quantity === 1 ? "1 Flasche" : `${state.quantity ?? 1} Flaschen`, undefined, search)}`, priceKeyboard(jobId, search));
    return;
  }
  const keyboard = state.is_gift ? giftValueKeyboard(jobId, search) : regularPriceKeyboard(jobId, null, search);
  await sendMessage(chatId, `${label}\n${state.is_gift ? T.giftValueAsk(undefined, search) : T.regularPrice(undefined, search)}`, keyboard);
}

type FlowRow = { id: string; source: string; status: string; extracted: unknown };

/**
 * Läuft im Chat gerade eine andere Erfassung (Foto, Text, Verkostet, Preis-Rückfrage …)? Nicht
 * gezählt: zurückgehaltene Preis-Rückfragen, schon gespeicherte Verkostet-Einträge und
 * Chat-Vorschläge mit Ja/Nein.
 */
async function otherFlowActive(db: Db, chatId: number) {
  const { openFlows, isSavedTasted } = await import("@/lib/chat/pending");
  const flows = (await openFlows(db as never, chatId)) as FlowRow[];
  return flows.some((j) => j.source !== "telegram_edit" && !isHeld(j) && !isSavedTasted(j as never));
}
const isHeld = (j: { status: string; extracted: unknown }) => j.status === "needs_review" && (j.extracted as { step?: string } | null)?.step === "price_held";

/** Preisfrage stellen – bzw. zurückhalten, solange eine andere Erfassung läuft. */
async function askOrHold(db: Db, chatId: number, item: ItemRow, mode: PriceMode, step: IngestStep, ask: Ask, extra: Partial<IngestState> = {}) {
  const held = await otherFlowActive(db, chatId);
  const jobId = await startPriceFollowup(db, chatId, item, mode, step, ask, extra, held);
  if (held) return;
  const { data } = await db.from("ingest_jobs").select("extracted").eq("id", jobId).maybeSingle();
  await sendPriceQuestion(chatId, jobId, data?.extracted as unknown as IngestState);
}

/** Längstens so lange wird eine Preis-Rückfrage zurückgehalten; danach verfällt sie mit Hinweis. */
export const HOLD_MAX_MS = 24 * 60 * 60 * 1000;

/** Seit wann zurückgehalten (held_at; ältere Einträge ohne: updated_at). */
const heldSince = (j: { extracted: unknown; updated_at?: string }) =>
  Date.parse(((j.extracted as IngestState | null)?.price_followup?.held_at ?? j.updated_at ?? "") as string);

/**
 * Länger als 24 Stunden zurückgehalten: verwerfen und einmal melden („Preis für … noch leer – du
 * kannst ihn jederzeit in der App oder hier nachtragen.“). Wirft nie.
 */
export async function expireHeldPriceQuestions(db: Db, chatId: number, now = Date.now()) {
  try {
    const { data, error } = await db
      .from("ingest_jobs")
      .select("id, extracted, updated_at")
      .eq("telegram_chat_id", chatId)
      .eq("status", "needs_review")
      .eq("extracted->>step", "price_held");
    if (error) throw error;
    for (const job of (data ?? []).filter((j) => heldSince(j) < now - HOLD_MAX_MS)) {
      const { data: closed, error: closeError } = await db
        .from("ingest_jobs")
        .update({ status: "discarded", error: "abgelaufen: 24 Std. zurückgehalten" })
        .eq("id", job.id)
        .eq("status", "needs_review")
        .select("id");
      if (closeError) throw closeError;
      if (closed?.length) await sendMessage(chatId, T.priceHeldExpired((job.extracted as unknown as IngestState).price_followup?.label ?? "die Flasche"));
    }
  } catch (error) {
    console.error("expire held price questions failed", error instanceof Error ? error.message : error);
  }
}

/**
 * Für alle Chats (Recherche-Worker, jede Minute): zu lange zurückgehaltene Preis-Rückfragen
 * verfallen lassen und wartende stellen, sobald keine andere Erfassung mehr läuft – auch wenn
 * niemand mehr schreibt (z. B. nachdem die andere Erfassung still verfallen ist). Wirft nie.
 */
export async function tickHeldPriceQuestions(db: Db, now = Date.now()) {
  try {
    const { data, error } = await db.from("ingest_jobs").select("telegram_chat_id").eq("status", "needs_review").eq("extracted->>step", "price_held");
    if (error) throw error;
    for (const chatId of new Set((data ?? []).map((j) => j.telegram_chat_id).filter((c): c is number => c != null))) {
      await expireHeldPriceQuestions(db, chatId, now);
      await releaseHeldPriceQuestions(db, chatId);
    }
  } catch (error) {
    console.error("held price questions tick failed", error instanceof Error ? error.message : error);
  }
}

/**
 * Zurückgehaltene Preis-Rückfragen stellen, sobald keine andere Erfassung mehr läuft – eine nach der
 * anderen (die älteste zuerst; die nächste nach deren Antwort). Erst mit dem Senden beginnt die
 * übliche Frist von 10 Minuten (updated_at). Wirft nie.
 */
export async function releaseHeldPriceQuestions(db: Db, chatId: number) {
  try {
    await expireHeldPriceQuestions(db, chatId);
    if (await otherFlowActive(db, chatId)) return;
    const { data, error } = await db
      .from("ingest_jobs")
      .select("id, extracted")
      .eq("telegram_chat_id", chatId)
      .eq("status", "needs_review")
      .eq("extracted->>step", "price_held")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    const job = data?.[0];
    if (!job) return;
    const held = job.extracted as unknown as IngestState;
    const next = { ...held, step: held.price_followup?.held_step ?? "price" } as IngestState;
    const { data: updated, error: updateError } = await db
      .from("ingest_jobs")
      .update({ extracted: next as unknown as Json })
      .eq("id", job.id)
      .eq("extracted->>step", "price_held")
      .select("id");
    if (updateError) throw updateError;
    if (updated?.length) await sendPriceQuestion(chatId, job.id, next);
  } catch (error) {
    console.error("release price question failed", error instanceof Error ? error.message : error);
  }
}

/** Normale Preisfrage zur Charge stellen (nach „✏️ Ändern“, „Selbst eingeben“ bzw. ohne Fund). */
export async function askPrice(db: Db, chatId: number, item: ItemRow, mode: PriceMode, ask: Ask = "fix") {
  await askOrHold(db, chatId, item, mode, mode === "both" ? "price" : "regular_price", ask);
}

/** „✏️ Ändern“ bzw. „Selbst eingeben“ für eine Charge (die Person fragt selbst: sofort). */
export async function askPriceForItem(db: Db, chatId: number, itemId: string, mode: PriceMode) {
  const item = await loadItem(db, itemId);
  if (!item) return false;
  const jobId = await startPriceFollowup(db, chatId, item, mode, mode === "both" ? "price" : "regular_price", "fix");
  const { data } = await db.from("ingest_jobs").select("extracted").eq("id", jobId).maybeSingle();
  await sendPriceQuestion(chatId, jobId, data?.extracted as unknown as IngestState);
  return true;
}

/** Gefundenen (bzw. übernommenen) Preis in die Charge – nur leere Felder, Herkunft research. */
export async function storeFoundPrice(db: Db, itemId: string, offer: { amount: number; merchant: string; url: string; year: number | null; sizeMl?: number | null; size_ml?: number | null; merchants?: number; soldOut?: boolean; source?: "model" }, mode: PriceMode) {
  const values = mode === "both" ? { purchase_price: offer.amount, regular_price: offer.amount } : { regular_price: offer.amount };
  return updateItemPrices(db, itemId, values, "research", priceNote(offer), true);
}

/**
 * dry_run: Testlauf – sucht wie sonst, speichert aber nichts in inventory_items, sendet nichts an
 * Telegram und legt keine Rückfrage an; das Ergebnis steht nur in research_jobs.result (diagnostics).
 */
export type PriceJobParams = { item_id: string; mode: PriceMode; chat_id: number; dry_run?: boolean };

/** Preissuche für eine Charge ausführen und Antoine melden lassen (Auftrag „price“). */
export async function runPriceSearch(db: Db, p: PriceJobParams): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  // Diagnose (Rohantwort, Verwerfungsgrund, geprüfte Seiten) – landet in research_jobs.result.
  let diag: PriceDiagnostics | null = null;
  const done = (filled: string[] = []): ResearchOutcome => ({
    status: filled.length ? "filled" : "nothing",
    filled,
    suggested: 0,
    seconds: seconds(),
    ...(diag ? { diagnostics: diag } : {}),
  });
  try {
    const item = await loadItem(db, p.item_id);
    if (!item?.wine) return done();
    // Schon von Hand ausgefüllt (z. B. inzwischen in der App)? Dann nichts suchen (Testlauf: trotzdem).
    const empty = p.mode === "both" ? item.purchase_price == null || item.regular_price == null : item.regular_price == null;
    if (!empty && !p.dry_run) return done();
    const { finding, diagnostics } = await researchPrice(item.wine, item.vintage_year, item.bottle_size_ml, item.vendor?.name ?? null);
    diag = diagnostics;
    if (p.dry_run) {
      diag = { ...diagnostics, finding };
      return done();
    }
    if (finding.kind === "exact") {
      const saved = await storeFoundPrice(db, item.id, finding, p.mode);
      if (!saved) return done();
      // Braucht keine Antwort: sofort, aber mit der Flasche.
      await sendMessage(p.chat_id, T.priceFound(bottleLabel(item), money(finding.amount), offerDetails(finding), p.mode === "regular"), priceFixKeyboard(item.id, p.mode));
      return done([`${p.mode === "regular" ? "Normalpreis" : "Preis"} ${money(finding.amount)} (${offerDetails(finding)})`]);
    }
    if (finding.kind === "other") {
      const offer: PriceOffer = { amount: finding.amount, merchant: finding.merchant, url: finding.url, year: finding.year, size_ml: finding.sizeMl, mode: p.mode, ...(finding.why ? { why: finding.why } : {}) };
      await askOrHold(db, p.chat_id, item, p.mode, "price_offer", "offer", { price_offer: offer });
      return done();
    }
    await askPrice(db, p.chat_id, item, p.mode, "not_found");
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
