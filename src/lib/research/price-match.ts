// Preissuche (rein, ohne Netz): ist ein Shop-Angebot derselbe Wein bzw. dieselbe Spirituose? Dazu
// Produzent-Varianten für die Suche, Grösse und Jahrgang aus dem Titel und Preise aus Produktseiten
// (Shopify-JSON, schema.org Product/Offer, WooCommerce, PrestaShop, Magento, Meta-Angaben).

import { decodeEntities } from "./shops/html";

const fold = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss");

/** Wörter (Buchstaben/Ziffern), klein, ohne Akzente. */
export const wordsOf = (s: string | null | undefined) => fold(s).match(/[a-z0-9]+/g) ?? [];

// ——— Marke und Gattungsnamen (auch für die Suchbegriffe in price-search.ts) ———

/** Familienzusatz am Ende: „& Figli“, „e Figli“, „& Fils“, „& Sons“, „& Söhne“, „Fratelli“ … */
const FAMILY_RE = /\s*(?:&|\+|\be\b|\bet\b|\bund\b|\band\b|\by\b)\s*(?:figli|figlio|fils|sons?|söhne|soehne|hijos|filhos|nipoti|co\.?|cie\.?|c\.?)\s*\.?$/i;
/** Rechtsformen (auch mit Punkten: „S.p.A.“, „S.r.l.“). */
const LEGAL_RE = /(?:^|\s)(?:s\.?\s?p\.?\s?a|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?s|s\.?\s?a|s\.?\s?a\.?\s?r\.?\s?l|sarl|ag|gmbh|ltd|inc|llc|bv|nv|kg)\.?(?=\s|$|,)/gi;
/** Betriebswörter – gehören nicht zur Marke („Distilleria“, „Cantina“, „Weingut“, „Bodega“ …). */
const BUSINESS = new Set(
  "distilleria distillerie distilleries distillery distilerias destilerias destileria brennerei destillerie weingut weinbau weinkellerei kellerei domaine domaines chateau château cantina cantine bodega bodegas tenuta azienda agricola vinicola vitivinicola fattoria maison winery wines estate estates casa fratelli famiglia family famille cooperativa caves cave vignobles vigneti agriturismo società societa compagnia company".split(" "),
);

/**
 * Marke aus dem Produzenten: Klammerzusatz (oft die Marke) bzw. der Name ohne Rechtsform,
 * Betriebswörter und Familienzusatz; mit Familienzusatz nur der Familienname.
 * „Paolo Lazzaroni & Figli“ → „Lazzaroni“, „Distilleria Giovannipoli (Casa Grappa)“ → „Casa Grappa“,
 * „Illva Saronno S.p.A.“ → „Illva Saronno“. Leer → null.
 */
export function brandFromProducer(producer: string | null | undefined): string | null {
  const p = (producer ?? "").trim();
  if (!p) return null;
  const inner = p.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (inner && inner.length >= 2) return inner;
  let s = p.replace(/\([^)]*\)/g, " ").replace(LEGAL_RE, " ").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
  const family = FAMILY_RE.test(s);
  s = s.replace(FAMILY_RE, "").trim();
  const words = s.split(/\s+/).filter((w) => w && !BUSINESS.has(fold(w).replace(/[^a-z]/g, "")) && !/^(di|de|del|della|dei|des|du|da|von|van|la|le|el)$/i.test(w));
  if (!words.length) return s || null;
  // „Paolo Lazzaroni & Figli“: die Marke ist der Familienname.
  return family ? words[words.length - 1] : words.join(" ");
}

/** Gattungsnamen – allein nichtssagend, immer mit Marke suchen. */
export const GENERIC_NAMES = new Set(
  "amaretto grappa gin rum rhum ron vodka whisky whiskey cognac brandy likor liquor liqueur liquore limoncello sambuca vermouth wermut vermut pisco tequila mezcal calvados armagnac kirsch williams obstbrand pflumli zwetschgen schnaps bitter aperitivo americano port porto sherry madeira marsala chardonnay merlot pinot noir grigio gris blanc bianco blanco rosso rouge rot weiss rose rosato rosado sauvignon cabernet syrah shiraz riesling prosecco champagne cava cremant spumante chianti nebbiolo barbera dolcetto primitivo sangiovese tempranillo malbec zinfandel moscato muscat premium original originale classic classico reserve riserva reserva selection vino wine wein extra dry old fine special superior".split(" "),
);

/** Name nur aus Gattungswörtern („Amaretto“, „Premium Pisco“, „Grappa Riserva“) bzw. sehr kurz. */
export function genericName(name: string) {
  const w = wordsOf(name).filter((x) => !/^\d+$/.test(x));
  return w.length === 0 || w.every((x) => GENERIC_NAMES.has(x) || x.length <= 2) || name.trim().length <= 4;
}

/** Ist die Marke schon im Namen? („Disaronno“ enthält „Saronno“ aus „Illva Saronno“.) */
export const brandInName = (brand: string, name: string) => {
  const nameWords = new Set(wordsOf(name));
  const nameJoined = [...nameWords].join("");
  return wordsOf(brand).some((b) => (b.length >= 4 && nameJoined.includes(b)) || (b.length >= 2 && nameWords.has(b)));
};

/** Rechtsformen und allgemeine Betriebswörter – unterscheiden nichts. */
const PRODUCER_GENERIC = new Set(
  "distilleria distillerie distillery brennerei destillerie weingut domaine chateau cantina cantine bodega bodegas tenuta azienda agricola fattoria casa maison weinkellerei kellerei winery estate sa ag gmbh srl spa sas sarl ltd inc co cie & et und and di de del della des du la le les the von van".split(" "),
);

/**
 * Zusätze, die nicht als unterscheidende Namenswörter zählen (Qualitäts- und Füllwörter). Riserva,
 * Single Cask, Cask Strength, Vintage, XO/VSOP/VS prüft qualifierMismatch eigens.
 */
const NAME_GENERIC = new Set(
  "riserva reserva reserve reservado réserve gran grande grand selection selezione edition cuvee cuvée vino wine wein grappa brandy whisky whiskey rum gin likor liqueur liquore cl ml l ltr liter litre flasche bottle botella bouteille the il la le di de del della".split(" ").concat("single cask strength fassstarke vintage jahrgang millesimato millesime xo vsop vs".split(" ")),
);

/** Alters- bzw. Reifeangaben: „36 mesi“, „12 years“, „18 anni“, „10 Jahre“, „12 yo“. */
const AGE_RE = /(\d{1,3})\s*(mesi|mese|monate|monat|months?|anni|anno|jahre|jahr|years?|yo|ans|ani|anos|años)\b/g;
const ageOf = (s: string) => [...fold(s).matchAll(AGE_RE)].map((m) => `${Number(m[1])}${/^(mesi|mese|monate|monat|month)/.test(m[2]) ? "m" : "y"}`);

/** Grösse aus dem Titel: „70 cl.“, „0,7 l“, „700 ml“, „1.5 L“ → ml; sonst null. */
export function sizeFromText(text: string | null | undefined): number | null {
  const t = fold(text).replace(/,/g, ".");
  const cl = t.match(/(\d+(?:\.\d+)?)\s*cl\b/);
  if (cl) return Math.round(Number(cl[1]) * 10);
  const ml = t.match(/(\d{2,4})\s*ml\b/);
  if (ml) return Number(ml[1]);
  const l = t.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|liter|litre)\b/);
  if (l && Number(l[1]) > 0 && Number(l[1]) <= 6) return Math.round(Number(l[1]) * 1000);
  return null;
}

/** Jahrgang im Titel (genau einer, 1900–2099); sonst null. */
export function yearFromText(text: string | null | undefined): number | null {
  const ys = [...new Set((fold(text).match(/\b(19|20)\d\d\b/g) ?? []).map(Number))];
  return ys.length === 1 ? ys[0] : null;
}

/**
 * Produzent für die Suche: der volle Name, ohne Klammerzusatz und Rechtsform, der Klammerzusatz
 * allein. „Distilleria Giovannipoli (Casa Grappa)“ → „Distilleria Giovannipoli (Casa Grappa)“,
 * „Giovannipoli“, „Casa Grappa“.
 */
export function producerVariants(producer: string | null | undefined): string[] {
  const p = (producer ?? "").trim();
  if (!p) return [];
  const inner = [...p.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  const outer = p.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const core = outer
    .split(/\s+/)
    .filter((w) => !PRODUCER_GENERIC.has(fold(w).replace(/[^a-z&]/g, "")))
    .join(" ")
    .trim();
  return [...new Set([p, outer, core, ...inner].filter((v) => v.length >= 2))];
}

/** Unterscheidende Wörter des Namens (ohne Zusätze, Produzent, Grösse, Alter und Jahrgang). */
export function distinctiveWords(name: string, producer?: string | null) {
  const producerWords = new Set(producerVariants(producer).flatMap(wordsOf));
  const withoutAge = fold(name).replace(AGE_RE, " ");
  return wordsOf(withoutAge).filter((w) => !NAME_GENERIC.has(w) && !producerWords.has(w) && !/^\d+$/.test(w) && w.length >= 2);
}

/**
 * Zusätze, die oft ein eigenes Produkt bezeichnen: steht einer nur auf einer Seite (gesuchter Name
 * oder Angebot), ist es kein exakter Treffer – Antoine fragt „Übernehmen?“.
 */
const QUALIFIERS = [
  { key: "reserve", re: /\b(riserva|reserva|reserve|reservado)\b/, label: "Riserva" },
  { key: "single_cask", re: /\bsingle\s+cask\b/, label: "Single Cask" },
  { key: "cask_strength", re: /\b(cask\s+strength|fassstarke)\b/, label: "Cask Strength" },
  { key: "vintage", re: /\b(vintage|jahrgang|millesimato|millesime)\b/, label: "Vintage" },
] as const;
/** Cognac/Brandy-Qualitäten – schliessen sich gegenseitig aus. */
const GRADE_RE = /\b(xo|vsop|vs)\b/g;

export type Mismatch = { reason: string; detail: string };

/**
 * Abweichender Zusatz zwischen gesuchtem Namen und Angebot (rein): „Angebot ohne Riserva“, „Angebot
 * mit Single Cask“, „Angebot VS statt VSOP“; reason z. B. reserve_mismatch. Sonst null.
 */
export function qualifierMismatch(name: string, title: string): Mismatch | null {
  const want = fold(name);
  const offer = fold(title);
  for (const q of QUALIFIERS) {
    const inWant = q.re.test(want);
    const inOffer = q.re.test(offer);
    if (inWant !== inOffer) return { reason: `${q.key}_mismatch`, detail: `Angebot ${inWant ? "ohne" : "mit"} ${q.label}` };
  }
  const grades = (s: string) => [...new Set([...s.matchAll(GRADE_RE)].map((m) => m[1].toUpperCase()))].sort().join("/");
  const wantGrade = grades(want);
  const offerGrade = grades(offer);
  if (wantGrade !== offerGrade) {
    const detail = !offerGrade ? `Angebot ohne ${wantGrade}` : !wantGrade ? `Angebot mit ${offerGrade}` : `Angebot ${offerGrade} statt ${wantGrade}`;
    return { reason: "grade_mismatch", detail };
  }
  return null;
}

/** same: derselbe Wein; mismatch: aber ein unterscheidender Zusatz nur auf einer Seite (→ nachfragen). */
export type SameProduct = { same: true; mismatch?: Mismatch } | { same: false; reason: "missing_words" | "age_differs" | "year_differs" | "no_title" };

/**
 * Derselbe Wein bzw. dieselbe Spirituose? Massgebend sind die unterscheidenden Wörter des Namens
 * (alle müssen im Titel bzw. Händler-/Produzentenfeld vorkommen) und Alters-/Reifeangaben („36
 * mesi“ ≠ „18 mesi“). Gross-/Kleinschreibung, Grössenangaben im Titel und Schreibweisen des
 * Produzenten zählen nicht. Zusätze wie Riserva, Single Cask, XO nur auf einer Seite: derselbe Wein,
 * aber mit mismatch (kein exakter Treffer). year: gesuchter Jahrgang (anderer im Titel → nein).
 */
export function sameProduct(want: { name: string; producer?: string | null; year?: number | null }, title: string | null | undefined, extra?: string | null): SameProduct {
  if (!title?.trim()) return { same: false, reason: "no_title" };
  const offer = `${title} ${extra ?? ""}`;
  const offerWords = new Set(wordsOf(offer));
  const offerJoined = wordsOf(offer).join("");
  const need = distinctiveWords(want.name, want.producer);
  // Auch zusammen- bzw. getrennt geschrieben („Acqua Stilla“ / „Acquastilla“).
  if (!need.every((w) => offerWords.has(w) || offerJoined.includes(w))) return { same: false, reason: "missing_words" };
  // Gattungsname („Amaretto“, „Premium Pisco“): die Marke muss im Titel bzw. Marken-/Händlerfeld
  // stehen – sonst wäre jedes Amaretto „derselbe“ (Globus-Eigenmarke statt Lazzaroni).
  const brand = brandFromProducer(want.producer);
  if (genericName(want.name) && brand && wordsOf(brand).length && !brandInName(brand, offer)) return { same: false, reason: "missing_words" };
  // Name ohne eigene Wörter (z. B. nur „Grappa Riserva“): dann muss der Produzent vorkommen.
  if (!need.length) {
    const producerWords = producerVariants(want.producer).flatMap(wordsOf).filter((w) => !PRODUCER_GENERIC.has(w) && w.length >= 3);
    if (producerWords.length && !producerWords.some((w) => offerWords.has(w) || offerJoined.includes(w))) return { same: false, reason: "missing_words" };
  }
  const wantAges = ageOf(want.name);
  const offerAges = ageOf(title);
  // „Lagavulin 16“ = „Lagavulin 16 Years“: eine gleiche Zahl ohne Einheit im Namen zählt mit.
  const bareNumbers = new Set(wordsOf(want.name).filter((w) => /^\d{1,3}$/.test(w)).map(Number));
  const ageOk = (a: string) => wantAges.includes(a) || (!wantAges.length && bareNumbers.has(parseInt(a, 10)));
  if (offerAges.some((a) => !ageOk(a))) return { same: false, reason: "age_differs" };
  if (wantAges.length && !wantAges.every((a) => offerAges.includes(a))) return { same: false, reason: "age_differs" };
  const offerYear = yearFromText(title);
  if (want.year != null && offerYear != null && offerYear !== want.year) return { same: false, reason: "year_differs" };
  const mismatch = qualifierMismatch(want.name, title);
  return mismatch ? { same: true, mismatch } : { same: true };
}

/** Angebot von einer Produktseite. */
export type ProductOffer = {
  /** Eigener Produktname der Seite (nicht Seitentitel oder Suchbegriff). */
  title: string;
  vendor: string | null;
  /** Preis pro Flasche (Aktion möglich). */
  price: number;
  /** Normalpreis („statt“), falls eine Aktion läuft. */
  regular: number | null;
  currency: string;
  /** Grösse laut Seite (Produktname bzw. Angabe); null = nicht genannt. */
  sizeMl: number | null;
  /** Seite zeigt eine Schweizer Adresse bzw. Versand aus der Schweiz (für Shops ohne .ch). */
  swiss: boolean;
  /** Ausverkauft bzw. nicht lieferbar (Preis gilt trotzdem, wird im price_note vermerkt). */
  soldOut?: boolean;
};

/** Ergebnis einer Seite: genau ein Produkt mit Preis, eine Listen-/Marken-/Kategorieseite, oder nichts lesbar. */
export type PageRead = { kind: "product"; offer: ProductOffer } | { kind: "listing"; reason: string } | { kind: "none" };

const SWISS_RE = /\b(schweiz|switzerland|suisse|svizzera|svizra)\b|\bch-\d{4}\b|\+41\s?\d/i;
/** Seite mit CHF-Preisen und Schweizer Adresse bzw. Versand aus der Schweiz (für Shops ohne .ch). */
export const swissPage = (html: string) => /\bCHF\b/.test(html) && SWISS_RE.test(html);

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[’'`\s]/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/\.[-–]$/, "")) : NaN);
const SOLD_OUT_RE = /OutOfStock|SoldOut|Discontinued|out[ _-]?of[ _-]?stock|\boos\b|ausverkauft|nicht (mehr )?(verfügbar|lieferbar|an lager)|épuisé|esaurito/i;

/** Shopify-Produktdaten (/products/<handle>.js; Preise in Rappen). Erste verfügbare Variante. */
export function offerFromShopify(json: unknown, swiss = false): ProductOffer | null {
  const p = json as { title?: string; vendor?: string; variants?: { title?: string; price?: number | string; compare_at_price?: number | string | null; available?: boolean }[] } | null;
  if (!p?.title || !p.variants?.length) return null;
  const v = p.variants.find((x) => x.available !== false) ?? p.variants[0];
  // .js: Rappen als Zahl; .json: Franken als Text („73.00“).
  const toChf = (x: unknown) => (typeof x === "number" ? x / 100 : num(x));
  const price = toChf(v.price);
  const compare = v.compare_at_price == null ? NaN : toChf(v.compare_at_price);
  if (!(price > 0)) return null;
  const soldOut = p.variants.every((x) => x.available === false);
  return {
    title: p.title,
    vendor: p.vendor ?? null,
    price,
    regular: compare > price ? compare : null,
    currency: "CHF",
    sizeMl: sizeFromText(p.title) ?? sizeFromText(v.title),
    swiss,
    ...(soldOut ? { soldOut } : {}),
  };
}

type LdNode = { "@type"?: string | string[]; name?: string; offers?: unknown; brand?: { name?: string } | string; itemListElement?: unknown; item?: unknown; size?: unknown };
const typesOf = (n: LdNode) => ([] as string[]).concat(n?.["@type"] ?? []);

/** Alle JSON-LD-Knoten: einzeln, als Liste, in @graph und in ItemList-Einträgen. */
function jsonLdNodes(html: string): LdNode[] {
  const out: LdNode[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const n = v as LdNode & { "@graph"?: unknown };
    if (n["@graph"]) walk(n["@graph"], depth + 1);
    if (n["@type"]) out.push(n);
    if (n.itemListElement) walk(n.itemListElement, depth + 1);
    if (n.item && typeof n.item === "object") walk(n.item, depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // ungültiges JSON-LD überspringen
    }
  }
  return out;
}

const textOf = (html: string) => decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const decodeHtml = (s: string) => decodeEntities(s).replace(/\u00a0/g, " ");

/**
 * Microdata: name und brand, die direkt zum Product gehören (nicht zu Brotkrumen, Angebot oder
 * Händler darin) – je itemprop zählt das nächste itemtype davor.
 */
function microdataProduct(html: string): { name: string; brand: string | null } {
  const props = (prop: string) =>
    [...html.matchAll(new RegExp(`<([a-z0-9]+)[^>]*itemprop=["']${prop}["'][^>]*>`, "gi"))].flatMap((m) => {
      const before = html.slice(0, m.index);
      const owner = [...before.matchAll(/itemtype=["']https?:\/\/schema\.org\/(\w+)["']/gi)].pop()?.[1];
      if (owner !== "Product") return [];
      const content = m[0].match(/content=["']([^"']*)["']/i)?.[1];
      if (content != null) return [decodeHtml(content).trim()];
      const inner = html.slice(m.index! + m[0].length).match(new RegExp(`^([\\s\\S]*?)<\\/${m[1]}>`, "i"))?.[1] ?? "";
      return [textOf(inner)];
    }).filter(Boolean);
  return { name: props("name")[0] ?? "", brand: props("brand")[0] ?? null };
}

/** Eigener Produktname im HTML: h1 (gleicher Text bei Mobil-/Desktop-Doppel), sonst null; mehrere verschiedene → "several". */
function pageHeading(html: string, cls?: RegExp): string | "several" | null {
  const heads = [...html.matchAll(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi)].filter((m) => !cls || cls.test(m[1])).map((m) => textOf(m[2])).filter(Boolean);
  const distinct = [...new Set(heads)];
  return distinct.length > 1 ? "several" : (distinct[0] ?? null);
}

/** Betrag aus einem Preistext: „CHF 34.90“, „34.90 CHF“, „Fr. 34.–“, „CHF 1’234.50“. */
export function amountInText(text: string): { amount: number; currency: string } | null {
  const t = decodeHtml(text);
  const m =
    t.match(/(?:CHF|SFr\.?|Fr\.)\s*([\d’'`]+(?:[.,]\d{1,2}|\.[-–])?)/i) ??
    t.match(/([\d’'`]+(?:[.,]\d{1,2}|\.[-–]))\s*(?:CHF|SFr|Fr\.)/i);
  if (m) {
    const amount = num(m[1]);
    return amount > 0 ? { amount, currency: "CHF" } : null;
  }
  const eur = t.match(/(?:€|EUR)\s*([\d.,]+)|([\d.,]+)\s*(?:€|EUR)/);
  if (eur) return { amount: num(eur[1] ?? eur[2]), currency: "EUR" };
  return null;
}

const first = (html: string, re: RegExp) => html.match(re)?.[1] ?? null;
const metaProp = (html: string, prop: string) =>
  first(html, new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i")) ??
  first(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${prop}["']`, "i"));
const count = (html: string, re: RegExp) => [...html.matchAll(re)].length;
const product = (offer: ProductOffer): PageRead => ({ kind: "product", offer });
const listing = (reason: string): PageRead => ({ kind: "listing", reason });

/**
 * Produktseite lesen. Als Treffer gilt nur eine Seite mit genau einem Produkt und dessen eigenem
 * Namen: schema.org Product (JSON-LD, auch in @graph oder als Liste; Microdata), WooCommerce
 * (h1.product_title + p.price), PrestaShop (current-price-value), Magento (product-info-main,
 * data-price-amount) oder Meta-Angaben (product:price:amount, og:price:amount). Listen-, Marken-
 * und Kategorieseiten bzw. Seiten mit mehreren Produkten → listing.
 */
export function productPage(html: string): PageRead {
  const swiss = SWISS_RE.test(html);
  const nodes = jsonLdNodes(html);
  const products = nodes.filter((n) => typesOf(n).some((t) => t === "Product" || t === "ProductGroup"));
  const names = [...new Set(products.map((p) => (p.name ?? "").trim()).filter(Boolean))];
  const listType = nodes.some((n) => typesOf(n).some((t) => ["ItemList", "CollectionPage", "SearchResultsPage", "OfferCatalog"].includes(t)));
  if (names.length > 1) return listing("several_products");
  if (listType && products.length !== 1) return listing("item_list");
  const microProducts = count(html, /itemtype=["']https?:\/\/schema\.org\/Product["']/gi);
  if (microProducts > 1 && !products.length) return listing("several_products");

  if (products.length) {
    const p = products[0];
    const name = p.name?.trim();
    if (!name) return listing("no_product_name");
    const offers = ([] as unknown[]).concat(p.offers ?? []).flatMap((o) => ([] as unknown[]).concat((o as { offers?: unknown })?.offers ?? o));
    for (const o of offers) {
      const offer = o as { price?: unknown; lowPrice?: unknown; priceCurrency?: string; availability?: string; priceSpecification?: unknown };
      const specs = ([] as { price?: unknown; priceCurrency?: string; priceType?: string }[]).concat((offer.priceSpecification as never) ?? []);
      const sale = specs.find((x) => !/Strikethrough|ListPrice/i.test(x.priceType ?? ""));
      const strike = specs.find((x) => /Strikethrough|ListPrice/i.test(x.priceType ?? ""));
      const price = num(offer.price ?? offer.lowPrice ?? sale?.price);
      const currency = (offer.priceCurrency ?? sale?.priceCurrency ?? "").toUpperCase();
      if (price > 0 && currency) {
        const regular = num(strike?.price);
        const brand = typeof p.brand === "string" ? p.brand : (p.brand?.name ?? null);
        const soldOut = SOLD_OUT_RE.test(offer.availability ?? "");
        return product({ title: name, vendor: brand, price, regular: regular > price ? regular : null, currency, sizeMl: sizeFromText(name) ?? sizeFromText(typeof p.size === "string" ? p.size : null), swiss, ...(soldOut ? { soldOut } : {}) });
      }
    }
    // Produkt ohne Preis im JSON-LD: der Preis kann noch im HTML stehen (unten), mit diesem Namen.
  }
  const ldName = products[0]?.name?.trim() ?? null;
  const ldBrand = products[0] ? (typeof products[0].brand === "string" ? products[0].brand : (products[0].brand?.name ?? null)) : null;

  // WooCommerce: genau ein h1.product_title, Preis in p.price (Aktion: <del> Normalpreis, <ins> Aktion).
  const wooTitle = pageHeading(html, /class=["'][^"']*\bproduct_title\b/);
  if (wooTitle === "several") return listing("several_products");
  if (wooTitle) {
    const name = wooTitle;
    const block = first(html, /<p[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    if (name && block) {
      const del = first(block, /<del[^>]*>([\s\S]*?)<\/del>/i);
      const ins = first(block, /<ins[^>]*>([\s\S]*?)<\/ins>/i);
      const now = amountInText(textOf(ins ?? block.replace(/<del[\s\S]*?<\/del>/gi, "")));
      const old = del ? amountInText(textOf(del)) : null;
      if (now) {
        const soldOut = /class=["'][^"']*\bstock\b[^"']*\bout-of-stock\b/i.test(html);
        return product({ title: name, vendor: ldBrand, price: now.amount, regular: old && old.amount > now.amount ? old.amount : null, currency: now.currency, sizeMl: sizeFromText(name), swiss, ...(soldOut ? { soldOut } : {}) });
      }
    }
  }

  // PrestaShop: <span class="current-price-value" content="30">, Normalpreis in .regular-price.
  const presta = first(html, /class=["'][^"']*\bcurrent-price-value\b[^"']*["'][^>]*content=["']([\d.]+)["']/i) ?? first(html, /content=["']([\d.]+)["'][^>]*class=["'][^"']*\bcurrent-price-value\b/i);
  if (presta) {
    const heading = pageHeading(html);
    const name = ldName ?? (heading === "several" ? "" : (heading ?? ""));
    const regular = amountInText(textOf(first(html, /class=["'][^"']*\bregular-price\b[^"']*["'][^>]*>([\s\S]*?)<\//i) ?? ""));
    const currency = (metaProp(html, "product:price:currency") ?? (/\bCHF\b/.test(html) ? "CHF" : "")).toUpperCase();
    const soldOut = SOLD_OUT_RE.test(textOf(first(html, /id=["']product-availability["'][^>]*>([\s\S]*?)<\/span>/i) ?? ""));
    if (name && Number(presta) > 0 && currency)
      return product({ title: name, vendor: ldBrand, price: Number(presta), regular: regular && regular.amount > Number(presta) ? regular.amount : null, currency, sizeMl: sizeFromText(name), swiss, ...(soldOut ? { soldOut } : {}) });
  }

  // Magento: Produktbereich (product-info-main) mit finalPrice/oldPrice; sonst mehrere Preise = Liste.
  const amount = (scope: string, type: string) => {
    const m = scope.match(new RegExp(`data-price-amount="([0-9.]+)"[^>]*data-price-type="${type}"`)) ?? scope.match(new RegExp(`data-price-type="${type}"[^>]*data-price-amount="([0-9.]+)"`));
    return m ? Number(m[1]) : NaN;
  };
  const mainAt = html.search(/class=["'][^"']*\bproduct-info-main\b/);
  const finals = count(html, /data-price-type="finalPrice"/g);
  if ((mainAt >= 0 || finals === 1) && /\bCHF\b/.test(html)) {
    const scope = mainAt >= 0 ? html.slice(mainAt, mainAt + 20000) : html;
    const final = amount(scope, "finalPrice");
    const heading = pageHeading(html);
    const name = ldName ?? (heading === "several" ? "" : (heading ?? ""));
    if (final > 0 && name) {
      const old = amount(scope, "oldPrice");
      const soldOut = /class=["'][^"']*\bstock\s+unavailable\b/i.test(scope);
      return product({ title: name, vendor: ldBrand, price: final, regular: old > final ? old : null, currency: "CHF", sizeMl: sizeFromText(name), swiss, ...(soldOut ? { soldOut } : {}) });
    }
  } else if (finals > 1) return listing("several_prices");

  // Microdata: genau ein Product mit itemprop price/priceCurrency und itemprop name.
  const item = first(html, /itemprop=["']price["'][^>]*content=["']([0-9.]+)["']/i) ?? first(html, /content=["']([0-9.]+)["'][^>]*itemprop=["']price["']/i);
  const cur = first(html, /itemprop=["']priceCurrency["'][^>]*content=["']([A-Z]{3})["']/i) ?? first(html, /content=["']([A-Z]{3})["'][^>]*itemprop=["']priceCurrency["']/i);
  if (item && Number(item) > 0 && cur && microProducts <= 1) {
    const scoped = microdataProduct(html);
    const heading = pageHeading(html);
    const name = ldName ?? (scoped.name || (heading === "several" ? "" : (heading ?? "")));
    const avail = first(html, /itemprop=["']availability["'][^>]*(?:href|content)=["']([^"']+)["']/i) ?? "";
    if (name) return product({ title: decodeHtml(name), vendor: ldBrand ?? scoped.brand, price: Number(item), regular: null, currency: cur.toUpperCase(), sizeMl: sizeFromText(name), swiss, ...(SOLD_OUT_RE.test(avail) ? { soldOut: true } : {}) });
  }

  // Meta-Angaben (Open Graph / Facebook-Katalog): product:price:amount bzw. og:price:amount.
  const metaPrice = num(metaProp(html, "product:price:amount") ?? metaProp(html, "og:price:amount"));
  const metaCur = (metaProp(html, "product:price:currency") ?? metaProp(html, "og:price:currency") ?? "").toUpperCase();
  if (metaPrice > 0 && metaCur) {
    const name = ldName ?? decodeHtml((metaProp(html, "og:title") ?? "").trim());
    const avail = metaProp(html, "product:availability") ?? metaProp(html, "og:availability") ?? "";
    if (name) return product({ title: name, vendor: ldBrand ?? metaProp(html, "product:brand"), price: metaPrice, regular: null, currency: metaCur, sizeMl: sizeFromText(name), swiss, ...(SOLD_OUT_RE.test(avail) ? { soldOut: true } : {}) });
  }
  if (products.length || listType) return listing(products.length ? "no_price" : "item_list");
  return { kind: "none" };
}

/** Kurzform: das Angebot einer Produktseite, sonst null (auch bei Listen). */
export function offerFromHtml(html: string): ProductOffer | null {
  const read = productPage(html);
  return read.kind === "product" ? read.offer : null;
}

/** Shopify-Produktadresse → Adresse der Produktdaten (.js); sonst null. */
export function shopifyDataUrl(url: string) {
  try {
    const u = new URL(url);
    const handle = u.pathname.match(/\/products\/([^/?#.]+)/)?.[1];
    return handle ? `${u.origin}${u.pathname.slice(0, u.pathname.indexOf("/products/"))}/products/${handle}.js` : null;
  } catch {
    return null;
  }
}
