// Lücken je Wein für die Recherche (rein, ohne DB): welche Angaben fehlen – im Bestand
// (ungeöffnete oder offene Flaschen) bzw. über alle Jahrgänge mit Flaschen oder „Verkostet“.

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
  producer: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  type: string | null;
  alcohol_content: number | null;
  grapes: string[];
  /** Letzte erfolgreiche Recherche */
  researched_at?: string | null;
};

/** Schon Recherchiertes so lange überspringen (Sammellauf, Option „Geschmacksprofil fehlt“, automatische Suche). */
export const RECENT_MONTHS = 12;

/** Zeitpunkt innerhalb der letzten 12 Monate? */
export function withinRecentMonths(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - RECENT_MONTHS);
  return Date.parse(iso) > limit.getTime();
}

/** In den letzten 12 Monaten recherchiert (wines.researched_at)? */
export function researchedRecently(wine: Pick<GapWine, "researched_at">, now = Date.now()) {
  return withinRecentMonths(wine.researched_at, now);
}
export type GapItem = { wine_id: string; vintage_year: number | null; status: string };
export type GapVintage = {
  wine_id: string;
  vintage_year: number | null;
  drink_from_year: number | null;
  drink_until_year: number | null;
  /** Letzte Profilsuche für diesen Jahrgang (auch ohne Fund). */
  taste_profile_checked_at?: string | null;
};

/** Schlüssel „Wein|Jahrgang“ für vorhandene Geschmacksprofile. */
export const profileKey = (wineId: string, year: number | null) => `${wineId}|${year ?? "nv"}`;
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

/** Status für verkostete Jahrgänge (wine_encounters) – zählen nur im Umfang „alle“. */
export const TASTED = "tasted";

const inScope = (status: string, scope: ResearchScope) => scope === "all" || status === "sealed" || status === "open";

/** Lücken eines Weins für die Jahrgänge mit Flaschen (bzw. verkostet) im gewählten Umfang; null = keine im Umfang. */
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

/**
 * Jahrgänge ohne Geschmacksprofil (neueste zuerst, NV zuletzt). Jahrgänge mit Profil nie;
 * mit skipRecent auch keine, die in den letzten 12 Monaten (ohne Fund) gesucht wurden.
 */
export function tasteTargets(
  g: WineGaps,
  data: { vintages: GapVintage[]; profiles: Set<string> },
  options: { skipRecent: boolean; now?: number },
): (number | null)[] {
  const years = [...new Set(g.vintages.map((v) => v.year))];
  const checked = (y: number | null) =>
    data.vintages.find((v) => v.wine_id === g.wine.id && v.vintage_year === y)?.taste_profile_checked_at ?? null;
  return years
    .filter((y) => !data.profiles.has(profileKey(g.wine.id, y)))
    .filter((y) => !options.skipRecent || !withinRecentMonths(checked(y), options.now))
    .sort((a, b) => (b ?? -1) - (a ?? -1));
}
