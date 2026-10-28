// Alle Bearbeitungen als Daten – gemeinsam für App (Formulare) und Bot (Chat-Vorschläge).
// Rein und JSON-tauglich: der Bot legt eine Bearbeitung bis zum [Ja] in ingest_jobs ab.
// Geprüft und ausgeführt wird in ./edit.ts (prepareEdit / applyEdit).

import type { WineType } from "@/lib/format";
import type { GrapeShare } from "@/lib/grapes/shares";
import type { TasteProfileData } from "@/lib/taste/profile";

/** Lagerorte im Haus (storage_room); storage_house ist immer „Zuhause“. */
export const ROOMS = ["Weinkeller", "Wohnzimmer"] as const;
export type Room = (typeof ROOMS)[number];

export const WINE_FIELDS = ["name", "producer", "type", "country", "region", "appellation", "alcohol"] as const;
export type WineField = (typeof WINE_FIELDS)[number];
export type WineChanges = {
  name?: string;
  /** null = ohne Produzent */
  producer?: string | null;
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
  "giftFrom",
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
  /** Von wem geschenkt (nur mit Geschenk; leer → null). */
  giftFrom?: string | null;
  purchasePrice?: number | null;
  regularPrice?: number | null;
};

// ---------------------------------------------------------------------------
// Verkostet (wine_encounters): ein Wein irgendwo probiert – unabhängig vom Bestand.

export const PLACE_KINDS = ["restaurant", "weingut", "bar", "privat", "messe", "sonstiges"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PLACE_KIND_LABELS: Record<PlaceKind, string> = {
  restaurant: "Restaurant",
  weingut: "Weingut",
  bar: "Bar",
  privat: "Privat",
  messe: "Messe",
  sonstiges: "Sonstiges",
};

export const CURRENCIES = ["CHF", "AED", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PRICE_UNITS = ["bottle", "glass"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];
export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = { bottle: "Flasche", glass: "Glas" };

/** Ort: bestehender (placeId) oder neu (Name, Art, Stadt); null = ohne Ort. */
export type PlaceRef = { placeId: string } | { name: string; kind: PlaceKind | null; city: string | null } | null;

/** Angaben eines Eintrags „Verkostet“. */
export type EncounterChanges = {
  year?: number | null;
  /** YYYY-MM-DD */
  tastedOn?: string;
  place?: PlaceRef;
  price?: number | null;
  priceUnit?: PriceUnit | null;
  currency?: Currency;
  occasion?: string | null;
  companions?: string | null;
  note?: string | null;
};

/** Neuer Wein beim Erfassen (gibt es Name + Produzent schon, wird der bestehende genommen). */
export type NewWine = {
  name: string;
  producer?: string | null;
  type?: WineType | null;
  country?: string | null;
  region?: string | null;
  /** Trotz gleichnamiger Weine neu anlegen (nach der Auswahl „Neuen Wein anlegen“). */
  forceNew?: boolean;
};

export type Edit =
  /** Stammdaten des Weins (alle Jahrgänge). */
  | { kind: "wine"; wineId: string; set: WineChanges }
  /** Freie Notizen zum Wein (wines.notes, mehrzeilig); leer → NULL. */
  | { kind: "wineNotes"; wineId: string; notes: string | null }
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
  /** Flaschen löschen (falsch erfasst, nicht getrunken); ohne count die ganze Charge bzw. Position. */
  | { kind: "deleteBottles"; itemId: string; count?: number }
  /** Ganzen Wein unwiderruflich löschen (App: mit eingetipptem Namen zur Bestätigung). */
  | { kind: "deleteWine"; wineId: string; confirmName?: string }
  /** Offene Flasche: Füllstand und/oder „Geöffnet am“. */
  | { kind: "openBottle"; itemId: string; fill?: number; openedOn?: string }
  /** Getrunkene Flasche: „Getrunken am“. */
  | { kind: "drunkBottle"; itemId: string; drunkOn: string }
  /** Getrunkene Flasche wieder auf offen (mit Füllstand). */
  | { kind: "reopen"; itemId: string; fill: number }
  /** Rebsorten mit % für einen Jahrgang (manuell). */
  | { kind: "grapes"; wineId: string; year: number | null; shares: GrapeShare[]; source?: "manual" | "research" }
  /** Bewertung setzen (rating) oder löschen (null, inkl. Verlauf). */
  | { kind: "rating"; wineId: string; year: number | null; personId: string; rating: number | null; itemId?: string | null }
  /** Verkostung: Datum, Person, Notizen. */
  | { kind: "tasting"; tastingId: string; set: { tastedOn?: string; personId?: string | null; notes?: string | null } }
  | { kind: "deleteTasting"; tastingId: string }
  /**
   * Verkostet erfassen: Wein (bestehend oder neu), Jahrgang Pflicht (null = NV), Datum, Ort,
   * Preis …; optional Merker „Kaufen?“ und Bewertungen (mit encounter_id).
   */
  | {
      kind: "addEncounter";
      wine: { wineId: string } | { new: NewWine };
      year: number | null;
      set: Omit<EncounterChanges, "year">;
      /** Wer erfasst (angemeldete Person bzw. wer im Bot schreibt). */
      personId: string | null;
      source: "app" | "bot";
      wantToBuy?: boolean;
      ratings?: { personId: string; rating: number }[];
    }
  /** Eintrag „Verkostet“ ändern; Bewertungen dieses Eintrags setzen (null = löschen). */
  | { kind: "encounter"; encounterId: string; set: EncounterChanges; ratings?: { personId: string; rating: number | null }[] }
  /** Eintrag löschen – samt seinen Bewertungen; WSET-Verkostungen bleiben (ohne Eintrag). */
  | { kind: "deleteEncounter"; encounterId: string }
  /** Merker „Kaufen?“ */
  | { kind: "wantToBuy"; wineId: string; value: boolean }
  /** Geschmacksprofil (Jahrgang in profile.vintageYear); von Hand → source manual. */
  | { kind: "tasteProfile"; wineId: string; profile: TasteProfileData; source: "manual" | "research" };

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

/** Verweis zu einer Meldung, z. B. „Diesen Wein gibt es schon“ → zum bestehenden Wein. */
export type EditLink = { href: string; label: string };

export type EditResult =
  | { ok: true; message: string; wineId: string | null; year?: number | null }
  | { ok: false; error: string; link?: EditLink };

/** Vorschau als Text: Titel, je Änderung „Feld: vorher → nachher“, Hinweise. */
export function previewLines(p: EditPreview) {
  return [
    `${p.action}: ${p.title}`,
    ...p.changes.map((c) => `• ${c.label}: ${c.before} → ${c.after}`),
    ...p.notes.map((n) => `ℹ️ ${n}`),
  ];
}

export const yearText = (year: number | null) => (year == null ? "ohne Jahrgang (NV)" : String(year));
