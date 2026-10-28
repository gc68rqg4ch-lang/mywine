// Geschmacksprofil eines Weins (wine_taste_profiles) – rein, auch im Browser nutzbar.
// Oberstes Ziel: kein falsches Profil. Jedes Merkmal und jedes Aroma braucht einen Beleg
// (kurzes Zitat mit Quelle); ohne Beleg „unbekannt“ bzw. weggelassen. Begriffe wie im
// WSET-Tool (SAT): dieselben Optionen und dasselbe Aroma-Lexikon. Nur jahrgangsgenau: ein
// Profil gilt für genau einen Jahrgang (Quellen zu diesem Jahrgang); nur Weine ohne Jahrgang
// (NV) haben ein Profil für den Wein.

import { PALATE_FIELDS, aromaBlocksForType, type SatType } from "@/lib/tasting/sat";

export const UNKNOWN = "unbekannt";

/** Merkmale: Spalte in wine_taste_profiles ↔ Feld im WSET-Tool (sat.fields). */
export const TASTE_FIELDS = [
  { key: "sweetness", sat: "suesse", label: "Süsse" },
  { key: "acidity", sat: "saeure", label: "Säure" },
  { key: "tannin", sat: "tannin", label: "Tannin" },
  { key: "alcohol", sat: "alkohol", label: "Alkohol" },
  { key: "body", sat: "koerper", label: "Körper" },
  { key: "flavour_intensity", sat: "geschmackIntensitaet", label: "Intensität" },
  { key: "finish", sat: "abgang", label: "Abgang" },
] as const;
export type TasteKey = (typeof TASTE_FIELDS)[number]["key"];
export const TASTE_KEYS = TASTE_FIELDS.map((f) => f.key) as TasteKey[];

/** Optionen je Merkmal (wie im WSET-Tool). */
export function tasteOptions(key: TasteKey): string[] {
  const sat = TASTE_FIELDS.find((f) => f.key === key)!.sat;
  return PALATE_FIELDS.find((f) => f.key === sat)?.options ?? [];
}

export const SOURCE_KINDS = ["producer", "critic", "merchant", "other", "document"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  producer: "Weingut",
  critic: "Kritik",
  merchant: "Händler",
  other: "Andere",
  document: "Dokument",
};

/** Quelle: Webseite (url) oder angehängtes Datenblatt (document = Dateiname, url = null). */
export type TasteSource = { url: string | null; title: string; kind: SourceKind; vintage: number | null; document?: string };

/** Kennung eines Datenblatts in Quellen und Belegen („dokument:<Dateiname>“, keine URL). */
export const DOCUMENT_REF = "dokument:";
/** Schlüssel einer Quelle (für Belege und die Zählung unabhängiger Quellen). */
export const sourceRef = (s: Pick<TasteSource, "url" | "document">) => s.url ?? `${DOCUMENT_REF}${s.document ?? ""}`;
export type Evidence = { source_url: string; quote: string };
export type Confidence = "hoch" | "mittel" | "niedrig";

export type TasteProfileData = {
  values: Record<TasteKey, string>;
  aromas: Record<string, string[]>;
  styleSummary: string | null;
  foodPairing: string[];
  sources: TasteSource[];
  evidence: Record<string, Evidence[]>;
  confidence: Confidence | null;
  sourceNote: string | null;
  vintageYear: number | null;
};

/** Gespeichertes Profil (für Anzeige). */
export type StoredTasteProfile = TasteProfileData & {
  id: string;
  wineId: string;
  source: "research" | "manual";
  researchedAt: string | null;
};

/** Rohantwort der Recherche (Tool-Eingabe, siehe research/taste.ts). */
export type TasteResearchRaw = {
  matches_wine: boolean;
  same_vintage: boolean;
  sources: { url: string; title: string; kind: SourceKind; vintage: number }[];
  fields: Record<TasteKey, string>;
  aromas: { group: string; aroma: string; source_url: string; quote: string }[];
  evidence: { field: string; source_url: string; quote: string }[];
  contradictions: { field: string; note: string }[];
  style_summary: string;
  food_pairing: string[];
};

const MAX_QUOTE_WORDS = 25;

/**
 * Eindeutige Beschreibungen → WSET-Begriff (Übersetzen erlaubt, wenn das Zitat klar ist):
 * „sturdy/firm/grippy tannins“ → Tannin hoch, „full-bodied“ → Körper voll, „crisp/fresh
 * acidity“ → Säure hoch. Findet sich ein solcher Begriff im Beleg eines Merkmals, gilt er.
 */
export const CLEAR_TERMS: { key: TasteKey; value: string; re: RegExp; example: string }[] = [
  { key: "tannin", value: "hoch", re: /\b(sturdy|firm|grippy|muscular|robust|high|massive)\b[^.;]{0,20}\btannins?\b/i, example: "sturdy/firm/grippy tannins" },
  { key: "tannin", value: "niedrig", re: /\blow\b[^.;]{0,10}\btannins?\b/i, example: "low tannins" },
  { key: "body", value: "voll", re: /\bfull[- ]bodied\b|\bfull body\b|\bvollmundig\b/i, example: "full-bodied" },
  { key: "body", value: "mittel", re: /\bmedium[- ]bodied\b/i, example: "medium-bodied" },
  { key: "body", value: "schlank", re: /\blight[- ]bodied\b/i, example: "light-bodied" },
  { key: "acidity", value: "hoch", re: /\b(crisp|fresh|bright|vibrant|lively|racy|zesty|high)\b[^.;]{0,15}\bacidity\b/i, example: "crisp/fresh acidity" },
  { key: "acidity", value: "niedrig", re: /\blow\b[^.;]{0,10}\bacidity\b/i, example: "low acidity" },
  { key: "sweetness", value: "trocken", re: /\bbone[- ]dry\b|\btrocken\b/i, example: "bone dry" },
  { key: "finish", value: "lang", re: /\b(long|lingering|persistent)\b[^.;]{0,15}\bfinish\b|\blanger? Abgang\b/i, example: "long/lingering finish" },
  { key: "finish", value: "kurz", re: /\bshort\b[^.;]{0,10}\bfinish\b/i, example: "short finish" },
];

/** WSET-Begriff aus eindeutigen Zitaten; null = keiner; „conflict“ = widersprüchliche Begriffe. */
export function clearTermValue(key: TasteKey, quotes: string[]): string | "conflict" | null {
  const found = new Set(CLEAR_TERMS.filter((t) => t.key === key && quotes.some((q) => t.re.test(q))).map((t) => t.value));
  if (found.size > 1) return "conflict";
  return found.size ? [...found][0] : null;
}

/** Zitat auf höchstens 25 Wörter kürzen. */
export function shortQuote(quote: string) {
  const words = quote.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  return words.length <= MAX_QUOTE_WORDS ? words.join(" ") : `${words.slice(0, MAX_QUOTE_WORDS).join(" ")} …`;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const normUrl = (url: string) => url.trim().replace(/#.*$/, "");

/** Aroma-Lexikon des Weintyps: Gruppe → Aromen. */
export function aromaGroups(type: SatType) {
  const map = new Map<string, string[]>();
  for (const block of aromaBlocksForType(type)) for (const [group, list] of block.groups) map.set(group, [...(map.get(group) ?? []), ...list]);
  return map;
}

/** Sicherheit: hoch = ≥ 2 unabhängige Quellen, davon Weingut oder Kritik, ohne Widerspruch; mittel = 1 gute Quelle; sonst niedrig. */
export function confidenceFor(used: TasteSource[], contradictions: number): Confidence {
  const good = used.some((s) => s.kind === "producer" || s.kind === "critic");
  // Unabhängig = verschiedene Websites bzw. verschiedene Datenblätter.
  const hosts = new Set(used.map((s) => (s.url ? host(s.url) : sourceRef(s))).filter(Boolean));
  if (hosts.size >= 2 && good && contradictions === 0) return "hoch";
  if (good) return "mittel";
  return "niedrig";
}

/**
 * Regel statt Quelle: Rotwein ohne gefundene Süsse gilt als „trocken“. Der Beleg zeigt auf
 * „regel:rotwein-trocken“ – keine Quelle (zählt nicht für die Sicherheit, erscheint nicht als Link).
 */
export const RED_DRY_REF = "regel:rotwein-trocken";
export const RED_DRY_EVIDENCE: Evidence = { quote: "Standard: Rotwein ohne Angabe gilt als trocken", source_url: RED_DRY_REF };

/** Beleg aus einer Regel (kein Zitat einer Quelle) – gilt als gültiger Beleg. */
export const isRuleEvidence = (e: Pick<Evidence, "source_url">) => e.source_url.startsWith("regel:");

/**
 * Rotwein (wines.type = 'red') mit Süsse „unbekannt“ → „trocken“ mit Regel-Beleg. Eine belegte
 * Süsse gilt; widersprechen sich Quellen bei der Süsse, bleibt sie „unbekannt“.
 */
export function applyRedDryRule<P extends Pick<TasteProfileData, "values" | "evidence">>(profile: P, wineType: string | null | undefined, contradicted = false): P {
  if (wineType !== "red" || contradicted || profile.values.sweetness !== UNKNOWN) return profile;
  return { ...profile, values: { ...profile.values, sweetness: "trocken" }, evidence: { ...profile.evidence, sweetness: [RED_DRY_EVIDENCE] } };
}

/**
 * Antwort der Recherche prüfen – vor dem Speichern:
 * - nur Quellen zu genau diesem Wein und genau diesem Jahrgang (NV: Quellen zum Wein);
 *   ohne passende Quelle → kein Profil (null);
 * - Merkmal nur mit gültiger Option und Beleg (Zitat mit Quelle); sonst „unbekannt“;
 *   eindeutige Begriffe im Zitat („sturdy tannins“) gelten (CLEAR_TERMS);
 * - widersprechen sich Quellen → „unbekannt“ und Hinweis;
 * - Aroma nur aus dem Lexikon des Weintyps (passende Gruppe) und mit Beleg; sonst weg;
 * - nichts Belegtes übrig → kein Profil;
 * - Rotwein (wineType 'red') ohne gefundene Süsse → „trocken“ per Regel (applyRedDryRule).
 */
export function validateTasteProfile(
  raw: TasteResearchRaw,
  ctx: {
    type: SatType;
    year: number | null;
    /** Beigelegte Datenblätter (nur passende Jahrgänge) – als Quelle „dokument:<Name>“. */
    documents?: { name: string; year: number | null }[];
    /** wines.type – für die Regel „Rotwein ohne Angabe = trocken“. */
    wineType?: string | null;
  },
): TasteProfileData | null {
  if (!raw.matches_wine) return null;
  // Jahrgangswein: nur Notizen zu genau diesem Jahrgang; andere Jahrgänge zählen nicht.
  if (ctx.year != null && !raw.same_vintage) return null;
  const sources = new Map<string, TasteSource>();
  for (const s of raw.sources) {
    const url = normUrl(s.url);
    // Datenblatt: nur beigelegte, mit dem bekannten Jahrgang des Dokuments.
    if (url.startsWith(DOCUMENT_REF)) {
      const doc = ctx.documents?.find((d) => `${DOCUMENT_REF}${d.name}` === url);
      if (!doc || (ctx.year != null && doc.year !== ctx.year)) continue;
      sources.set(url, { url: null, document: doc.name, title: `Dokument: ${doc.name}`, kind: "document", vintage: doc.year });
      continue;
    }
    if (!/^https?:\/\//.test(url) || !host(url)) continue;
    const kind = (SOURCE_KINDS as readonly string[]).includes(s.kind) ? s.kind : "other";
    const vintage = Number.isInteger(s.vintage) && s.vintage > 1800 ? s.vintage : null;
    if (ctx.year != null && vintage !== ctx.year) continue;
    sources.set(url, { url, title: s.title.trim().slice(0, 200) || host(url)!, kind, vintage });
  }
  if (!sources.size) return null;

  const evidence: Record<string, Evidence[]> = {};
  const used = new Set<string>();
  const proof = (key: string, list: { source_url: string; quote: string }[]) => {
    const ok = list
      .map((e) => ({ source_url: normUrl(e.source_url), quote: shortQuote(e.quote) }))
      .filter((e) => sources.has(e.source_url) && e.quote.length > 0);
    if (!ok.length) return false;
    evidence[key] = [...(evidence[key] ?? []), ...ok];
    for (const e of ok) used.add(e.source_url);
    return true;
  };

  const contradicted = new Set(raw.contradictions.map((c) => c.field));
  const notes = raw.contradictions
    .filter((c) => TASTE_KEYS.includes(c.field as TasteKey))
    .map((c) => `${TASTE_FIELDS.find((f) => f.key === c.field)!.label}: Quellen widersprechen sich${c.note.trim() ? ` (${c.note.trim().slice(0, 160)})` : ""}.`);

  const values = Object.fromEntries(TASTE_KEYS.map((k) => [k, UNKNOWN])) as Record<TasteKey, string>;
  for (const key of TASTE_KEYS) {
    if (contradicted.has(key)) continue;
    const list = raw.evidence.filter((e) => e.field === key && sources.has(normUrl(e.source_url)) && e.quote.trim());
    // Eindeutiger Begriff im Zitat gilt; widersprechen sich die Zitate → unbekannt.
    const term = clearTermValue(key, list.map((e) => e.quote));
    if (term === "conflict") continue;
    const value = term ?? raw.fields[key];
    if (!value || value === UNKNOWN || !tasteOptions(key).includes(value)) continue;
    if (proof(key, list)) values[key] = value;
  }

  const lexicon = aromaGroups(ctx.type);
  const aromas: Record<string, string[]> = {};
  for (const a of raw.aromas) {
    // Nur eindeutige Entsprechungen aus dem Lexikon – nie das „nächstbeste“ Aroma.
    if (!lexicon.get(a.group)?.includes(a.aroma)) continue;
    if (aromas[a.group]?.includes(a.aroma)) continue;
    if (!proof(a.aroma, [{ source_url: a.source_url, quote: a.quote }])) continue;
    aromas[a.group] = [...(aromas[a.group] ?? []), a.aroma];
  }

  const known = TASTE_KEYS.some((k) => values[k] !== UNKNOWN) || Object.keys(aromas).length > 0;
  if (!known) return null;

  const summary = raw.style_summary.trim();
  const styleSummary = summary && proof("style_summary", raw.evidence.filter((e) => e.field === "style_summary")) ? shortSummary(summary) : null;
  const pairing = raw.food_pairing.map((f) => f.trim()).filter(Boolean).slice(0, 6);
  const foodPairing = pairing.length && proof("food_pairing", raw.evidence.filter((e) => e.field === "food_pairing")) ? pairing : [];

  const usedSources = [...sources.entries()].filter(([key]) => used.has(key)).map(([, s]) => s);
  const vintageYear = ctx.year;
  // Erst nach der Prüfung „etwas belegt?“: die Regel allein ergibt kein Profil.
  const ruled = applyRedDryRule({ values, evidence }, ctx.wineType, contradicted.has("sweetness"));
  return {
    values: ruled.values,
    aromas,
    styleSummary,
    foodPairing,
    sources: usedSources,
    evidence: ruled.evidence,
    confidence: confidenceFor(usedSources, notes.length),
    sourceNote: notes.length ? notes.join(" ") : null,
    vintageYear,
  };
}

// ---------------------------------------------------------------------------
// Anzeige

/** Stufe 0…1 für den Balken; null = unbekannt. */
export function tasteLevel(key: TasteKey, value: string): number | null {
  const options = tasteOptions(key);
  const i = options.indexOf(value);
  if (i < 0) return null;
  return options.length === 1 ? 1 : i / (options.length - 1);
}

const BODY_WORD: Record<string, string> = {
  schlank: "Schlank",
  "mittel (−)": "Eher leicht",
  mittel: "Mittelkräftig",
  "mittel (+)": "Kräftig",
  voll: "Vollmundig",
};
const TANNIN_WORD: Record<string, string> = {
  niedrig: "wenig Tannin",
  "mittel (−)": "zartes Tannin",
  mittel: "mittleres Tannin",
  "mittel (+)": "viel Tannin",
  hoch: "viel Tannin",
};
const ACID_WORD: Record<string, string> = { "mittel (+)": "frische Säure", hoch: "lebhafte Säure" };

/** Eine Zeile für den Bot: „Kräftig, trocken, viel Tannin – Schwarze Johannisbeere, Vanille“. */
export function tasteLine(p: Pick<TasteProfileData, "values" | "aromas">) {
  const v = p.values;
  const words = [
    BODY_WORD[v.body],
    v.sweetness !== UNKNOWN ? v.sweetness : null,
    TANNIN_WORD[v.tannin],
    ACID_WORD[v.acidity],
  ].filter(Boolean) as string[];
  if (words.length) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  const aromas = Object.values(p.aromas).flat().slice(0, 3);
  return [words.join(", "), aromas.join(", ")].filter(Boolean).join(" – ") || null;
}

/** Stil in höchstens zwei kurzen Sätzen (ca. 220 Zeichen). */
export function shortSummary(text: string) {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if (out && (out + s).length > 220) break;
    out += s;
  }
  out = out.trim();
  return out.length > 220 ? `${out.slice(0, 217).replace(/\s+\S*$/, "")} …` : out;
}

/** Reihenfolge der Aromen: Frucht → Floral → Gewürz (auch Kräuter, mineralisch) → Eiche (auch Hefe, BSA) → Reife. */
export function aromaRank(group: string) {
  if (/entwicklung|reife|oxidation|tertiär/i.test(group)) return 4;
  if (/frucht|früchte|obst/i.test(group)) return 0;
  if (/floral/i.test(group)) return 1;
  if (/eiche|hefe|säureabbau|autolyse/i.test(group)) return 3;
  return 2;
}

export const MAX_AROMA_CHIPS = 10;

/** Aromen als eine Reihe Chips ohne Gruppentitel, sortiert nach Gruppe, höchstens 10. */
export function aromaChips(aromas: Record<string, string[]>) {
  return Object.entries(aromas)
    .map(([group, list], i) => ({ rank: aromaRank(group), i, list }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .flatMap((g) => g.list)
    .filter((a, i, all) => all.indexOf(a) === i)
    .slice(0, MAX_AROMA_CHIPS);
}

/** Punkte auf der 5-Stufen-Skala (0–4); null = unbekannt. */
export function tasteStep(key: TasteKey, value: string | null | undefined) {
  const level = value ? tasteLevel(key, value) : null;
  return level == null ? null : Math.round(level * 4);
}

/** Zeilen der Karte: nur bekannte Merkmale, in fester Reihenfolge. */
export function tasteRows(p: Pick<TasteProfileData, "values">, keys: readonly TasteKey[] = TASTE_KEYS) {
  return TASTE_FIELDS.filter((f) => keys.includes(f.key) && p.values[f.key] && p.values[f.key] !== UNKNOWN).map((f) => ({
    key: f.key,
    sat: f.sat,
    label: f.label,
    value: p.values[f.key],
    step: tasteStep(f.key, p.values[f.key])!,
  }));
}

export const NO_RELIABLE_PROFILE = "Keine verlässlichen Angaben gefunden.";
export const NO_VINTAGE_PROFILE = "Keine Angaben zu diesem Jahrgang gefunden.";
/** Meldung ohne Fund: Jahrgang → „Keine Angaben zu diesem Jahrgang gefunden.“, NV → allgemein. */
export const noProfileText = (year: number | null) => (year == null ? NO_RELIABLE_PROFILE : NO_VINTAGE_PROFILE);

/** Zeile aus wine_taste_profiles → Profil. */
export function fromRow(row: {
  id: string;
  wine_id: string;
  vintage_year: number | null;
  sweetness: string | null;
  acidity: string | null;
  tannin: string | null;
  alcohol: string | null;
  body: string | null;
  flavour_intensity: string | null;
  finish: string | null;
  aromas: unknown;
  style_summary: string | null;
  food_pairing: string[];
  source: string;
  source_note: string | null;
  researched_at: string | null;
  sources: unknown;
  evidence: unknown;
  confidence: string | null;
}): StoredTasteProfile {
  const values = Object.fromEntries(TASTE_KEYS.map((k) => [k, (row[k] as string | null) ?? UNKNOWN])) as Record<TasteKey, string>;
  return {
    id: row.id,
    wineId: row.wine_id,
    vintageYear: row.vintage_year,
    values,
    aromas: (row.aromas && typeof row.aromas === "object" ? row.aromas : {}) as Record<string, string[]>,
    styleSummary: row.style_summary,
    foodPairing: row.food_pairing ?? [],
    sources: (Array.isArray(row.sources) ? row.sources : []) as TasteSource[],
    evidence: (row.evidence && typeof row.evidence === "object" ? row.evidence : {}) as Record<string, Evidence[]>,
    confidence: (["hoch", "mittel", "niedrig"].includes(row.confidence ?? "") ? row.confidence : null) as Confidence | null,
    sourceNote: row.source_note,
    source: row.source === "manual" ? "manual" : "research",
    researchedAt: row.researched_at,
  };
}

/** Profil → Spalten von wine_taste_profiles. */
export function toRow(p: TasteProfileData) {
  return {
    sweetness: p.values.sweetness,
    acidity: p.values.acidity,
    tannin: p.values.tannin,
    alcohol: p.values.alcohol,
    body: p.values.body,
    flavour_intensity: p.values.flavour_intensity,
    finish: p.values.finish,
    aromas: p.aromas,
    style_summary: p.styleSummary,
    food_pairing: p.foodPairing,
    sources: p.sources,
    evidence: p.evidence,
    confidence: p.confidence,
    source_note: p.sourceNote,
  };
}
