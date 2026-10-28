import type { Enums } from "@/lib/database.types";

/**
 * Weintypen der App. Der DB-Enum kennt noch „orange“ (bleibt aus technischen Gründen), ist
 * aber per Check-Constraint gesperrt – in der App gibt es ihn nicht.
 */
export const WINE_TYPES = ["red", "white", "rose", "sparkling", "sweet", "fortified"] as const;
export type WineType = (typeof WINE_TYPES)[number];

/** Typ aus der DB bzw. einer Eingabe → App-Typ; Unbekanntes (auch „orange“) → null. */
export function asWineType(value: unknown): WineType | null {
  return typeof value === "string" && (WINE_TYPES as readonly string[]).includes(value) ? (value as WineType) : null;
}
export type InventoryStatus = Enums<"inventory_status">;

export const WINE_TYPE_LABELS: Record<WineType, string> = {
  red: "Rot",
  white: "Weiss",
  rose: "Rosé",
  sparkling: "Schaumwein",
  sweet: "Süsswein",
  fortified: "Likörwein",
};

export const STATUS_LABELS: Record<InventoryStatus, string> = {
  sealed: "Ungeöffnet",
  open: "Offen",
  drunk: "Ausgetrunken",
};

export function wineTypeLabel(type: string | null | undefined) {
  const t = asWineType(type);
  return t ? WINE_TYPE_LABELS[t] : "Unbekannt";
}

export function formatBottleSize(ml: number | null | undefined) {
  if (!ml) return null;
  const liters = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 3 }).format(ml / 1000);
  return `${liters} l`;
}

export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  { whole = false }: { whole?: boolean } = {},
) {
  if (amount == null) return null;
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: currency ?? "CHF",
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole ? 0 : undefined,
  }).format(amount);
}

/** "24.50", "24,50", "CHF 24.-", "1'250" → Zahl; null bei ungültiger Eingabe. */
export function parsePrice(text: string) {
  const match = text.replace(/['’\s]/g, "").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value < 100_000 ? value : null;
}

/**
 * Differenz zwischen Normalpreis und bezahltem Preis. Positiv = Rabatt,
 * negativ = Aufpreis; null wenn ein Preis fehlt oder beide gleich sind.
 */
export function priceDiscount(paid: number | null | undefined, regular: number | null | undefined) {
  if (paid == null || regular == null || regular <= 0) return null;
  const amount = Math.round((regular - paid) * 100) / 100;
  if (amount === 0) return null;
  return { amount, percent: Math.round((amount / regular) * 1000) / 10 };
}

export function formatBottles(count: number) {
  return count === 1 ? "1 Flasche" : `${count} Flaschen`;
}

export function formatDate(date: string | null | undefined) {
  if (!date) return null;
  // Reine Datumswerte (YYYY-MM-DD) ohne Zeitzonenverschiebung darstellen.
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** Ganze Tage seit einem Datum (YYYY-MM-DD), bezogen auf heute in Europe/Zurich. */
export function daysSince(date: string | null | undefined) {
  if (!date) return null;
  const today = todayIso();
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function formatDaysSince(date: string | null | undefined) {
  const days = daysSince(date);
  if (days == null) return null;
  if (days <= 0) return "heute geöffnet";
  if (days === 1) return "seit gestern offen";
  return `seit ${days} Tagen offen`;
}

/** Zeitstempel (timestamptz) als YYYY-MM-DD in Europe/Zurich. */
export function zurichDate(timestamp: string | null | undefined) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(
    new Date(timestamp),
  );
}

/** Heutiges Datum als YYYY-MM-DD in Europe/Zurich. */
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
}

export function formatStorage(parts: {
  storage_house?: string | null;
  storage_room?: string | null;
  storage_compartment?: string | null;
  storage_location?: string | null;
}) {
  const joined = [
    parts.storage_house,
    parts.storage_room,
    parts.storage_compartment,
    parts.storage_location,
  ]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" · ");
  return joined || null;
}

/** 4.5 → „4½“, 4 → „4“ (halbe Sterne als Zahl). */
export function formatStarNumber(rating: number) {
  const whole = Math.floor(rating);
  const half = rating - whole >= 0.5;
  return half ? (whole ? `${whole}½` : "½") : String(whole);
}

export function formatRating(rating: number | null | undefined) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return `${"★".repeat(full)}${"☆".repeat(Math.max(0, 5 - full))}`;
}

/**
 * „Vega Sicilia – Pintia“ bzw. nur „Pintia“, wenn der Produzent fehlt (kein „–“, kein
 * „Unbekannt“). sep: Trenner zwischen Produzent und Name.
 */
export function wineName(w: { producer?: string | null; name: string }, sep = " – ") {
  return w.producer ? `${w.producer}${sep}${w.name}` : w.name;
}

/** Sortierung nach Produzent, dann Name; Weine ohne Produzent nach ihrem Namen einsortiert. */
export function compareWineNames(a: { producer?: string | null; name: string }, b: { producer?: string | null; name: string }) {
  return (a.producer ?? a.name).localeCompare(b.producer ?? b.name, "de-CH") || a.name.localeCompare(b.name, "de-CH");
}

export function wineTitle(row: { vintage_year?: number | null; name?: string | null }) {
  return [row.name, row.vintage_year ?? "o. J."].filter(Boolean).join(" ");
}
