// Bestandsübersicht: ein Eintrag pro Wein, gefiltert nach Lagerort und gruppiert.
// Reine Funktionen auf den Zeilen der Views cellar_wine_summary (Wein) und
// cellar_wines (Wein + Jahrgang + Flaschengrösse mit Aufteilung nach Lagerort).

import type { Json, Tables } from "@/lib/database.types";
import { WINE_TYPE_LABELS, type WineType } from "@/lib/format";

export type LocationFilter = { house: string | null; room: string } | null;

export type LocationCount = {
  storage_house: string | null;
  storage_room: string | null;
  sealed: number;
  open: number;
};

export type VintageRow = {
  wine_id: string;
  vintage_year: number | null;
  bottle_size_ml: number | null;
  avg_price: number | null;
  price_class: string | null;
  drink_status: DrinkStatus;
  drink_from_year: number | null;
  drink_until_year: number | null;
  locations: LocationCount[];
};

export type SummaryWine = {
  wine_id: string;
  name: string;
  producer: string;
  country: string | null;
  region: string | null;
  type: WineType | null;
  grapes: string[];
};

export type DrinkStatus = "overdue" | "ready" | "wait" | "unknown";

export const PRICE_CLASSES = ["bis 30", "30–60", "60–100", "100–200", "über 200"] as const;

export const DRINK_STATUS_LABELS: Record<DrinkStatus, string> = {
  overdue: "überfällig",
  ready: "trinkreif",
  wait: "warten",
  unknown: "unbekannt",
};

export type GroupBy = "typ" | "land" | "rebsorte" | "jahrgang" | "preis" | "getrunken";

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  typ: "Weintyp",
  land: "Land",
  rebsorte: "Rebsorte",
  jahrgang: "Jahrgang",
  preis: "Preisklasse",
  getrunken: "Getrunken am",
};

/** Gruppierungen von Bestand und Offen; Getrunken hat zusätzlich „Getrunken am“. */
export const BASE_GROUPINGS: GroupBy[] = ["typ", "land", "rebsorte", "jahrgang", "preis"];

export function isGroupBy(value: unknown, allowed: GroupBy[] = BASE_GROUPINGS): value is GroupBy {
  return typeof value === "string" && (allowed as string[]).includes(value);
}

/** Preisklasse wie public.price_class() in der DB. */
export function priceClass(price: number | null | undefined): string | null {
  if (price == null) return null;
  if (price <= 30) return "bis 30";
  if (price <= 60) return "30–60";
  if (price <= 100) return "60–100";
  if (price <= 200) return "100–200";
  return "über 200";
}

// ---------------------------------------------------------------------------
// Zeilen aus der DB in sichere Typen überführen

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseLocations(json: Json | null): LocationCount[] {
  if (!Array.isArray(json)) return [];
  return json.filter((l): l is { [key: string]: Json | undefined } => isRecord(l)).map((l) => ({
    storage_house: typeof l.storage_house === "string" ? l.storage_house : null,
    storage_room: typeof l.storage_room === "string" ? l.storage_room : null,
    sealed: Number(l.sealed) || 0,
    open: Number(l.open) || 0,
  }));
}

function asDrinkStatus(v: string | null): DrinkStatus {
  return v === "overdue" || v === "ready" || v === "wait" ? v : "unknown";
}

export function toVintageRow(r: Tables<"cellar_wines">): VintageRow | null {
  if (!r.wine_id) return null;
  return {
    wine_id: r.wine_id,
    vintage_year: r.vintage_year,
    bottle_size_ml: r.bottle_size_ml,
    avg_price: r.avg_price,
    price_class: r.price_class,
    drink_status: asDrinkStatus(r.drink_status),
    drink_from_year: r.drink_from_year,
    drink_until_year: r.drink_until_year,
    locations: parseLocations(r.locations),
  };
}

export function toSummaryWine(
  r: Pick<Tables<"cellar_wine_summary">, "wine_id" | "name" | "producer" | "country" | "region" | "type" | "grapes">,
): SummaryWine | null {
  if (!r.wine_id || !r.name || !r.producer) return null;
  return {
    wine_id: r.wine_id,
    name: r.name,
    producer: r.producer,
    country: r.country,
    region: r.region,
    type: r.type,
    grapes: r.grapes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Lagerort-Filter

export function matchesLocation(
  loc: { storage_house: string | null; storage_room: string | null },
  filter: LocationFilter,
) {
  if (!filter) return true;
  return loc.storage_room === filter.room && (filter.house == null || loc.storage_house === filter.house);
}

/** Flaschen einer Jahrgangszeile im gewählten Lagerort. */
export function countIn(row: VintageRow, filter: LocationFilter) {
  let sealed = 0;
  let open = 0;
  for (const loc of row.locations) {
    if (!matchesLocation(loc, filter)) continue;
    sealed += loc.sealed;
    open += loc.open;
  }
  return { sealed, open };
}

// ---------------------------------------------------------------------------
// Ein Eintrag pro Wein

export type CellarVintage = VintageRow & { sealed: number; open: number };

/**
 * Zähleinheit fürs Gruppieren: so viele Flaschen mit diesem Jahrgang, dieser Preisklasse
 * (und ggf. diesem Trinkdatum). Ein Eintrag kann aus mehreren Einheiten bestehen.
 */
export type GroupUnit = {
  vintage_year: number | null;
  price_class: string | null;
  count: number;
  /** YYYY-MM-DD (Zürich), nur bei getrunkenen Flaschen. */
  drunk_on?: string | null;
};

/** Was Liste, Suche und Gruppierung von einem Eintrag brauchen. */
export type Groupable = {
  name: string;
  producer: string;
  country: string | null;
  region: string | null;
  type: WineType | null;
  grapes: string[];
  /** Jahrgänge des Eintrags, aufsteigend (ohne Jahrgang = null, zuletzt). */
  vintages: (number | null)[];
  units: GroupUnit[];
};

export type CellarWine = SummaryWine & Groupable & {
  sealed: number;
  open: number;
  rows: CellarVintage[];
};

export function buildCellarWines(
  wines: SummaryWine[],
  rows: VintageRow[],
  filter: LocationFilter,
): CellarWine[] {
  const byWine = new Map<string, CellarVintage[]>();
  for (const row of rows) {
    const counts = countIn(row, filter);
    if (counts.sealed + counts.open === 0) continue;
    const list = byWine.get(row.wine_id) ?? [];
    list.push({ ...row, ...counts });
    byWine.set(row.wine_id, list);
  }

  const result: CellarWine[] = [];
  for (const wine of wines) {
    const wineRows = byWine.get(wine.wine_id);
    if (!wineRows) continue;
    const sealed = wineRows.reduce((s, r) => s + r.sealed, 0);
    const open = wineRows.reduce((s, r) => s + r.open, 0);
    result.push({
      ...wine,
      sealed,
      open,
      vintages: sortVintages([...new Set(wineRows.filter((r) => r.sealed > 0).map((r) => r.vintage_year))]),
      units: wineRows
        .filter((r) => r.sealed > 0)
        .map((r) => ({ vintage_year: r.vintage_year, price_class: r.price_class, count: r.sealed })),
      rows: wineRows,
    });
  }
  return result.sort(compareWines);
}

export function sortVintages(years: (number | null)[]) {
  return years.sort((a, b) => (a == null ? 1 : b == null ? -1 : a - b));
}

function compareWines(a: SummaryWine, b: SummaryWine) {
  return a.producer.localeCompare(b.producer, "de-CH") || a.name.localeCompare(b.name, "de-CH");
}

export function formatVintages(vintages: (number | null)[]) {
  return vintages.map((v) => v ?? "o. J.").join(" · ");
}

// ---------------------------------------------------------------------------
// Suche

export function matchesQuery(wine: Groupable, query: string) {
  const haystack = [
    wine.name,
    wine.producer,
    wine.country,
    wine.region,
    ...wine.grapes,
    ...wine.vintages.map((v) => (v == null ? "" : String(v))),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("de-CH");
  return query
    .toLocaleLowerCase("de-CH")
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

// ---------------------------------------------------------------------------
// Gruppen

export type GroupItem<T extends Groupable = CellarWine> = { wine: T; bottles: number; vintages: (number | null)[] };

export type GroupSection<T extends Groupable = CellarWine> = {
  key: string;
  label: string;
  bottles: number;
  items: GroupItem<T>[];
};

export type WineGroup<T extends Groupable = CellarWine> = {
  key: string;
  label: string;
  /** Flaggen-Emoji (Land) bzw. Weintyp (für das Trauben-Symbol). */
  flag?: string;
  wineType?: WineType | null;
  bottles: number;
  items: GroupItem<T>[];
  /** Untergruppen (bei „Getrunken am“: Monate eines Jahres). */
  sections?: GroupSection<T>[];
};

const TYPE_ORDER: (WineType | "unknown")[] = [
  "red", "white", "rose", "sparkling", "sweet", "fortified", "orange", "unknown",
];

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function pushTo<G extends { bottles: number; items: GroupItem<T>[] }, T extends Groupable>(
  groups: Map<string, G>,
  key: string,
  init: () => Omit<G, "bottles" | "items">,
  item: GroupItem<T>,
) {
  if (item.bottles <= 0) return;
  let group = groups.get(key);
  if (!group) {
    group = { ...init(), bottles: 0, items: [] } as unknown as G;
    groups.set(key, group);
  }
  group.bottles += item.bottles;
  group.items.push(item);
}

/** Einheiten eines Eintrags nach Schlüssel zusammenfassen (Flaschen + Jahrgänge je Schlüssel). */
function splitBy<T extends Groupable>(wine: T, keyOf: (u: GroupUnit) => string) {
  const parts = new Map<string, GroupItem<T>>();
  for (const u of wine.units) {
    if (u.count <= 0) continue;
    const key = keyOf(u);
    const part = parts.get(key) ?? { wine, bottles: 0, vintages: [] };
    part.bottles += u.count;
    if (!part.vintages.includes(u.vintage_year)) part.vintages.push(u.vintage_year);
    parts.set(key, part);
  }
  for (const part of parts.values()) sortVintages(part.vintages);
  return parts;
}

/**
 * Gruppiert die Einträge. Bei Jahrgang, Preisklasse und „Getrunken am“ erscheint ein
 * Eintrag in jeder passenden Gruppe mit der Flaschenzahl dieser Gruppe; bei Rebsorte
 * in jeder seiner Rebsorten (Cuvées also mehrfach) mit allen Flaschen.
 */
export function groupWines<T extends Groupable>(wines: T[], by: GroupBy): WineGroup<T>[] {
  const groups = new Map<string, WineGroup<T>>();
  const whole = (wine: T): GroupItem<T> => ({
    wine,
    bottles: wine.units.reduce((s, u) => s + u.count, 0),
    vintages: wine.vintages,
  });
  const months = new Map<string, Map<string, GroupSection<T>>>();

  for (const wine of wines) {
    switch (by) {
      case "typ": {
        const key = wine.type ?? "unknown";
        pushTo(groups, key, () => ({
          key,
          label: wine.type ? WINE_TYPE_LABELS[wine.type] : "Unbekannt",
          wineType: wine.type,
        }), whole(wine));
        break;
      }
      case "land": {
        const key = wine.country ?? "";
        pushTo(groups, key, () => ({
          key,
          label: wine.country ?? "Land unbekannt",
          flag: countryFlag(wine.country) ?? undefined,
        }), whole(wine));
        break;
      }
      case "rebsorte": {
        const grapes = wine.grapes.length ? [...new Set(wine.grapes)] : [""];
        for (const grape of grapes) {
          pushTo(groups, grape, () => ({ key: grape, label: grape || "Rebsorte unbekannt" }), whole(wine));
        }
        break;
      }
      case "jahrgang": {
        for (const [key, item] of splitBy(wine, (u) => (u.vintage_year == null ? "" : String(u.vintage_year)))) {
          pushTo(groups, key, () => ({ key, label: key || "Ohne Jahrgang" }), item);
        }
        break;
      }
      case "preis": {
        for (const [key, item] of splitBy(wine, (u) => u.price_class ?? "")) {
          pushTo(groups, key, () => ({ key, label: key ? `${key} CHF` : "Ohne Preis" }), item);
        }
        break;
      }
      case "getrunken": {
        for (const [year, item] of splitBy(wine, (u) => u.drunk_on?.slice(0, 4) ?? "")) {
          pushTo(groups, year, () => ({ key: year, label: year || "Ohne Datum" }), item);
        }
        for (const [month, item] of splitBy(wine, (u) => u.drunk_on?.slice(0, 7) ?? "")) {
          if (!month) continue;
          const year = month.slice(0, 4);
          const sections = months.get(year) ?? new Map<string, GroupSection<T>>();
          months.set(year, sections);
          pushTo(sections, month, () => ({ key: month, label: MONTHS[Number(month.slice(5, 7)) - 1] ?? month }), item);
        }
        break;
      }
    }
  }

  const list = [...groups.values()];
  const lastIfEmpty = (a: { key: string }, b: { key: string }) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0);
  switch (by) {
    case "typ":
      list.sort((a, b) => TYPE_ORDER.indexOf(a.key as WineType) - TYPE_ORDER.indexOf(b.key as WineType));
      break;
    case "jahrgang":
      list.sort((a, b) => lastIfEmpty(a, b) || Number(a.key) - Number(b.key));
      break;
    case "preis":
      list.sort(
        (a, b) =>
          lastIfEmpty(a, b) ||
          PRICE_CLASSES.indexOf(a.key as (typeof PRICE_CLASSES)[number]) -
            PRICE_CLASSES.indexOf(b.key as (typeof PRICE_CLASSES)[number]),
      );
      break;
    case "getrunken":
      // Neueste zuerst, „Ohne Datum“ zuletzt; darin Monate absteigend.
      list.sort((a, b) => lastIfEmpty(a, b) || b.key.localeCompare(a.key));
      for (const group of list) {
        const sections = months.get(group.key);
        if (sections) group.sections = [...sections.values()].sort((a, b) => b.key.localeCompare(a.key));
      }
      break;
    default:
      list.sort((a, b) => lastIfEmpty(a, b) || b.bottles - a.bottles || a.label.localeCompare(b.label, "de-CH"));
  }
  return list;
}

// ---------------------------------------------------------------------------
// Kennzahlen

export function cellarTotals(wines: CellarWine[]) {
  const years = new Set<number | null>();
  let bottles = 0;
  let count = 0;
  for (const wine of wines) {
    if (wine.sealed === 0) continue;
    count += 1;
    bottles += wine.sealed;
    wine.vintages.forEach((v) => years.add(v));
  }
  return { bottles, wines: count, vintages: [...years].filter((v) => v != null).length };
}

export function drinkCounts(wines: CellarWine[]) {
  const counts: Record<DrinkStatus, number> = { overdue: 0, ready: 0, wait: 0, unknown: 0 };
  for (const wine of wines) for (const row of wine.rows) counts[row.drink_status] += row.sealed;
  return counts;
}

// ---------------------------------------------------------------------------
// Länderflaggen

const COUNTRY_CODES: Record<string, string> = {
  argentinien: "AR", australien: "AU", brasilien: "BR", bulgarien: "BG", chile: "CL", china: "CN",
  deutschland: "DE", england: "GB", frankreich: "FR", georgien: "GE", griechenland: "GR",
  grossbritannien: "GB", "großbritannien": "GB", israel: "IL", italien: "IT", japan: "JP", kanada: "CA",
  kroatien: "HR", libanon: "LB", luxemburg: "LU", marokko: "MA", mexiko: "MX", moldau: "MD",
  moldawien: "MD", neuseeland: "NZ", "österreich": "AT", portugal: "PT", "rumänien": "RO",
  schweiz: "CH", slowakei: "SK", slowenien: "SI", spanien: "ES", "südafrika": "ZA", tschechien: "CZ",
  "türkei": "TR", ungarn: "HU", uruguay: "UY", usa: "US", "vereinigte staaten": "US", zypern: "CY",
};

/** „🇪🇸 Rioja“ – Flagge plus Region (oder Land) für die Kartenzeile. */
export function originLabel(w: { country: string | null; region: string | null }) {
  return [countryFlag(w.country), w.region ?? w.country].filter(Boolean).join(" ") || null;
}

/** Flaggen-Emoji für einen (deutschen) Ländernamen, sonst null. */
export function countryFlag(country: string | null | undefined) {
  const code = country ? COUNTRY_CODES[country.trim().toLocaleLowerCase("de-CH")] : undefined;
  if (!code) return null;
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
