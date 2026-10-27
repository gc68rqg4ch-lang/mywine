import type { Enums } from "@/lib/database.types";

export type WineType = Enums<"wine_type">;
export type InventoryStatus = Enums<"inventory_status">;

export const WINE_TYPE_LABELS: Record<WineType, string> = {
  red: "Rot",
  white: "Weiss",
  rose: "Rosé",
  sparkling: "Schaumwein",
  sweet: "Süsswein",
  fortified: "Likörwein",
  orange: "Orange",
};

export const STATUS_LABELS: Record<InventoryStatus, string> = {
  sealed: "Ungeöffnet",
  open: "Offen",
  drunk: "Ausgetrunken",
};

export function wineTypeLabel(type: WineType | null | undefined) {
  return type ? WINE_TYPE_LABELS[type] : "Unbekannt";
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

export function formatRating(rating: number | null | undefined) {
  if (rating == null) return null;
  const full = Math.round(rating);
  return `${"★".repeat(full)}${"☆".repeat(Math.max(0, 5 - full))}`;
}

export function wineTitle(row: { vintage_year?: number | null; name?: string | null }) {
  return [row.name, row.vintage_year ?? "o. J."].filter(Boolean).join(" ");
}
