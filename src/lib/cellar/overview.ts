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

export type GroupBy = "typ" | "land" | "rebsorte" | "jahrgang" | "preis";

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  typ: "Weintyp",
  land: "Land",
  rebsorte: "Rebsorte",
  jahrgang: "Jahrgang",
  preis: "Preisklasse",
};

export function isGroupBy(value: unknown): value is GroupBy {
  return typeof value === "string" && value in GROUP_BY_LABELS;
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

export type CellarWine = SummaryWine & {
  sealed: number;
  open: number;
  /** Jahrgänge mit ungeöffneten Flaschen im Filter, aufsteigend (ohne Jahrgang = null, zuletzt). */
  vintages: (number | null)[];
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
      rows: wineRows,
    });
  }
  return result.sort(compareWines);
}

function sortVintages(years: (number | null)[]) {
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

export function matchesQuery(wine: CellarWine, query: string) {
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

export type GroupItem = { wine: CellarWine; bottles: number; vintages: (number | null)[] };

export type WineGroup = {
  key: string;
  label: string;
  /** Flaggen-Emoji (Land) bzw. Weintyp (für das Trauben-Symbol). */
  flag?: string;
  wineType?: WineType | null;
  bottles: number;
  items: GroupItem[];
};

const TYPE_ORDER: (WineType | "unknown")[] = [
  "red", "white", "rose", "sparkling", "sweet", "fortified", "orange", "unknown",
];

function pushTo(
  groups: Map<string, WineGroup>,
  key: string,
  init: () => Omit<WineGroup, "bottles" | "items">,
  item: GroupItem,
) {
  if (item.bottles <= 0) return;
  let group = groups.get(key);
  if (!group) {
    group = { ...init(), bottles: 0, items: [] };
    groups.set(key, group);
  }
  group.bottles += item.bottles;
  group.items.push(item);
}

/**
 * Gruppiert die Weine. Bei Jahrgang und Preisklasse erscheint ein Wein in jeder
 * passenden Gruppe mit der Flaschenzahl dieser Gruppe; bei Rebsorte in jeder
 * seiner Rebsorten (Cuvées also mehrfach) mit allen Flaschen.
 */
export function groupWines(wines: CellarWine[], by: GroupBy): WineGroup[] {
  const groups = new Map<string, WineGroup>();
  const whole = (wine: CellarWine): GroupItem => ({ wine, bottles: wine.sealed, vintages: wine.vintages });

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
        const byYear = new Map<number | null, number>();
        for (const r of wine.rows) byYear.set(r.vintage_year, (byYear.get(r.vintage_year) ?? 0) + r.sealed);
        for (const [year, bottles] of byYear) {
          const key = year == null ? "" : String(year);
          pushTo(groups, key, () => ({ key, label: year == null ? "Ohne Jahrgang" : String(year) }), {
            wine,
            bottles,
            vintages: [year],
          });
        }
        break;
      }
      case "preis": {
        const byClass = new Map<string, { bottles: number; vintages: Set<number | null> }>();
        for (const r of wine.rows) {
          if (r.sealed === 0) continue;
          const key = r.price_class ?? "";
          const entry = byClass.get(key) ?? { bottles: 0, vintages: new Set() };
          entry.bottles += r.sealed;
          entry.vintages.add(r.vintage_year);
          byClass.set(key, entry);
        }
        for (const [key, entry] of byClass) {
          pushTo(groups, key, () => ({ key, label: key ? `${key} CHF` : "Ohne Preis" }), {
            wine,
            bottles: entry.bottles,
            vintages: sortVintages([...entry.vintages]),
          });
        }
        break;
      }
    }
  }

  const list = [...groups.values()];
  const lastIfEmpty = (a: WineGroup, b: WineGroup) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0);
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

/** Flaggen-Emoji für einen (deutschen) Ländernamen, sonst null. */
export function countryFlag(country: string | null | undefined) {
  const code = country ? COUNTRY_CODES[country.trim().toLocaleLowerCase("de-CH")] : undefined;
  if (!code) return null;
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
