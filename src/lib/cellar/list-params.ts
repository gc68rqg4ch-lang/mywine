// Zustand der Listen (Bestand, Offen, Getrunken, Verkostet) in der URL – rein, ohne React:
// Suche, Gruppierung, gewählter Weintyp, aufgeklappte Gruppen und Filter. So führt „Zurück“
// (Link oder Browser) genau dorthin, wo man war. Der Lagerort steckt im Cookie.

import { DRINK_STATUS_ORDER, type DrinkStatus, type GroupBy } from "./overview";
import { WINE_TYPES, type WineType } from "@/lib/format";

/** Weintyp-Filter: ein Typ aus wine_type oder „unknown“ (ohne Typ). */
export type TypeFilter = WineType | "unknown";

export const TYPE_ORDER: TypeFilter[] = [...WINE_TYPES, "unknown"];

/** Bei der Gruppierung „Weintyp“ ohne Auswahl vorausgewählt. */
export const DEFAULT_TYPE: WineType = "red";

export function typeOf(entry: { type: WineType | null }): TypeFilter {
  return entry.type ?? "unknown";
}

export type ListFilters = {
  countries: string[];
  regions: string[];
  grapes: string[];
  yearFrom: number | null;
  yearTo: number | null;
  priceClasses: string[];
  drink: DrinkStatus[];
  /** Bewertung ab … Sterne (halbe Schritte) */
  minRating: number | null;
  /** Name der Person; null = eine von beiden */
  ratingBy: string | null;
  vendors: string[];
};

export type ListState = {
  query: string;
  groupBy: GroupBy;
  /** Gruppierung Weintyp: gewählter Knopf (Standard Rot); sonst Filter (null = alle). */
  type: TypeFilter | null;
  /** Aufgeklappte Gruppen (Schlüssel wie in groupWines). */
  open: string[];
  filters: ListFilters;
};

export const EMPTY_FILTERS: ListFilters = {
  countries: [],
  regions: [],
  grapes: [],
  yearFrom: null,
  yearTo: null,
  priceClasses: [],
  drink: [],
  minRating: null,
  ratingBy: null,
  vendors: [],
};

type Params = Record<string, string | string[] | undefined>;

const all = (params: Params, key: string) => {
  const v = params[key];
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
};
const one = (params: Params, key: string) => all(params, key)[0] ?? null;
const year = (v: string | null) => (v && /^\d{4}$/.test(v) ? Number(v) : null);

function readFilters(params: Params): ListFilters {
  const rating = Number(one(params, "sterne"));
  return {
    countries: all(params, "land"),
    regions: all(params, "region"),
    grapes: all(params, "traube"),
    yearFrom: year(one(params, "jv")),
    yearTo: year(one(params, "jb")),
    priceClasses: all(params, "preis"),
    drink: all(params, "reife").filter((s): s is DrinkStatus => (DRINK_STATUS_ORDER as string[]).includes(s)),
    minRating: rating > 0 && rating <= 5 && Number.isInteger(rating * 2) ? rating : null,
    ratingBy: one(params, "von_person"),
    vendors: all(params, "haendler"),
  };
}

/** Zustand aus den searchParams einer Liste. */
export function readListState(params: Params, groupings: GroupBy[]): ListState {
  const query = one(params, "q") ?? "";
  const gruppe = one(params, "gruppe");
  const groupBy: GroupBy = gruppe && (groupings as string[]).includes(gruppe) ? (gruppe as GroupBy) : "typ";
  const typ = one(params, "typ");
  const chosen = typ && (TYPE_ORDER as string[]).includes(typ) ? (typ as TypeFilter) : null;
  return {
    query,
    groupBy,
    type: groupBy === "typ" ? (chosen ?? DEFAULT_TYPE) : chosen,
    open: all(params, "auf"),
    filters: readFilters(params),
  };
}

/** Zustand → Query-Parameter (Standardwerte weggelassen). */
export function listSearchParams(state: ListState): URLSearchParams {
  const p = new URLSearchParams();
  const f = state.filters;
  if (state.groupBy !== "typ") p.set("gruppe", state.groupBy);
  if (state.query) p.set("q", state.query);
  if (state.type && !(state.groupBy === "typ" && state.type === DEFAULT_TYPE)) p.set("typ", state.type);
  for (const k of state.open) p.append("auf", k);
  for (const v of f.countries) p.append("land", v);
  for (const v of f.regions) p.append("region", v);
  for (const v of f.grapes) p.append("traube", v);
  if (f.yearFrom != null) p.set("jv", String(f.yearFrom));
  if (f.yearTo != null) p.set("jb", String(f.yearTo));
  for (const v of f.priceClasses) p.append("preis", v);
  for (const v of f.drink) p.append("reife", v);
  if (f.minRating != null) p.set("sterne", String(f.minRating));
  if (f.minRating != null && f.ratingBy) p.set("von_person", f.ratingBy);
  for (const v of f.vendors) p.append("haendler", v);
  return p;
}

export function listHref(basePath: string, state: ListState, patch: Partial<ListState> = {}) {
  const qs = listSearchParams({ ...state, ...patch }).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Anzahl aktiver Filter (für den Knopf „Filter“). */
export function activeFilterCount(f: ListFilters) {
  return (
    f.countries.length +
    f.regions.length +
    f.grapes.length +
    (f.yearFrom != null || f.yearTo != null ? 1 : 0) +
    f.priceClasses.length +
    f.drink.length +
    (f.minRating != null ? 1 : 0) +
    f.vendors.length
  );
}

/** Wert in einer Mehrfachauswahl ein- bzw. ausschalten. */
export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Liste gefiltert nach dem gewählten Typ. */
export function applyTypeFilter<T extends { type: WineType | null }>(entries: T[], type: TypeFilter | null) {
  return type ? entries.filter((e) => typeOf(e) === type) : entries;
}
