// Startseite (rein, ohne DB): Zahlen für die Kacheln und die Daten für Antoines Text – aus den
// Zeilen der bestehenden Views/Tabellen. Zeitgrenzen in Europe/Zurich.

import { drinkStatus, type DrinkStatus } from "@/lib/cellar/overview";
import type { WineType } from "@/lib/format";
import { sameZurichMonth, sameZurichYear, zurichDay, zurichParts } from "./dates";

/** Flasche bzw. Charge im Bestand (ungeöffnet oder offen) – aus cellar_overview. */
export type StockItem = {
  itemId: string;
  wineId: string;
  name: string;
  producer: string | null;
  type: WineType | null;
  year: number | null;
  status: "sealed" | "open";
  quantity: number;
  paid: number | null;
  regular: number | null;
  dateOpened: string | null;
  purchasedAt: string | null;
  drinkFrom: number | null;
  drinkUntil: number | null;
  /** Lagerort (für den gewählten Lagerort in den Kacheln). */
  house?: string | null;
  room?: string | null;
};

/** Getrunkene Flaschen (Status drunk). */
export type DrunkItem = { wineId: string; name: string; type: WineType | null; year: number | null; quantity: number; drunkAt: string | null };

/** Kauf (inventory_events „purchased“). */
export type Purchase = { at: string; wineId: string | null; name: string | null; year: number | null; quantity: number; price: number | null; gift: boolean };

export type PersonRating = { wineId: string; year: number | null; name: string; rating: number; styleSummary: string | null };

export type HomeInput = {
  stock: StockItem[];
  drunk: DrunkItem[];
  purchases: Purchase[];
  tastedThisMonth: number;
  ratings: PersonRating[];
  pendingSuggestions: number;
};

const TYPE_ORDER: WineType[] = ["red", "white", "rose", "sparkling", "sweet", "fortified"];

export function stockTotals(stock: StockItem[]) {
  const sealed = stock.filter((s) => s.status === "sealed" && s.quantity > 0);
  return {
    bottles: sealed.reduce((n, s) => n + s.quantity, 0),
    wines: new Set(sealed.map((s) => s.wineId)).size,
    open: stock.filter((s) => s.status === "open").length,
    paid: sealed.reduce((n, s) => n + (s.paid ?? 0), 0),
    regular: sealed.reduce((n, s) => n + (s.regular ?? 0), 0),
  };
}

/** Ausgaben: Summe bezahlt der Käufe im Jahr (ohne Geschenke); Geschenke separat als Anzahl Flaschen. */
export function spending(purchases: Purchase[], year: number) {
  const of = (y: number) => {
    const rows = purchases.filter((p) => sameZurichYear(p.at, y));
    const bought = rows.filter((p) => !p.gift);
    return {
      chf: bought.reduce((n, p) => n + p.quantity * (p.price ?? 0), 0),
      bottles: bought.reduce((n, p) => n + p.quantity, 0),
      gifts: rows.filter((p) => p.gift).reduce((n, p) => n + p.quantity, 0),
    };
  };
  return { thisYear: of(year), lastYear: of(year - 1) };
}

/** Zuletzt eingebucht: die letzten Käufe (neuste zuerst). */
export const recentPurchases = (purchases: Purchase[], n = 5) =>
  [...purchases].filter((p) => p.wineId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);

export type TypeCount = { type: WineType | "unknown"; bottles: number };

/** Getrunken diesen Monat bzw. dieses Jahr (Zürich), nach Weintyp. */
export function drunkByType(drunk: DrunkItem[], now: Date | number) {
  const year = zurichParts(now).year;
  const count = (rows: DrunkItem[]): { total: number; byType: TypeCount[] } => {
    const map = new Map<WineType | "unknown", number>();
    for (const r of rows) map.set(r.type ?? "unknown", (map.get(r.type ?? "unknown") ?? 0) + r.quantity);
    const order = [...TYPE_ORDER, "unknown" as const];
    return {
      total: rows.reduce((n, r) => n + r.quantity, 0),
      byType: order.filter((t) => map.get(t)).map((t) => ({ type: t, bottles: map.get(t)! })),
    };
  };
  return {
    month: count(drunk.filter((d) => sameZurichMonth(d.drunkAt, now))),
    year: count(drunk.filter((d) => sameZurichYear(d.drunkAt, year))),
  };
}

/** Wein + Jahrgang im Bestand (für Kacheln, Text und Vorschläge). */
export type StockUnit = {
  wineId: string;
  year: number | null;
  name: string;
  producer: string | null;
  type: WineType | null;
  sealed: number;
  open: number;
  status: DrinkStatus;
  drinkUntil: number | null;
  lastPurchase: string | null;
  oldestOpened: string | null;
};

export const unitKey = (wineId: string, year: number | null) => `${wineId}|${year ?? "nv"}`;

export function stockUnits(stock: StockItem[], year: number): StockUnit[] {
  const units = new Map<string, StockUnit>();
  for (const s of stock) {
    const key = unitKey(s.wineId, s.year);
    const u =
      units.get(key) ??
      { wineId: s.wineId, year: s.year, name: s.name, producer: s.producer, type: s.type, sealed: 0, open: 0, status: drinkStatus(s.drinkFrom, s.drinkUntil, year), drinkUntil: s.drinkUntil, lastPurchase: null, oldestOpened: null };
    if (s.status === "sealed") u.sealed += s.quantity;
    else u.open += 1;
    const bought = zurichDay(s.purchasedAt);
    if (bought && (!u.lastPurchase || bought > u.lastPurchase)) u.lastPurchase = bought;
    const opened = zurichDay(s.dateOpened);
    if (s.status === "open" && opened && (!u.oldestOpened || opened < u.oldestOpened)) u.oldestOpened = opened;
    units.set(key, u);
  }
  return [...units.values()].filter((u) => u.sealed > 0 || u.open > 0);
}

/** Trinkreife: über dem Höhepunkt bzw. jetzt trinken (ungeöffnete Flaschen). */
export function readiness(units: StockUnit[]) {
  const sealed = units.filter((u) => u.sealed > 0);
  const pick = (s: DrinkStatus) => sealed.filter((u) => u.status === s).sort((a, b) => (a.drinkUntil ?? 0) - (b.drinkUntil ?? 0));
  const bottles = (list: StockUnit[]) => list.reduce((n, u) => n + u.sealed, 0);
  const overdue = pick("overdue");
  const now = pick("now");
  return { overdue, now, overdueBottles: bottles(overdue), nowBottles: bottles(now) };
}

/** Offene Flaschen, älteste zuerst (Tage offen). */
export function openBottles(stock: StockItem[], today: string) {
  return stock
    .filter((s) => s.status === "open")
    .map((s) => ({ ...s, days: s.dateOpened ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${zurichDay(s.dateOpened)}T12:00:00Z`)) / 86_400_000)) : null }))
    .sort((a, b) => (a.dateOpened ?? "9999").localeCompare(b.dateOpened ?? "9999"));
}

export function ratingSummary(ratings: PersonRating[]) {
  if (!ratings.length) return null;
  const avg = ratings.reduce((n, r) => n + r.rating, 0) / ratings.length;
  const best = [...ratings].sort((a, b) => b.rating - a.rating)[0];
  return { count: ratings.length, avg, best };
}
