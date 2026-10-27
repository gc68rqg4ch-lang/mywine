// Weinseite (/wein/[id]): Jahrgangs-Auswahl, Chargen und Raster – reine Funktionen.

import type { InventoryStatus } from "@/lib/format";
import type { DrinkStatus } from "./overview";

/** Link auf die Weinseite; mit Jahrgang (null = ohne Jahrgang) ist dieser vorausgewählt. */
export function wineHref(wineId: string, year?: number | null, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (year !== undefined) params.set("jahrgang", year == null ? "ohne" : String(year));
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const query = params.toString();
  return `/wein/${wineId}${query ? `?${query}` : ""}`;
}

/** ?jahrgang=2019 → 2019, „ohne“ → null, sonst undefined (nicht angegeben/ungültig). */
export function parseVintageParam(value: unknown): number | null | undefined {
  if (value === "ohne") return null;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return undefined;
  return Number(value);
}

export type PageItem = {
  inventory_item_id: string;
  vintage_year: number | null;
  status: InventoryStatus;
  quantity: number;
  drunk_at: string | null;
};

export type VintageOption = { year: number | null; sealed: number; open: number; drunk: number };

/** Alle Jahrgänge des Weins (auch nur getrunkene), aufsteigend, ohne Jahrgang zuletzt. */
export function vintageOptions(items: PageItem[]): VintageOption[] {
  const map = new Map<number | null, VintageOption>();
  for (const i of items) {
    const o = map.get(i.vintage_year) ?? { year: i.vintage_year, sealed: 0, open: 0, drunk: 0 };
    o[i.status === "sealed" ? "sealed" : i.status] += i.quantity;
    map.set(i.vintage_year, o);
  }
  return [...map.values()].sort((a, b) => (a.year == null ? 1 : b.year == null ? -1 : a.year - b.year));
}

/**
 * Gewählter Jahrgang: der angefragte, falls vorhanden; sonst der älteste mit Flaschen im
 * Keller (offen oder ungeöffnet), sonst der zuletzt getrunkene.
 */
export function pickVintage(options: VintageOption[], requested: number | null | undefined, items: PageItem[]) {
  if (requested !== undefined && options.some((o) => o.year === requested)) return requested;
  const inCellar = options.find((o) => o.sealed + o.open > 0);
  if (inCellar) return inCellar.year;
  const lastDrunk = [...items].sort((a, b) => (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""))[0];
  return lastDrunk?.vintage_year ?? options[0]?.year ?? null;
}

/**
 * Flasche, an der jahrgangsbezogene Aktionen hängen (Bewertung, Rebsorten, Verkostung):
 * offen vor ungeöffnet vor zuletzt getrunken.
 */
export function anchorItem<T extends PageItem>(items: T[]): T | null {
  const rank: Record<InventoryStatus, number> = { open: 0, sealed: 1, drunk: 2 };
  return (
    [...items].sort(
      (a, b) => rank[a.status] - rank[b.status] || (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""),
    )[0] ?? null
  );
}

/** Trinkreife wie in der DB-View: überfällig, trinkreif, warten oder unbekannt. */
export function drinkStatus(from: number | null, until: number | null, year: number): DrinkStatus {
  if (from == null && until == null) return "unknown";
  if (until != null && until < year) return "overdue";
  if (from != null && from > year) return "wait";
  return "ready";
}

export function drinkWindowLabel(from: number | null, until: number | null) {
  if (from && until) return `${from}–${until}`;
  if (from) return `ab ${from}`;
  if (until) return `bis ${until}`;
  return null;
}

// ---------------------------------------------------------------------------
// Raster: schmale Kacheln 1 Spalte, breite 2 (bzw. ganze Zeile). Ohne leere Plätze:
// bleibt am Ende etwas frei, wird die letzte schmale (bzw. eine breite) Kachel breiter.

export type TileSize = "narrow" | "wide";

/**
 * CSS-Klassen je Kachel für 2 und 3 Spalten. Die Kacheln stehen in der Reihenfolge breit,
 * schmal, breit, schmal … (so füllt grid-auto-flow: dense jede Zeile).
 */
export function tileSpans(sizes: TileSize[]) {
  const spans3 = sizes.map((s): number => (s === "wide" ? 2 : 1));
  const spans2 = sizes.map((s): number => (s === "wide" ? 2 : 1));
  const narrow = sizes.flatMap((s, i) => (s === "narrow" ? [i] : []));
  const wide = sizes.flatMap((s, i) => (s === "wide" ? [i] : []));

  // 3 Spalten: jede breite Kachel teilt sich die Zeile mit einer schmalen.
  const paired = Math.min(narrow.length, wide.length);
  for (const i of wide.slice(paired)) spans3[i] = 3;
  const rest = narrow.length - paired;
  if (rest % 3 !== 0) spans3[narrow[narrow.length - 1]] = rest % 3 === 1 ? 3 : 2;

  // 2 Spalten: breite Kacheln füllen die Zeile, schmale paarweise.
  if (narrow.length % 2 === 1) spans2[narrow[narrow.length - 1]] = 2;

  return sizes.map((_, i) => `tile-c2-${spans2[i]} tile-c3-${spans3[i]}`);
}

/** Reihenfolge breit, schmal, breit, schmal …; übrige hinten (Reihenfolge innerhalb bleibt). */
export function arrangeTiles<T extends { size: TileSize }>(tiles: T[]) {
  const wide = tiles.filter((t) => t.size === "wide");
  const narrow = tiles.filter((t) => t.size === "narrow");
  const out: T[] = [];
  for (let i = 0; i < Math.max(wide.length, narrow.length); i++) {
    if (wide[i]) out.push(wide[i]);
    if (narrow[i]) out.push(narrow[i]);
  }
  const spans = tileSpans(out.map((t) => t.size));
  return out.map((tile, i) => ({ tile, className: spans[i] }));
}
