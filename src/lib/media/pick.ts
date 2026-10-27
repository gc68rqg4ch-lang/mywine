// Auswahl der Etikettfotos (wine_media) für Listen und Weinseite – rein, ohne DB.

import type { Database } from "@/lib/database.types";

export type MediaKind = Database["public"]["Enums"]["media_kind"];

export type MediaRow = {
  id: string;
  wine_id: string;
  inventory_item_id: string | null;
  kind: MediaKind;
  vintage_year: number | null;
  storage_path: string;
  thumb_path: string | null;
  sort_order: number;
  created_at: string;
};

const newestFirst = (a: MediaRow, b: MediaRow) =>
  b.created_at.localeCompare(a.created_at) || a.sort_order - b.sort_order;

/** Jahrgang absteigend, „ohne Jahrgang“ zuletzt. */
const byVintageDesc = (a: MediaRow, b: MediaRow) => (b.vintage_year ?? -1) - (a.vintage_year ?? -1);

/**
 * Vorder- und Rückseite für einen Wein: bevorzugt der gewünschte Jahrgang, sonst der
 * neueste mit Vorderseite; darin jeweils das zuletzt hochgeladene Foto. Die Rückseite
 * muss zum selben Jahrgang gehören (bevorzugt zur selben Flasche/Charge).
 * Ohne Vorderseite: null (die Liste zeigt dann das Trauben-Symbol).
 */
export function pickLabels(rows: MediaRow[], year: number | null | undefined) {
  const fronts = rows.filter((r) => r.kind === "label_front");
  if (fronts.length === 0) return null;
  const wanted = year === undefined ? [] : fronts.filter((r) => r.vintage_year === year);
  const front = (wanted.length ? wanted : fronts).sort((a, b) => byVintageDesc(a, b) || newestFirst(a, b))[0];
  const backs = rows
    .filter((r) => r.kind === "label_back" && r.vintage_year === front.vintage_year)
    .sort(
      (a, b) =>
        Number(b.inventory_item_id === front.inventory_item_id) - Number(a.inventory_item_id === front.inventory_item_id) ||
        newestFirst(a, b),
    );
  return { front, back: backs[0] ?? null };
}

const KIND_ORDER: Record<MediaKind, number> = { label_front: 0, label_back: 1, photo: 2, document: 3 };

/** Alle Fotos eines Jahrgangs für die Weinseite: Vorderseite, Rückseite, Weitere; jeweils neueste zuerst. */
export function vintagePhotos(rows: MediaRow[], year: number | null) {
  return rows
    .filter((r) => r.vintage_year === year && r.kind !== "document")
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || newestFirst(a, b));
}

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  label_front: "Vorderseite",
  label_back: "Rückseite",
  photo: "Foto",
  document: "Dokument",
};

/**
 * Art je Foto einer Erfassung: aus der Erkennung (pro Foto front/back/other), sonst
 * nach Reihenfolge – erstes Foto Vorderseite, zweites Rückseite, weitere „Foto“.
 * Höchstens je eine Vorder- und Rückseite.
 */
export function labelKinds(count: number, sides?: readonly string[] | null): MediaKind[] {
  const fromSides = sides?.length === count ? sides : null;
  const kinds: MediaKind[] = [];
  for (let i = 0; i < count; i++) {
    const side = fromSides ? fromSides[i] : i === 0 ? "front" : i === 1 ? "back" : "other";
    const kind: MediaKind = side === "front" ? "label_front" : side === "back" ? "label_back" : "photo";
    kinds.push(kind !== "photo" && kinds.includes(kind) ? "photo" : kind);
  }
  // Keine Vorderseite erkannt: das erste Foto, das keine Rückseite ist, gilt als Vorderseite.
  if (count > 0 && !kinds.includes("label_front")) {
    const i = kinds.findIndex((k) => k !== "label_back");
    if (i >= 0) kinds[i] = "label_front";
  }
  return kinds;
}

/** Pfad des Vorschaubilds neben dem Original: „…/123.jpg“ → „…/123.thumb.webp“. */
export function thumbPathFor(path: string) {
  return `${path.replace(/\.[^./]+$/, "")}.thumb.webp`;
}

/** Neuester Jahrgang einer Karte (für das Etikett); nur „ohne Jahrgang“ → null. */
export function newestVintage(vintages: readonly (number | null)[]) {
  const years = vintages.filter((v): v is number => v != null);
  return years.length ? Math.max(...years) : vintages.length ? null : undefined;
}
