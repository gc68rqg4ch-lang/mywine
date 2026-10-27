// Alle Bearbeitungen als Daten – gemeinsam für App (Formulare) und Bot (Chat-Vorschläge).
// Rein und JSON-tauglich: der Bot legt eine Bearbeitung bis zum [Ja] in ingest_jobs ab.
// Geprüft und ausgeführt wird in ./edit.ts (prepareEdit / applyEdit).

import type { WineType } from "@/lib/format";
import type { GrapeShare } from "@/lib/grapes/shares";

/** Lagerorte im Haus (storage_room); storage_house ist immer „Zuhause“. */
export const ROOMS = ["Weinkeller", "Wohnzimmer"] as const;
export type Room = (typeof ROOMS)[number];

export const WINE_FIELDS = ["name", "producer", "type", "country", "region", "appellation", "alcohol"] as const;
export type WineField = (typeof WINE_FIELDS)[number];
export type WineChanges = {
  name?: string;
  producer?: string;
  type?: WineType | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
  alcohol?: number | null;
};

export const BATCH_FIELDS = [
  "quantity",
  "bottleSizeMl",
  "purchasedAt",
  "vendor",
  "isGift",
  "purchasePrice",
  "regularPrice",
] as const;
export type BatchField = (typeof BATCH_FIELDS)[number];
export type BatchChanges = {
  quantity?: number;
  bottleSizeMl?: number;
  /** YYYY-MM-DD; null = unbekannt */
  purchasedAt?: string | null;
  /** Händlername (bestehender oder neuer); null = kein Händler */
  vendor?: string | null;
  isGift?: boolean;
  purchasePrice?: number | null;
  regularPrice?: number | null;
};

export type Edit =
  /** Stammdaten des Weins (alle Jahrgänge). */
  | { kind: "wine"; wineId: string; set: WineChanges }
  /** Ganzen Jahrgang umbenennen (change_vintage), ggf. zusammenführen. null = ohne Jahrgang. */
  | { kind: "vintage"; wineId: string; from: number | null; to: number | null }
  /** Trinkfenster eines Jahrgangs. */
  | { kind: "drinkWindow"; wineId: string; year: number | null; from: number | null; until: number | null }
  /** Angaben einer Charge (ungeöffnet, offen oder getrunken – Anzahl nur ungeöffnet). */
  | { kind: "batch"; itemId: string; set: BatchChanges }
  /** Charge an einen anderen Lagerort; mit count nur so viele Flaschen (Rest bleibt). */
  | { kind: "move"; itemId: string; room: Room; count?: number }
  /** Jahrgang nur dieser Charge (change_vintage mit p_item_id). */
  | { kind: "batchVintage"; itemId: string; to: number | null }
  | { kind: "deleteBatch"; itemId: string }
  /** Offene Flasche: Füllstand und/oder „Geöffnet am“. */
  | { kind: "openBottle"; itemId: string; fill?: number; openedOn?: string }
  /** Getrunkene Flasche: „Getrunken am“. */
  | { kind: "drunkBottle"; itemId: string; drunkOn: string }
  /** Getrunkene Flasche wieder auf offen (mit Füllstand). */
  | { kind: "reopen"; itemId: string; fill: number }
  /** Rebsorten mit % für einen Jahrgang (manuell). */
  | { kind: "grapes"; wineId: string; year: number | null; shares: GrapeShare[] }
  /** Bewertung setzen (rating) oder löschen (null, inkl. Verlauf). */
  | { kind: "rating"; wineId: string; year: number | null; personId: string; rating: number | null; itemId?: string | null }
  /** Verkostung: Datum, Person, Notizen. */
  | { kind: "tasting"; tastingId: string; set: { tastedOn?: string; personId?: string | null; notes?: string | null } }
  | { kind: "deleteTasting"; tastingId: string };

export type EditKind = Edit["kind"];

/** Eine Zeile „Feld: vorher → nachher“. */
export type EditChange = { label: string; before: string; after: string };

export type EditPreview = {
  /** Worum es geht, z. B. „Vega Sicilia – Pintia 2019 · Weinkeller“ */
  title: string;
  /** Kurz, was passiert, z. B. „Charge bearbeiten“ */
  action: string;
  changes: EditChange[];
  /** Hinweise (Zusammenführen, Teil-Verschiebung …) */
  notes: string[];
};

export type EditResult = { ok: true; message: string; wineId: string | null; year?: number | null } | { ok: false; error: string };

/** Vorschau als Text: Titel, je Änderung „Feld: vorher → nachher“, Hinweise. */
export function previewLines(p: EditPreview) {
  return [
    `${p.action}: ${p.title}`,
    ...p.changes.map((c) => `• ${c.label}: ${c.before} → ${c.after}`),
    ...p.notes.map((n) => `ℹ️ ${n}`),
  ];
}

export const yearText = (year: number | null) => (year == null ? "ohne Jahrgang (NV)" : String(year));
