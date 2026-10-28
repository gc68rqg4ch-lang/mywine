// Filter der Listen (Bestand, Offen, Getrunken, Verkostet) – reine Funktionen.
// Wein-Ebene: Land, Region, Rebsorte, Bewertung. Einheiten-Ebene (Jahrgang, Preisklasse,
// Trinkreife, Händler): ein Eintrag behält nur passende Einheiten (z. B. nur die Flaschen
// des passenden Jahrgangs) und fällt weg, wenn keine bleibt.

import { TYPE_ORDER, typeOf, type ListFilters, type TypeFilter } from "./list-params";
import { DRINK_STATUS_ORDER, PRICE_CLASSES, drinkStatus, sortVintages, type DrinkStatus, type Groupable, type GroupUnit } from "./overview";

export type Filterable = Groupable & { ratings?: { person: string; rating: number }[] };

const unitStatus = (u: GroupUnit, year: number) => drinkStatus(u.drink_from_year ?? null, u.drink_until_year ?? null, year);

function unitFilterActive(f: ListFilters) {
  return f.yearFrom != null || f.yearTo != null || f.priceClasses.length > 0 || f.drink.length > 0 || f.vendors.length > 0;
}

function unitMatches(u: GroupUnit, f: ListFilters, year: number) {
  if (f.yearFrom != null && (u.vintage_year == null || u.vintage_year < f.yearFrom)) return false;
  if (f.yearTo != null && (u.vintage_year == null || u.vintage_year > f.yearTo)) return false;
  if (f.priceClasses.length && !(u.price_class != null && f.priceClasses.includes(u.price_class))) return false;
  if (f.drink.length && !f.drink.includes(unitStatus(u, year))) return false;
  // Ohne Händler fällt die Einheit bei aktivem Händler-Filter weg.
  if (f.vendors.length && !(u.vendors ?? []).some((v) => f.vendors.includes(v))) return false;
  return true;
}

function wineMatches(e: Filterable, f: ListFilters) {
  if (f.countries.length && !(e.country != null && f.countries.includes(e.country))) return false;
  if (f.regions.length && !(e.region != null && f.regions.includes(e.region))) return false;
  if (f.grapes.length && !e.grapes.some((g) => f.grapes.includes(g))) return false;
  if (f.minRating != null) {
    const min = f.minRating;
    const ratings = (e.ratings ?? []).filter((r) => f.ratingBy == null || r.person === f.ratingBy);
    if (!ratings.some((r) => r.rating >= min)) return false;
  }
  return true;
}

/** Wendet alle Filter an; year = aktuelles Jahr (für die Trinkreife). */
export function applyFilters<T extends Filterable>(entries: T[], f: ListFilters, year: number): T[] {
  const units = unitFilterActive(f);
  const out: T[] = [];
  for (const e of entries) {
    if (!wineMatches(e, f)) continue;
    if (!units) {
      out.push(e);
      continue;
    }
    const kept = e.units.filter((u) => unitMatches(u, f, year));
    if (!kept.some((u) => u.count > 0)) continue;
    out.push({ ...e, units: kept, vintages: sortVintages([...new Set(kept.map((u) => u.vintage_year))]) });
  }
  return out;
}

export type FilterOptions = {
  countries: string[];
  /** Regionen – bei gewähltem Land nur dessen Regionen. */
  regions: string[];
  grapes: string[];
  years: number[];
  priceClasses: string[];
  drink: DrinkStatus[];
  persons: string[];
  vendors: string[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "de-CH"));

/** Beitrag eines Eintrags zur Auswahl im Filterfeld (klein, für die Suche im Browser). */
export type OptionPart = {
  country: string | null;
  region: string | null;
  grapes: string[];
  years: number[];
  priceClasses: string[];
  drink: DrinkStatus[];
  persons: string[];
  vendors: string[];
};

export function optionPart(e: Filterable, year: number): OptionPart {
  const units = e.units.filter((u) => u.count > 0);
  return {
    country: e.country,
    region: e.region,
    grapes: e.grapes,
    years: [...new Set(units.flatMap((u) => (u.vintage_year == null ? [] : [u.vintage_year])))],
    priceClasses: [...new Set(units.flatMap((u) => (u.price_class ? [u.price_class] : [])))],
    drink: [...new Set(units.map((u) => unitStatus(u, year)))],
    persons: [...new Set((e.ratings ?? []).map((r) => r.person))],
    vendors: [...new Set(units.flatMap((u) => u.vendors ?? []))],
  };
}

/**
 * Auswahl im Filterfeld aus den Beiträgen: nur Werte, die in der Liste vorkommen; gewählte
 * Werte bleiben immer sichtbar (sonst liessen sie sich nicht abwählen).
 */
export function mergeOptions(parts: OptionPart[], f: ListFilters): FilterOptions {
  const inCountry = f.countries.length ? parts.filter((p) => p.country != null && f.countries.includes(p.country)) : parts;
  const drink = new Set(parts.flatMap((p) => p.drink));
  const prices = new Set(parts.flatMap((p) => p.priceClasses));
  return {
    countries: sorted([...parts.flatMap((p) => (p.country ? [p.country] : [])), ...f.countries]),
    regions: sorted([...inCountry.flatMap((p) => (p.region ? [p.region] : [])), ...f.regions]),
    grapes: sorted([...parts.flatMap((p) => p.grapes), ...f.grapes]),
    years: [...new Set(parts.flatMap((p) => p.years))].sort((a, b) => a - b),
    priceClasses: PRICE_CLASSES.filter((c) => prices.has(c) || f.priceClasses.includes(c)),
    drink: DRINK_STATUS_ORDER.filter((s) => drink.has(s) || f.drink.includes(s)),
    persons: sorted(parts.flatMap((p) => p.persons)),
    vendors: sorted([...parts.flatMap((p) => p.vendors), ...f.vendors]),
  };
}

/** Auswahl im Filterfeld für eine Liste von Einträgen. */
export function filterOptions(entries: Filterable[], f: ListFilters, year: number): FilterOptions {
  return mergeOptions(entries.map((e) => optionPart(e, year)), f);
}

/** Trinkfenster je Wein + Jahrgang an die Einheiten hängen (Getrunken, Verkostet). */
export function withDrinkWindows<T extends Groupable>(
  entries: T[],
  windows: { wine_id: string; vintage_year: number | null; drink_from_year: number | null; drink_until_year: number | null; drink_window_source?: string | null }[],
  wineId: (e: T) => string,
): T[] {
  const byKey = new Map(windows.map((w) => [`${w.wine_id}|${w.vintage_year}`, w]));
  return entries.map((e) => ({
    ...e,
    units: e.units.map((u) => {
      const w = byKey.get(`${wineId(e)}|${u.vintage_year}`);
      return w ? { ...u, drink_from_year: w.drink_from_year, drink_until_year: w.drink_until_year, drink_source: w.drink_window_source ?? null } : u;
    }),
  }));
}

/**
 * Anzahl je Weintyp für Knöpfe und Chips: Flaschen (Einheiten) bzw. Weine (Verkostet).
 * Die sechs Typen immer, „Unbekannt“ nur, wenn vorhanden.
 */
export function typeCounts<T extends Filterable>(entries: T[], mode: "bottles" | "wines"): { type: TypeFilter; count: number }[] {
  return TYPE_ORDER.map((type) => {
    const list = entries.filter((e) => typeOf(e) === type);
    const count = mode === "wines" ? list.length : list.reduce((s, e) => s + e.units.reduce((n, u) => n + u.count, 0), 0);
    return { type, count };
  }).filter((c) => c.type !== "unknown" || c.count > 0);
}

/** Wie typeCounts, aber als Beiträge je Eintrag ([ID, Anzahl]) – gezählt wird live im Browser. */
export function typeCountParts<T extends Filterable>(entries: T[], mode: "bottles" | "wines", idOf: (e: T) => string): { type: TypeFilter; parts: [string, number][] }[] {
  return TYPE_ORDER.map((type) => ({
    type,
    parts: entries
      .filter((e) => typeOf(e) === type)
      .map((e): [string, number] => [idOf(e), mode === "wines" ? 1 : e.units.reduce((n, u) => n + u.count, 0)]),
  })).filter(({ type, parts }) => type !== "unknown" || parts.length > 0);
}
