// Weinseite (/wein/[id]): Jahrgangs-Auswahl, Chargen und Raster – reine Funktionen.

import type { InventoryStatus } from "@/lib/format";

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

export type VintageOption = {
  year: number | null;
  sealed: number;
  open: number;
  drunk: number;
  /** Nur verkostet (keine Flaschen dieses Jahrgangs). */
  tastedOnly?: boolean;
};

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

/** Jahrgänge, die nur verkostet wurden, kommen als eigene Auswahl dazu (ohne Flaschen). */
export function withTastedYears(options: VintageOption[], tastedYears: (number | null)[]): VintageOption[] {
  const extra = [...new Set(tastedYears)]
    .filter((y) => !options.some((o) => o.year === y))
    .map((year) => ({ year, sealed: 0, open: 0, drunk: 0, tastedOnly: true }));
  return [...options, ...extra].sort((a, b) => (a.year == null ? 1 : b.year == null ? -1 : a.year - b.year));
}

/**
 * Gewählter Jahrgang: der angefragte, falls vorhanden; sonst der älteste mit Flaschen im
 * Bestand (offen oder ungeöffnet), sonst der zuletzt getrunkene.
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
