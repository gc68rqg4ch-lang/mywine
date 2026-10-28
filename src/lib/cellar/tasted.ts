// Liste „Verkostet“: ein Eintrag pro Wein aus wine_encounters – gleiche Form wie die anderen
// Listen (Groupable), damit Suche, Weintyp-Filter und Gruppierung dieselben sind. Jede
// Verkostung zählt als Einheit (Jahrgang, Preisklasse, Datum, Ort). Rein, ohne DB.

import { compareWineNames, type WineType } from "@/lib/format";
import { latestByPerson, type PersonRating, type RatingRow } from "./lists";
import { priceClass, sortVintages, type Groupable, type GroupUnit } from "./overview";

export type EncounterRow = {
  id: string;
  wine_id: string;
  vintage_year: number | null;
  tasted_on: string;
  price: number | null;
  price_unit: string | null;
  currency: string | null;
  created_at: string;
  place: { name: string } | null;
};

export type TastedWineInfo = {
  id: string;
  name: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  type: WineType | null;
  want_to_buy: boolean;
};

export type TastedEntry = Groupable & {
  wine_id: string;
  /** Anzahl Verkostungen */
  count: number;
  lastTasted: string;
  lastPlace: string | null;
  /** Jahrgang der letzten Verkostung (für den Link auf die Weinseite). */
  latestVintage: number | null;
  ratings: PersonRating[];
  wantToBuy: boolean;
  /** Ungeöffnete und offene Flaschen im Bestand (Hinweis „im Bestand: N“). */
  inStock: number;
};

/** Preisklasse nur für Flaschenpreise in CHF (Glaspreise und Fremdwährungen sind nicht vergleichbar). */
export function encounterPriceClass(e: Pick<EncounterRow, "price" | "price_unit" | "currency">) {
  return e.price_unit === "bottle" && (e.currency ?? "CHF") === "CHF" ? priceClass(e.price) : null;
}

export function buildTastedEntries(
  encounters: EncounterRow[],
  wines: Map<string, TastedWineInfo>,
  grapesByWine: Map<string, string[]>,
  ratingsByWine: Map<string, RatingRow[]>,
  stockByWine: Map<string, number>,
  personOrder: string[] = [],
): TastedEntry[] {
  const byWine = new Map<string, EncounterRow[]>();
  for (const e of encounters) byWine.set(e.wine_id, [...(byWine.get(e.wine_id) ?? []), e]);

  const entries: TastedEntry[] = [];
  for (const [wineId, list] of byWine) {
    const wine = wines.get(wineId);
    if (!wine) continue;
    const sorted = [...list].sort((a, b) => b.tasted_on.localeCompare(a.tasted_on) || b.created_at.localeCompare(a.created_at));
    const latest = sorted[0];
    const units: GroupUnit[] = sorted.map((e) => ({
      vintage_year: e.vintage_year,
      price_class: encounterPriceClass(e),
      count: 1,
      drunk_on: e.tasted_on,
      place: e.place?.name ?? null,
    }));
    const order = (person: string) => {
      const i = personOrder.indexOf(person);
      return i < 0 ? personOrder.length : i;
    };
    entries.push({
      wine_id: wineId,
      name: wine.name,
      producer: wine.producer,
      country: wine.country,
      region: wine.region,
      type: wine.type,
      grapes: grapesByWine.get(wineId) ?? [],
      vintages: sortVintages([...new Set(sorted.map((e) => e.vintage_year))]),
      units,
      count: sorted.length,
      lastTasted: latest.tasted_on,
      lastPlace: latest.place?.name ?? null,
      latestVintage: latest.vintage_year,
      ratings: latestByPerson(ratingsByWine.get(wineId) ?? []).sort((a, b) => order(a.person) - order(b.person)),
      wantToBuy: wine.want_to_buy,
      inStock: stockByWine.get(wineId) ?? 0,
    });
  }
  // Zuletzt verkostete zuerst.
  return entries.sort(
    (a, b) =>
      b.lastTasted.localeCompare(a.lastTasted) ||
      compareWineNames(a, b),
  );
}

/** Kacheln: Verkostungen im Jahr, Merker „Kaufen?“, zuletzt verkostet. */
export function tastedTotals(entries: TastedEntry[], year: string) {
  let thisYear = 0;
  let thisYearWines = 0;
  for (const e of entries) {
    const n = e.units.filter((u) => u.drunk_on?.startsWith(year)).length;
    thisYear += n;
    if (n) thisYearWines += 1;
  }
  const toBuy = entries.filter((e) => e.wantToBuy);
  return { thisYear, thisYearWines, total: entries.reduce((s, e) => s + e.count, 0), toBuy, recent: entries.slice(0, 3) };
}
