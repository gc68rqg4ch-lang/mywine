// Preissuche (rein, ohne Netz): ist ein Shop-Angebot derselbe Wein bzw. dieselbe Spirituose? Dazu
// Produzent-Varianten für die Suche, Grösse und Jahrgang aus dem Titel und Preise aus Produktseiten
// (Shopify-JSON, schema.org Product/Offer, Magento-Preisattribute).

const fold = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss");

/** Wörter (Buchstaben/Ziffern), klein, ohne Akzente. */
export const wordsOf = (s: string | null | undefined) => fold(s).match(/[a-z0-9]+/g) ?? [];

/** Rechtsformen und allgemeine Betriebswörter – unterscheiden nichts. */
const PRODUCER_GENERIC = new Set(
  "distilleria distillerie distillery brennerei destillerie weingut domaine chateau cantina cantine bodega bodegas tenuta azienda agricola fattoria casa maison weinkellerei kellerei winery estate sa ag gmbh srl spa sas sarl ltd inc co cie & et und and di de del della des du la le les the von van".split(" "),
);

/**
 * Zusätze, die nicht als unterscheidende Namenswörter zählen (Qualitäts- und Füllwörter). Riserva,
 * Single Cask, Cask Strength, Vintage, XO/VSOP/VS prüft qualifierMismatch eigens.
 */
const NAME_GENERIC = new Set(
  "riserva reserva reserve réserve gran grande grand selection selezione edition cuvee cuvée vino wine wein grappa brandy whisky whiskey rum gin likor liqueur liquore cl ml l ltr liter litre flasche bottle botella bouteille the il la le di de del della".split(" ").concat("single cask strength fassstarke vintage jahrgang millesimato millesime xo vsop vs".split(" ")),
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
  { key: "reserve", re: /\b(riserva|reserva|reserve)\b/, label: "Riserva" },
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
  title: string;
  vendor: string | null;
  /** Preis pro Flasche (Aktion möglich). */
  price: number;
  /** Normalpreis („statt“), falls eine Aktion läuft. */
  regular: number | null;
  currency: string;
  sizeMl: number | null;
  /** Seite zeigt eine Schweizer Adresse bzw. Versand aus der Schweiz (für Shops ohne .ch). */
  swiss: boolean;
};

const SWISS_RE = /\b(schweiz|switzerland|suisse|svizzera|svizra)\b|\bch-\d{4}\b|\+41\s?\d/i;
/** Seite mit CHF-Preisen und Schweizer Adresse bzw. Versand aus der Schweiz (für Shops ohne .ch). */
export const swissPage = (html: string) => /\bCHF\b/.test(html) && SWISS_RE.test(html);

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[’'`\s]/g, "")) : NaN);

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
  return {
    title: p.title,
    vendor: p.vendor ?? null,
    price,
    regular: compare > price ? compare : null,
    currency: "CHF",
    sizeMl: sizeFromText(p.title) ?? sizeFromText(v.title),
    swiss,
  };
}

/** HTML-Produktseite: schema.org Product/Offer (JSON-LD bzw. itemprop) oder Magento-Preisattribute. */
export function offerFromHtml(html: string): ProductOffer | null {
  const title = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1] ?? html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const swiss = SWISS_RE.test(html);
  // JSON-LD
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = ([] as unknown[]).concat(data, (data as { "@graph"?: unknown[] })?.["@graph"] ?? []);
    for (const n of nodes) {
      const node = n as { "@type"?: string | string[]; name?: string; offers?: unknown; brand?: { name?: string } | string };
      const types = ([] as string[]).concat(node?.["@type"] ?? []);
      if (!types.includes("Product")) continue;
      const offers = ([] as unknown[]).concat(node.offers ?? []).flatMap((o) => ([] as unknown[]).concat((o as { offers?: unknown })?.offers ?? o));
      for (const o of offers) {
        const offer = o as { price?: unknown; lowPrice?: unknown; priceCurrency?: string; priceSpecification?: { price?: unknown; priceCurrency?: string } };
        const price = num(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
        const currency = (offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? "").toUpperCase();
        if (price > 0 && currency) {
          const name = node.name ?? title;
          const brand = typeof node.brand === "string" ? node.brand : (node.brand?.name ?? null);
          return { title: name, vendor: brand, price, regular: null, currency, sizeMl: sizeFromText(name), swiss };
        }
      }
    }
  }
  // Magento: data-price-amount (finalPrice / oldPrice)
  const amount = (type: string) => {
    const m = html.match(new RegExp(`data-price-amount="([0-9.]+)"[^>]*data-price-type="${type}"`)) ?? html.match(new RegExp(`data-price-type="${type}"[^>]*data-price-amount="([0-9.]+)"`));
    return m ? Number(m[1]) : NaN;
  };
  const final = amount("finalPrice");
  if (final > 0 && /\bCHF\b/.test(html)) {
    const old = amount("oldPrice");
    return { title, vendor: null, price: final, regular: old > final ? old : null, currency: "CHF", sizeMl: sizeFromText(title), swiss };
  }
  // schema.org Microdata
  const item = html.match(/itemprop="price"[^>]*content="([0-9.]+)"/i) ?? html.match(/content="([0-9.]+)"[^>]*itemprop="price"/i);
  const cur = html.match(/itemprop="priceCurrency"[^>]*content="([A-Z]{3})"/i) ?? html.match(/content="([A-Z]{3})"[^>]*itemprop="priceCurrency"/i);
  if (item && Number(item[1]) > 0 && cur) return { title, vendor: null, price: Number(item[1]), regular: null, currency: cur[1].toUpperCase(), sizeMl: sizeFromText(title), swiss };
  return null;
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
