// Passt eine Shop-Seite zu genau diesem Wein und Jahrgang? Rein, damit Adapter und Tests dieselbe
// Regel nutzen. Unsicher → verwerfen: alle Wörter des Weinnamens im Titel, Produzent erkennbar,
// keine Zusätze, die einen anderen Wein bezeichnen („Reserva“, „Late Release“, „Blanc“ …),
// genau der gesuchte Jahrgang (Wein ohne Jahrgang: kein Jahrgang im Titel).

export type ShopWine = {
  name: string;
  producer: string | null;
  /** null = ohne Jahrgang (NV). */
  year: number | null;
  /** Herkunft – deren Wörter gelten im Titel nicht als Zusatz. */
  appellation?: string | null;
  region?: string | null;
  country?: string | null;
};

const STOP = new Set(["de", "la", "le", "les", "du", "des", "di", "da", "del", "della", "the", "and", "und", "et", "y", "e", "d", "l", "a", "of", "von", "vom", "au", "aux"]);

/** Gleiche Bedeutung, andere Schreibweise. */
const SAME: Record<string, string> = { reserve: "reserva", riserva: "reserva", cab: "cabernet", st: "saint", ste: "sainte", shiraz: "syrah" };

/** Allgemeine Wörter in Produzentennamen – reichen allein nicht als Nachweis. */
const GENERIC_PRODUCER = new Set([
  "winery", "wines", "wine", "vineyards", "vineyard", "cellars", "cellar", "estate", "estates", "domaine", "domaines", "chateau",
  "bodegas", "bodega", "vinedos", "vina", "vinas", "cantina", "cantine", "tenuta", "weingut", "maison", "quinta", "vinhos",
  "sa", "ag", "gmbh", "srl", "spa", "ltd", "inc", "llc", "co", "company", "family", "fils", "hijos", "familia", "famille",
]);

/** Zusätze, die meist einen anderen Wein (Linie, Farbe, Ausbau) bezeichnen. */
const QUALIFIERS = new Set([
  "reserva", "grande", "gran", "grand", "late", "release", "block", "single", "vieilles", "vignes", "old", "vines",
  "blanc", "blanco", "bianco", "white", "weiss", "rose", "rosado", "rosato", "port", "porto", "lbv", "bottled",
  "selection", "selezione", "prestige", "superiore", "brut", "sec", "demi", "dolce", "dulce", "liquoroso", "passito",
  "alkoholfrei", "zero", "secondo", "second", "petit", "petite", "junior", "jeune",
]);

/** Wörter (klein, ohne Akzente; Jahreszahlen bleiben). */
export function words(s: string | null | undefined) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => SAME[w] ?? w);
}

/** Jahrgänge im Text (1950–2099, nicht Teil einer längeren Zahl). */
export function yearsIn(s: string) {
  return [...new Set([...s.matchAll(/(?<!\d)(19[5-9]\d|20\d\d)(?!\d)/g)].map((m) => Number(m[1])))];
}

const isYear = (w: string) => /^(19[5-9]\d|20\d\d)$/.test(w);

/** Produzent ohne Klammern und Rechtsform – die prägenden Wörter. */
export function producerWords(producer: string | null) {
  return words((producer ?? "").replace(/\([^)]*\)/g, " ")).filter((w) => !GENERIC_PRODUCER.has(w) && !isYear(w));
}

/** Suchbegriffe: Produzent (ohne Klammern) und Name, ohne doppelte Wörter. */
export function searchTerms(wine: Pick<ShopWine, "name" | "producer">) {
  const producer = (wine.producer ?? "").replace(/\([^)]*\)/g, " ").replace(/\b(S\.?A\.?|AG|GmbH|S\.?r\.?l\.?|S\.?p\.?A\.?|Ltd|Inc|LLC)\b\.?/gi, " ");
  const nameWords = new Set(words(wine.name));
  const extra = producer.split(/\s+/).filter((w) => w && !words(w).every((x) => nameWords.has(x)));
  return [...extra, wine.name].join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Titel bzw. Adresse (Slug) prüfen: alle Namenswörter da, keine fremden Zusätze. checkProducer:
 * mindestens ein prägendes Produzentenwort im Titel oder in context (z. B. Seitentext).
 * Gibt die Zahl der übrigen Wörter zurück (weniger = genauer) oder null (passt nicht).
 */
export function nameMatch(title: string, wine: ShopWine, options: { checkProducer: boolean; context?: string } = { checkProducer: true }) {
  const have = new Set(words(title));
  const name = words(wine.name).filter((w) => !isYear(w));
  if (!name.length || !name.every((w) => have.has(w))) return null;
  const producer = producerWords(wine.producer);
  if (options.checkProducer && producer.length && !producer.some((w) => name.includes(w))) {
    const around = new Set([...have, ...words(options.context)]);
    if (!producer.some((w) => around.has(w))) return null;
  }
  const known = new Set([...name, ...words(wine.producer), ...words(wine.appellation), ...words(wine.region), ...words(wine.country)]);
  const extra = [...have].filter((w) => !known.has(w) && !isYear(w));
  if (extra.some((w) => QUALIFIERS.has(w))) return null;
  return extra.length;
}

/** Jahrgang im Titel passt: genau der gesuchte; ohne Jahrgang (NV) keiner. */
export function vintageMatch(title: string, year: number | null) {
  const found = yearsIn(title);
  return year == null ? found.length === 0 : found.length === 1 && found[0] === year;
}

/** Ganze Seite: Name, Produzent und Jahrgang im Titel (Produzent auch im Text). */
export function pageMatches(page: { title: string; text: string }, wine: ShopWine) {
  return vintageMatch(page.title, wine.year) && nameMatch(page.title, wine, { checkProducer: true, context: page.text.slice(0, 2000) }) != null;
}

/**
 * Aus Kandidaten (Titel bzw. Slug) den einen passenden wählen. Mehrere verschiedene Weine
 * passen gleich gut → unsicher → keiner. base: Kennung ohne Jahrgang (gleicher Wein, anderes Jahr).
 */
export function pickCandidate<C extends { label: string; base: string }>(candidates: C[], wine: ShopWine, checkProducer: boolean): C[] {
  const scored = candidates
    .map((c) => ({ c, score: nameMatch(c.label, wine, { checkProducer }) }))
    .filter((x): x is { c: C; score: number } => x.score != null);
  if (!scored.length) return [];
  const best = Math.min(...scored.map((x) => x.score));
  const top = scored.filter((x) => x.score === best);
  const bases = new Set(top.map((x) => x.c.base));
  // Genau ein Wein ohne Zusätze gewinnt; sonst nur, wenn alle Treffer derselbe Wein sind.
  const wines = new Set(scored.map((x) => x.c.base));
  if (wines.size > 1 && !(best === 0 && bases.size === 1)) return [];
  return top.map((x) => x.c);
}
