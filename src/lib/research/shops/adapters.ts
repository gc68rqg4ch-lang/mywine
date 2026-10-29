// Adapter je Händler-Shop: search → Kandidaten (Adresse + Titel bzw. Slug), read → Seite
// { url, title, year, text }. Geprüft am 28.10.2026: napawine.ch und finespirits.ch (Shopify,
// /products/<handle>.js als JSON), moevenpick-wein.com (Magento, Jahrgang vorne in der Adresse),
// bauraulacvins.ch (Suche /de/search.html, Seiten /de/p/…-<jahr>-<nummer>.html). Ohne Login lesbar.
// mondovino.ch (Coop) sperrt Abrufe (403) – nicht dabei.

import { pdfText } from "@/lib/research/pdf-text";
import { clip, decodeEntities, htmlToText, linksWithClass, metaContent } from "./html";
import { searchTerms, words, yearsIn, type ShopWine } from "./match";

export type ShopId = "napawine" | "moevenpick" | "finespirits" | "bauraulac";

/** text: HTML bzw. JSON; bytes: PDF (Datenblatt). */
export type Fetched = { url: string; status: number; text: string; bytes?: Uint8Array };
/** Abruf mit Zeitlimit; null = Fehler, Zeitlimit oder Abrufbudget aufgebraucht. */
export type Get = (url: string) => Promise<Fetched | null>;

export type Candidate = {
  url: string;
  /** Titel bzw. Slug – für den Namensabgleich. */
  label: string;
  /** Kennung ohne Jahrgang (gleicher Wein, anderer Jahrgang = gleiche base). */
  base: string;
  /** Jahrgang laut Titel bzw. Adresse (null = keiner erkennbar). */
  year: number | null;
};

export type ShopPage = {
  shop: ShopId;
  url: string;
  title: string;
  year: number | null;
  /** Gekürzter Text (Beschreibung, Aromen, Eckdaten). */
  text: string;
  /** Trinkfenster laut Shop („Genussreif Jetzt bis 2035“): from null = ab sofort. */
  drink?: { from: number | null; until: number | null };
  /** Datenblatt (PDF) zur Seite – Mövenpick; wird als eigene Quelle übergeben. */
  datasheet?: ShopPage;
};

export type ShopAdapter = {
  id: ShopId;
  label: string;
  /** Händlername in vendors.name, der zu diesem Shop gehört. */
  vendor: RegExp;
  /** Steht der Produzent im Titel bzw. Slug der Kandidaten? (sonst erst auf der Seite geprüft) */
  labelHasProducer: boolean;
  search(wine: ShopWine, get: Get): Promise<Candidate[]>;
  read(url: string, get: Get): Promise<ShopPage | null>;
  /** Gleiche Seite für einen anderen Jahrgang (Mövenpick: Jahr in der Adresse ersetzen). */
  withYear?(url: string, year: number): string | null;
};

/** Seitentext höchstens so lang (Kosten). */
export const MAX_PAGE_CHARS = 4000;

const firstYear = (s: string) => {
  const ys = yearsIn(s);
  return ys.length === 1 ? ys[0] : null;
};
const baseOf = (label: string) => words(label).filter((w) => !/^(19|20)\d\d$/.test(w)).join("-");
const query = (wine: ShopWine) => encodeURIComponent(searchTerms(wine)).replace(/%20/g, "+");

/** CHF-Betrag „66.00“ (Shopify: Rappen als Zahl; sonst Franken als Text). */
const chf = (v: number) => `CHF ${v.toFixed(2)}`;

/**
 * Preise einer Produktseite als Textzeilen (für die Preissuche): Magento (Mövenpick:
 * data-price-amount mit finalPrice/oldPrice) und schema.org (itemprop="price"). Aktion → „statt“.
 */
export function htmlPriceLines(html: string): string[] {
  const amount = (type: string) => {
    const m = html.match(new RegExp(`data-price-amount="([0-9.]+)"[^>]*data-price-type="${type}"`)) ?? html.match(new RegExp(`data-price-type="${type}"[^>]*data-price-amount="([0-9.]+)"`));
    return m ? Number(m[1]) : null;
  };
  const final = amount("finalPrice");
  const old = amount("oldPrice");
  if (final != null && final > 0) return [old != null && old > final ? `Preis: ${chf(final)} (Aktion, statt ${chf(old)})` : `Preis: ${chf(final)}`];
  const item = html.match(/itemprop="price"[^>]*content="([0-9.]+)"/i) ?? html.match(/content="([0-9.]+)"[^>]*itemprop="price"/i);
  return item && Number(item[1]) > 0 ? [`Preis: ${chf(Number(item[1]))}`] : [];
}

// ——— Shopify (napawine.ch, finespirits.ch) ———

function shopify(id: ShopId, label: string, origin: string, vendor: RegExp): ShopAdapter {
  return {
    id,
    label,
    vendor,
    labelHasProducer: true,
    async search(wine, get) {
      const res = await get(`${origin}/search?q=${query(wine)}&type=product`);
      if (!res || res.status !== 200) return [];
      // Nur Treffer der Suche (mit _pos=…), nicht die Produkte im Menü.
      const handles = [...res.text.matchAll(/href="\/products\/([a-z0-9][a-z0-9-]*)\?[^"]*_pos=/gi)].map((m) => m[1].toLowerCase());
      return [...new Set(handles)].slice(0, 12).map((handle) => {
        const slug = handle.replace(/-/g, " ");
        return { url: `${origin}/products/${handle}`, label: slug, base: baseOf(slug), year: firstYear(slug) };
      });
    },
    async read(url, get) {
      const handle = url.match(/\/products\/([a-z0-9-]+)/i)?.[1];
      if (!handle) return null;
      const res = await get(`${origin}/products/${handle}.js`);
      if (!res || res.status !== 200) return null;
      const data = JSON.parse(res.text) as {
        title?: string;
        description?: string;
        variants?: { title?: string; price?: number; compare_at_price?: number | null; available?: boolean }[];
      };
      const title = decodeEntities(data.title ?? "").trim();
      if (!title) return null;
      // Preise je Variante (Rappen): „Preis 70cl: CHF 66.00 (Aktion, statt CHF 72.00)“.
      const prices = (data.variants ?? []).flatMap((v) =>
        typeof v.price === "number" && v.price > 0
          ? [`Preis${v.title && v.title !== "Default Title" ? ` ${v.title}` : ""}: ${chf(v.price / 100)}${v.compare_at_price && v.compare_at_price > v.price ? ` (Aktion, statt ${chf(v.compare_at_price / 100)})` : ""}`]
          : [],
      );
      // „vendor“ ist bei diesen Shops nicht der Produzent („-“ bzw. der Shop selbst) – weggelassen.
      const text = [title, ...prices, htmlToText(data.description ?? "")].filter(Boolean).join("\n");
      return { shop: id, url: `${origin}/products/${handle}`, title, year: firstYear(title), text: clip(text, MAX_PAGE_CHARS) };
    },
  };
}

// ——— Mövenpick (Magento) ———

const MP = "https://www.moevenpick-wein.com";
const MP_PRODUCT = /^https:\/\/www\.moevenpick-wein\.com\/de\/((?:19|20)\d\d)-([a-z0-9-]+)\.html$/;

/** Abschnitte der Produktseite: Beschreibung, Aromenprofil, Passt zu, Genussreif, Eckdaten. */
export function moevenpickPage(html: string, url: string): ShopPage | null {
  const title = (metaContent(html, "og:title") ?? "").replace(/\s*\|\s*Mövenpick.*$/i, "").trim();
  if (!title) return null;
  const parts: string[] = [title, ...htmlPriceLines(html)];
  const description = html.match(/class="product attribute mpw_webtext">\s*<div class="value"\s*>([\s\S]*?)<\/div>/i)?.[1];
  if (description) parts.push(`Beschreibung: ${htmlToText(description)}`);
  let drink: ShopPage["drink"];
  for (const m of html.matchAll(/servings-title">([^<]*)<\/h3>\s*<div class="cs-product-details-custom__servings-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const head = htmlToText(m[1]);
    // „Zur Jahrgangstabelle“ (Link) gehört nicht zum Inhalt.
    const body = htmlToText(m[2].replace(/<a\b[\s\S]*?<\/a>/gi, " "));
    if (!head || !body) continue;
    parts.push(`${head}: ${body}`);
    if (/genussreif/i.test(head)) drink = parseDrink(body) ?? undefined;
  }
  for (const m of html.matchAll(/<td class="col data"[^>]*data-th="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const head = decodeEntities(m[1]);
    if (/artikelnummer|allergene/i.test(head)) continue;
    const body = htmlToText(m[2]);
    if (body) parts.push(`${head}: ${body}`);
  }
  return { shop: "moevenpick", url, title, year: firstYear(title), text: clip(parts.join("\n"), MAX_PAGE_CHARS), ...(drink ? { drink } : {}) };
}

/** „Jetzt bis 2035“ → bis 2035; „2026 bis 2035“ → 2026–2035; sonst null. */
export function parseDrink(text: string): { from: number | null; until: number | null } | null {
  const range = text.match(/(?<!\d)((?:19|20)\d\d)\s*(?:bis|–|-)\s*((?:19|20)\d\d)(?!\d)/i);
  if (range && Number(range[1]) <= Number(range[2])) return { from: Number(range[1]), until: Number(range[2]) };
  const now = text.match(/jetzt\s+bis\s+((?:19|20)\d\d)(?!\d)/i);
  return now ? { from: null, until: Number(now[1]) } : null;
}

/** Link zum Datenblatt auf der Jahrgangsseite (…/customization_catalog/product/pdf/product_id/<ID>/file/<name>.pdf). */
export function datasheetLink(html: string) {
  const m = html.match(/https:\/\/www\.moevenpick-wein\.com\/de\/customization_catalog\/product\/pdf\/product_id\/\d+\/file\/[^"'\s<>]+?\.pdf/i);
  return m ? decodeEntities(m[0]) : null;
}

/**
 * Datenblatt (PDF) von Mövenpick: Text (Beschreibung, Aromenprofil, Passt zu, Alkoholgehalt,
 * Rebsorte(n), „Trinkreife: Jetzt bis 2035“) ohne Firmenadresse; Trinkfenster aus „Trinkreife“.
 */
export function moevenpickDatasheet(bytes: Uint8Array, url: string, title: string): ShopPage | null {
  const text = pdfText(bytes)
    .replace(/\s*Mövenpick Wein Schweiz AG[\s\S]*$/i, "")
    .trim();
  if (text.length < 40) return null;
  const ripe = text.match(/Trinkreife:\s*([^:]{0,40}?(?:19|20)\d\d)/i)?.[1];
  const drink = ripe ? parseDrink(ripe) : null;
  return { shop: "moevenpick", url, title: `${title} – Datenblatt`, year: firstYear(title), text: clip(text, MAX_PAGE_CHARS), ...(drink ? { drink } : {}) };
}

const moevenpick: ShopAdapter = {
  id: "moevenpick",
  label: "Mövenpick",
  vendor: /m(ö|oe|o)venpick/i,
  labelHasProducer: true,
  async search(wine, get) {
    const res = await get(`${MP}/de/catalogsearch/result/?q=${query(wine)}`);
    if (!res || res.status !== 200) return [];
    // Ein einziger Treffer: Mövenpick leitet direkt auf die Produktseite weiter.
    const urls = MP_PRODUCT.test(res.url) ? [res.url] : linksWithClass(res.text, "product-item-link");
    return urls.flatMap((url) => {
      const m = url.match(MP_PRODUCT);
      if (!m) return [];
      const slug = m[2].replace(/-/g, " ");
      return [{ url, label: `${m[1]} ${slug}`, base: baseOf(slug), year: Number(m[1]) }];
    }).slice(0, 24);
  },
  async read(url, get) {
    const res = await get(url);
    if (!res || res.status !== 200 || !MP_PRODUCT.test(res.url)) return null;
    const page = moevenpickPage(res.text, res.url);
    if (!page) return null;
    // Datenblatt der Jahrgangsseite dazu (eigene Quelle); fehlt es, bleibt die Seite.
    const link = datasheetLink(res.text);
    const sheet = link ? await get(link) : null;
    const datasheet = sheet?.bytes ? moevenpickDatasheet(sheet.bytes, link!, page.title) : null;
    return datasheet ? { ...page, datasheet } : page;
  },
  withYear(url, year) {
    const m = url.match(MP_PRODUCT);
    return m ? `${MP}/de/${year}-${m[2]}.html` : null;
  },
};

// ——— Baur au Lac Vins ———

const BAL = "https://www.bauraulacvins.ch";
const BAL_PRODUCT = /^\/de\/p\/(?:[a-z0-9-]+\/)+([a-z0-9-]+?)-(\d{6,})\.html$/;

/** Titel (h1 + Untertitel mit Produzent), Beschreibung und Eckdaten (Genussreife, Produzent …). */
export function bauraulacPage(html: string, url: string): ShopPage | null {
  const h1 = html.match(/<h1 class="productdetail__title show-for-medium"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<h1 class="productdetail__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const h2 = html.match(/<h2 class="productdetail__subtitle"[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const head = htmlToText(h1 ?? "");
  if (!head) return null;
  const title = [head, htmlToText(h2 ?? "")].filter(Boolean).join(" – ");
  const parts = [title, ...htmlPriceLines(html)];
  const description = html.match(/<p itemprop="description"[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (description) parts.push(`Beschreibung: ${htmlToText(description)}`);
  for (const m of html.matchAll(/<td class="productDetailListTitle">([\s\S]*?)<\/td>\s*<td class="productDetailListText">([\s\S]*?)<\/td>/gi)) {
    const k = htmlToText(m[1]);
    const v = htmlToText(m[2]);
    if (k && v) parts.push(`${k} ${v}`);
  }
  // Jahrgang aus dem h1 (der Untertitel nennt die Flaschengrösse, keinen Jahrgang).
  return { shop: "bauraulac", url, title, year: firstYear(head), text: clip(parts.join("\n"), MAX_PAGE_CHARS) };
}

const bauraulac: ShopAdapter = {
  id: "bauraulac",
  label: "Baur au Lac Vins",
  vendor: /baur\s*au\s*lac/i,
  // Die Adresse nennt nur Name und Jahrgang – Produzent erst auf der Seite (Untertitel).
  labelHasProducer: false,
  async search(wine, get) {
    const res = await get(`${BAL}/de/search.html?searchtext=${query(wine)}`);
    if (!res || res.status !== 200) return [];
    const paths = [...new Set([...res.text.matchAll(/href="(\/de\/p\/[^"]+\.html)"/gi)].map((m) => m[1]))];
    return paths.flatMap((path) => {
      const m = path.match(BAL_PRODUCT);
      if (!m) return [];
      const slug = m[1].replace(/-/g, " ");
      return [{ url: `${BAL}${path}`, label: slug, base: baseOf(slug), year: firstYear(slug) }];
    }).slice(0, 24);
  },
  async read(url, get) {
    const res = await get(url);
    if (!res || res.status !== 200) return null;
    return bauraulacPage(res.text, url);
  },
};

/** Alle Shops in der Standardreihenfolge (der Shop des Händlers der Flasche kommt zuerst). */
export const SHOPS: ShopAdapter[] = [
  shopify("napawine", "Napa Wine", "https://napawine.ch", /napa\s*wine/i),
  moevenpick,
  shopify("finespirits", "Finespirits", "https://finespirits.ch", /fine\s*spirits/i),
  bauraulac,
];
