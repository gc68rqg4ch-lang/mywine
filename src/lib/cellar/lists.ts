// Einträge für die Listen „Offen“ und „Getrunken“ – gleiche Form wie der Bestand
// (Groupable), damit Suche, Gruppierung und Karten dieselben sind.

import { daysSince, zurichDate, type WineType } from "@/lib/format";
import { priceClass, sortVintages, type Groupable, type GroupUnit } from "./overview";

type WineInfo = {
  name: string;
  producer: string;
  country: string | null;
  region: string | null;
  type: WineType | null;
};

// ---------------------------------------------------------------------------
// Offen: ein Eintrag pro offener Flasche

export type OpenEntry = Groupable & {
  itemId: string;
  wine_id: string;
  fill: number | null;
  dateOpened: string | null;
  days: number | null;
  bottleSizeMl: number | null;
};

export function toOpenEntry(
  r: WineInfo & {
    inventory_item_id: string;
    wine_id: string;
    vintage_year: number | null;
    purchase_price: number | null;
    fill_level_percent: number | null;
    date_opened: string | null;
    bottle_size_ml: number | null;
  },
  grapes: string[],
): OpenEntry {
  return {
    itemId: r.inventory_item_id,
    wine_id: r.wine_id,
    name: r.name,
    producer: r.producer,
    country: r.country,
    region: r.region,
    type: r.type,
    grapes,
    vintages: [r.vintage_year],
    units: [{ vintage_year: r.vintage_year, price_class: priceClass(r.purchase_price), count: 1 }],
    fill: r.fill_level_percent,
    dateOpened: r.date_opened,
    days: daysSince(r.date_opened),
    bottleSizeMl: r.bottle_size_ml,
  };
}

export function openTotals(entries: OpenEntry[]) {
  const longest = entries.reduce<OpenEntry | null>(
    (best, e) => (e.days != null && (best?.days == null || e.days > best.days) ? e : best),
    null,
  );
  const fills = entries.map((e) => e.fill).filter((f): f is number => f != null);
  return {
    count: entries.length,
    longest,
    avgFill: fills.length ? Math.round(fills.reduce((s, f) => s + f, 0) / fills.length) : null,
  };
}

// ---------------------------------------------------------------------------
// Getrunken: ein Eintrag pro Wein

export type DrunkBottle = {
  itemId: string;
  wine_id: string;
  vintage_year: number | null;
  quantity: number;
  purchase_price: number | null;
  drunk_at: string | null;
  /** Alte Bewertung aus dem Import (ohne Person). */
  legacy_rating: number | null;
  wine: WineInfo;
};

export type RatingRow = {
  wine_id: string | null;
  person_name: string | null;
  rating: number | null;
  rated_at: string | null;
};

export type PersonRating = { person: string; rating: number };

export type DrunkEntry = Groupable & {
  wine_id: string;
  bottles: number;
  /** Letztes Trinkdatum (YYYY-MM-DD, Zürich); null bei importierten Flaschen. */
  lastDrunk: string | null;
  latestItemId: string;
  ratings: PersonRating[];
  legacyRating: number | null;
  /** Für „Lieblingsweine“: Mittel der Personen-Bewertungen, sonst alte Bewertung. */
  score: number | null;
};

/** Neueste Bewertung je Person für einen Wein (über alle Jahrgänge). */
export function latestByPerson(rows: RatingRow[]): PersonRating[] {
  const best = new Map<string, { rating: number; rated_at: string }>();
  for (const r of rows) {
    if (!r.person_name || r.rating == null) continue;
    const prev = best.get(r.person_name);
    if (!prev || (r.rated_at ?? "") > prev.rated_at) best.set(r.person_name, { rating: r.rating, rated_at: r.rated_at ?? "" });
  }
  return [...best.entries()].map(([person, v]) => ({ person, rating: v.rating }));
}

export function buildDrunkEntries(
  bottles: DrunkBottle[],
  grapesByWine: Map<string, string[]>,
  ratingsByWine: Map<string, RatingRow[]>,
  personOrder: string[] = [],
): DrunkEntry[] {
  const byWine = new Map<string, DrunkBottle[]>();
  for (const b of bottles) byWine.set(b.wine_id, [...(byWine.get(b.wine_id) ?? []), b]);

  const entries: DrunkEntry[] = [];
  for (const [wineId, list] of byWine) {
    const units: GroupUnit[] = list.map((b) => ({
      vintage_year: b.vintage_year,
      price_class: priceClass(b.purchase_price),
      count: b.quantity,
      drunk_on: zurichDate(b.drunk_at),
    }));
    const latest = [...list].sort((a, b) => (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""))[0];
    const ratings = latestByPerson(ratingsByWine.get(wineId) ?? []).sort(
      (a, b) => rank(personOrder, a.person) - rank(personOrder, b.person),
    );
    const legacy = list.map((b) => b.legacy_rating).filter((r): r is number => r != null);
    const legacyRating = legacy.length ? Math.max(...legacy) : null;
    const score = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : legacyRating;
    entries.push({
      ...latest.wine,
      wine_id: wineId,
      grapes: grapesByWine.get(wineId) ?? [],
      vintages: sortVintages([...new Set(list.map((b) => b.vintage_year))]),
      units,
      bottles: units.reduce((s, u) => s + u.count, 0),
      lastDrunk: zurichDate(latest.drunk_at),
      latestItemId: latest.itemId,
      ratings,
      legacyRating,
      score,
    });
  }
  // Zuletzt getrunkene zuerst, Importe ohne Datum danach alphabetisch.
  return entries.sort(
    (a, b) =>
      (b.lastDrunk ?? "").localeCompare(a.lastDrunk ?? "") ||
      a.producer.localeCompare(b.producer, "de-CH") ||
      a.name.localeCompare(b.name, "de-CH"),
  );
}

function rank(order: string[], person: string) {
  const i = order.indexOf(person);
  return i < 0 ? order.length : i;
}

export function drunkTotals(entries: DrunkEntry[], year: string) {
  let thisYear = 0;
  let thisYearWines = 0;
  for (const e of entries) {
    const n = e.units.filter((u) => u.drunk_on?.startsWith(year)).reduce((s, u) => s + u.count, 0);
    thisYear += n;
    if (n) thisYearWines += 1;
  }
  const favorites = entries
    .filter((e) => e.score != null)
    .sort((a, b) => b.score! - a.score! || (b.lastDrunk ?? "").localeCompare(a.lastDrunk ?? ""))
    .slice(0, 3);
  const recent = entries.filter((e) => e.lastDrunk).slice(0, 3);
  return { thisYear, thisYearWines, favorites, recent };
}
