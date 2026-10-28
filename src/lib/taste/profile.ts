// Geschmacksprofil eines Weins (wine_taste_profiles) – rein, auch im Browser nutzbar.
// Oberstes Ziel: kein falsches Profil. Jedes Merkmal und jedes Aroma braucht einen Beleg
// (kurzes Zitat mit Quelle); ohne Beleg „unbekannt“ bzw. weggelassen. Begriffe wie im
// WSET-Tool (SAT): dieselben Optionen und dasselbe Aroma-Lexikon.

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

export const SOURCE_KINDS = ["producer", "critic", "merchant", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  producer: "Weingut",
  critic: "Kritik",
  merchant: "Händler",
  other: "Andere",
};

export type TasteSource = { url: string; title: string; kind: SourceKind; vintage: number | null };
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
  const hosts = new Set(used.map((s) => host(s.url)).filter(Boolean));
  if (hosts.size >= 2 && good && contradictions === 0) return "hoch";
  if (good) return "mittel";
  return "niedrig";
}

/**
 * Antwort der Recherche prüfen – vor dem Speichern:
 * - nur Quellen zu genau diesem Wein; ohne Quelle → kein Profil (null);
 * - Merkmal nur mit gültiger Option und Beleg (Zitat mit Quelle); sonst „unbekannt“;
 * - widersprechen sich Quellen → „unbekannt“ und Hinweis;
 * - Aroma nur aus dem Lexikon des Weintyps (passende Gruppe) und mit Beleg; sonst weg;
 * - nichts Belegtes übrig → kein Profil.
 */
export function validateTasteProfile(raw: TasteResearchRaw, ctx: { type: SatType; year: number | null }): TasteProfileData | null {
  if (!raw.matches_wine) return null;
  const sources = new Map<string, TasteSource>();
  for (const s of raw.sources) {
    const url = normUrl(s.url);
    if (!/^https?:\/\//.test(url) || !host(url)) continue;
    const kind = (SOURCE_KINDS as readonly string[]).includes(s.kind) ? s.kind : "other";
    sources.set(url, { url, title: s.title.trim().slice(0, 200) || host(url)!, kind, vintage: Number.isInteger(s.vintage) && s.vintage > 1800 ? s.vintage : null });
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
    const value = raw.fields[key];
    if (!value || value === UNKNOWN || !tasteOptions(key).includes(value) || contradicted.has(key)) continue;
    if (proof(key, raw.evidence.filter((e) => e.field === key))) values[key] = value;
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
  const styleSummary = summary && proof("style_summary", raw.evidence.filter((e) => e.field === "style_summary")) ? summary.slice(0, 400) : null;
  const pairing = raw.food_pairing.map((f) => f.trim()).filter(Boolean).slice(0, 6);
  const foodPairing = pairing.length && proof("food_pairing", raw.evidence.filter((e) => e.field === "food_pairing")) ? pairing : [];

  const usedSources = [...sources.values()].filter((s) => used.has(s.url));
  const vintageYear = ctx.year != null && raw.same_vintage && usedSources.some((s) => s.vintage === ctx.year) ? ctx.year : null;
  return {
    values,
    aromas,
    styleSummary,
    foodPairing,
    sources: usedSources,
    evidence,
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

/** „Laut Recherche · Sicherheit hoch · 3 Quellen“ bzw. „Von dir erfasst“. */
export function tasteSourceLine(p: Pick<StoredTasteProfile, "source" | "confidence" | "sources">) {
  if (p.source === "manual") return p.sources.length ? `Von dir angepasst · ${p.sources.length === 1 ? "1 Quelle" : `${p.sources.length} Quellen`}` : "Von dir erfasst";
  return [
    "Laut Recherche",
    p.confidence ? `Sicherheit ${p.confidence}` : null,
    p.sources.length === 1 ? "1 Quelle" : `${p.sources.length} Quellen`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const NO_RELIABLE_PROFILE = "Keine verlässlichen Angaben gefunden.";

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
