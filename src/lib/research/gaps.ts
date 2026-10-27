// Lücken je Wein für die Recherche (rein, ohne DB): welche Angaben fehlen – im Bestand
// (ungeöffnete oder offene Flaschen) bzw. über alle Jahrgänge mit Flaschen.

export type ResearchScope = "cellar" | "all";

export const GAP_KEYS = ["grapePercent", "grapes", "alcohol", "window", "origin"] as const;
export type GapKey = (typeof GAP_KEYS)[number];

export const GAP_LABELS: Record<GapKey, string> = {
  grapePercent: "Rebsorten ohne %",
  grapes: "Rebsorten fehlen",
  alcohol: "Alkohol",
  window: "Trinkfenster",
  origin: "Region/Appellation",
};

export type GapWine = {
  id: string;
  name: string;
  producer: string;
  country: string | null;
  region: string | null;
  appellation: string | null;
  type: string | null;
  alcohol_content: number | null;
  grapes: string[];
  /** Letzte erfolgreiche Recherche */
  researched_at?: string | null;
};

export const RECENT_DAYS = 7;

/** In den letzten 7 Tagen recherchiert? */
export function researchedRecently(wine: Pick<GapWine, "researched_at">, now = Date.now()) {
  return wine.researched_at != null && now - Date.parse(wine.researched_at) < RECENT_DAYS * 86_400_000;
}
export type GapItem = { wine_id: string; vintage_year: number | null; status: string };
export type GapVintage = { wine_id: string; vintage_year: number | null; drink_from_year: number | null; drink_until_year: number | null };
export type GapShare = { wine_id: string; vintage_year: number | null; grape: string; percent: number | null; source: string };

export type VintageGap = {
  year: number | null;
  window: boolean;
  grapes: boolean;
  grapesMissing: boolean;
  knownGrapes: string[];
};

export type WineGaps = {
  wine: GapWine;
  /** Kategorien der Übersicht */
  gaps: GapKey[];
  /** Land oder Typ fehlen (wird mit ergänzt, ohne eigene Kategorie). */
  basics: boolean;
  vintages: VintageGap[];
};

const inScope = (status: string, scope: ResearchScope) => scope === "all" || status === "sealed" || status === "open";

/** Lücken eines Weins für die Jahrgänge mit Flaschen im gewählten Umfang; null = keine Flaschen im Umfang. */
export function wineGaps(
  wine: GapWine,
  data: { items: GapItem[]; vintages: GapVintage[]; shares: GapShare[] },
  scope: ResearchScope,
): WineGaps | null {
  const years = [
    ...new Set(data.items.filter((i) => i.wine_id === wine.id && inScope(i.status, scope)).map((i) => i.vintage_year)),
  ];
  if (!years.length) return null;
  const shares = data.shares.filter((s) => s.wine_id === wine.id);
  const general = shares.filter((s) => s.vintage_year == null);

  const vintages: VintageGap[] = years.map((year) => {
    const specific = year == null ? [] : shares.filter((s) => s.vintage_year === year);
    const effective = specific.length ? specific : general;
    const manual = effective.some((s) => s.source === "manual");
    const names = effective.length ? effective.map((s) => s.grape) : wine.grapes;
    const grapesMissing = names.length === 0;
    const percentMissing = !grapesMissing && !manual && !effective.some((s) => s.percent != null);
    const window = data.vintages.find((v) => v.wine_id === wine.id && v.vintage_year === year);
    return {
      year,
      window: year != null && (window?.drink_from_year == null || window?.drink_until_year == null),
      grapes: grapesMissing || percentMissing,
      grapesMissing,
      knownGrapes: names,
    };
  });

  const gaps: GapKey[] = [];
  if (vintages.some((v) => v.grapes && !v.grapesMissing)) gaps.push("grapePercent");
  if (vintages.some((v) => v.grapesMissing)) gaps.push("grapes");
  if (wine.alcohol_content == null) gaps.push("alcohol");
  if (vintages.some((v) => v.window)) gaps.push("window");
  if (wine.region == null || wine.appellation == null) gaps.push("origin");
  return { wine, gaps, basics: wine.country == null || wine.type == null, vintages };
}

/** true, wenn es für den Wein etwas zu recherchieren gibt. */
export const needsResearch = (g: WineGaps) => g.gaps.length > 0 || g.basics;

/** Anzahl Weine je Lücke. */
export function gapCounts(list: WineGaps[]) {
  const counts = Object.fromEntries(GAP_KEYS.map((k) => [k, 0])) as Record<GapKey, number>;
  for (const g of list) for (const k of g.gaps) counts[k]++;
  return counts;
}
