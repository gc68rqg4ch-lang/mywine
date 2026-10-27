// Recherche gegen gespeicherte Angaben vergleichen – rein, ohne DB. Toleranzen, damit es
// keine Scheinabweichungen gibt: Alkohol ±0.2, Rebsorten-% ±2 pro Sorte, Texte ohne
// Gross-/Kleinschreibung und Akzente.

import { WINE_TYPE_LABELS, type WineType } from "@/lib/format";
import { formatShares, type GrapeShare } from "@/lib/grapes/shares";

export const SUGGESTION_FIELDS = [
  "producer",
  "country",
  "region",
  "appellation",
  "type",
  "alcohol_content",
  "drink_from_year",
  "drink_until_year",
  "grapes",
] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];

export const SUGGESTION_LABELS: Record<SuggestionField, string> = {
  producer: "Produzent",
  country: "Land",
  region: "Region",
  appellation: "Appellation",
  type: "Typ",
  alcohol_content: "Alkohol",
  drink_from_year: "Trinkreif ab",
  drink_until_year: "Trinkreif bis",
  grapes: "Rebsorten",
};

/** Für den Vergleich: klein, ohne Akzente, Leerräume vereinheitlicht. */
export const normText = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export const ALCOHOL_TOLERANCE = 0.2;
export const PERCENT_TOLERANCE = 2;

/** Gleiche Rebsorten (Namen); Prozente nur verglichen, wo beide eine Angabe haben (±2). */
export function sameGrapes(a: GrapeShare[], b: GrapeShare[]) {
  const map = (list: GrapeShare[]) => new Map(list.map((g) => [normText(g.grape), g.percent]));
  const x = map(a);
  const y = map(b);
  if (x.size !== y.size) return false;
  for (const [grape, p] of x) {
    if (!y.has(grape)) return false;
    const q = y.get(grape);
    if (p != null && q != null && Math.abs(p - q) > PERCENT_TOLERANCE) return false;
  }
  return true;
}

/** Gleicher Wert im Sinne der Toleranzen (beide nicht null). */
export function sameValue(field: SuggestionField, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  switch (field) {
    case "alcohol_content":
      return Math.abs(Number(a) - Number(b)) <= ALCOHOL_TOLERANCE + 1e-9;
    case "drink_from_year":
    case "drink_until_year":
    case "type":
      return a === b;
    case "grapes":
      return sameGrapes(a as GrapeShare[], b as GrapeShare[]);
    default:
      return normText(String(a)) === normText(String(b));
  }
}

/** Rebsorten ohne % gespeichert, Recherche hat % für dieselben Sorten → direkt ergänzen statt vorschlagen. */
export function grapesOnlyAddPercent(stored: GrapeShare[], found: GrapeShare[]) {
  return (
    stored.length > 0 &&
    stored.every((g) => g.percent == null) &&
    found.some((g) => g.percent != null) &&
    sameGrapes(
      stored,
      found.map((g) => ({ ...g, percent: null })),
    )
  );
}

/** Anzeige eines Werts („14.5 %“, „Tempranillo 85 %, Garnacha 15 %“, „Rot“). */
export function displayValue(field: SuggestionField, value: unknown): string {
  if (value == null || value === "") return "–";
  switch (field) {
    case "alcohol_content":
      return `${Number(value).toLocaleString("de-CH")} %`;
    case "type":
      return WINE_TYPE_LABELS[value as WineType] ?? String(value);
    case "grapes":
      return formatShares(value as GrapeShare[]) || "–";
    default:
      return String(value);
  }
}

/** Kurze Quelle aus der ersten URL: „bodegaspintia.com“. */
export function sourceNote(sources: string[]) {
  for (const url of sources) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // nächste versuchen
    }
  }
  return null;
}
