// Weinseite: Bearbeiten direkt in der Karte (rein, ohne DB/React – auch für Tests).
// Immer nur eine Einheit offen; hat sie ungespeicherte Änderungen, wird vor dem Wechsel
// nachgefragt. Dazu die Reihenfolge in „Zum Wein“ und die Büroklammer für Dokumente.

import { formatDate, formatStarNumber } from "@/lib/format";
import { formatShare, type GrapeShare } from "@/lib/grapes/shares";

/** Offene Einheit (ID + Bezeichnung für die Rückfrage), ob geändert, letzte Meldung. */
export type UnitsState = {
  open: { id: string; label: string } | null;
  dirty: boolean;
  /** Meldung nach dem Speichern, in der Anzeige der Einheit („Gespeichert.“). */
  flash: { id: string; text: string } | null;
};

export const NO_UNIT: UnitsState = { open: null, dirty: false, flash: null };

export function discardQuestion(current: string, next: string) {
  return `„${current}“ hat ungespeicherte Änderungen. Verwerfen und „${next}“ bearbeiten?`;
}

/** ✏️ angetippt: öffnet diese Einheit und schliesst die bisherige (bei Änderungen nur nach Rückfrage). */
export function openUnit(
  state: UnitsState,
  unit: { id: string; label: string },
  confirm: (question: string) => boolean,
): UnitsState {
  if (state.open?.id === unit.id) return state;
  if (state.open && state.dirty && !confirm(discardQuestion(state.open.label, unit.label))) return state;
  return { open: unit, dirty: false, flash: null };
}

/** Abbrechen oder gespeichert: Einheit schliessen (nur wenn sie die offene ist). */
export function closeUnit(state: UnitsState, id: string, flash?: string): UnitsState {
  if (state.open?.id !== id) return state;
  return { open: null, dirty: false, flash: flash ? { id, text: flash } : null };
}

/** Eingabe in der offenen Einheit. */
export function markDirty(state: UnitsState, id: string): UnitsState {
  return state.open?.id === id && !state.dirty ? { ...state, dirty: true } : state;
}

/** Reihenfolge in „Zum Wein“: eine Tabelle (Rebsorten und Trinkreife als Zeilen), dann Fotos, Recherche. */
export const WINE_DETAIL_FIELDS = ["Typ", "Land", "Region", "Appellation", "Alkohol", "Flasche", "Rebsorten", "Trinkreife"] as const;
export type WineDetailField = (typeof WINE_DETAIL_FIELDS)[number];
export const WINE_SECTIONS = ["details", "research"] as const;
export type WineSection = (typeof WINE_SECTIONS)[number];

/** Zeile „Rebsorten“: „Cabernet Sauvignon 95 % · Malbec 5 %“, ohne Prozent nur die Namen; leer → null (Zeile fehlt). */
export function grapeLine(shares: GrapeShare[]) {
  return shares.length ? shares.map(formatShare).join(" · ") : null;
}

/** Zeile „Trinkreife“ auf der Weinseite: nur das Fenster („2025–2029“, ohne Status); ohne Fenster → null (Zeile fehlt). */
export function drinkRow(window: string | null) {
  return window || null;
}

/**
 * Büroklammer im Kopf: je Dokument eine Zeile mit dem vollen Namen (nicht gekürzt) und 📎 rechts;
 * ohne Dokument nur „📎“ zum Hinzufügen.
 */
export function docClipLines(names: string[]): { lines: string[]; label: string } {
  if (names.length === 0) return { lines: [], label: "Dokument hinzufügen" };
  return { lines: names, label: names.length === 1 ? "Dokument verwalten" : `${names.length} Dokumente verwalten` };
}

/** Kompakte Zeile eines Verkostet-Eintrags: „2022 · 28.10.2026 · Kronenhalle · ★ 4“ (Fehlendes fällt weg). */
export function encounterLine(e: { year: number | null; tastedOn: string; place: { name: string } | null; ratings: { rating: number }[] }) {
  return [
    e.year ?? "NV",
    formatDate(e.tastedOn),
    e.place?.name,
    // geschütztes Leerzeichen: „★ 4“ bricht nicht um
    e.ratings.length ? `★\u00a0${e.ratings.map((r) => formatStarNumber(r.rating)).join("/")}` : null,
  ]
    .filter((p) => p != null && p !== "")
    .join(" · ");
}

/** Karte „Verkostet“: je Eintrag die Zeile, dahinter „🛒 kaufen“, wenn der Merker gesetzt ist. */
export function encounterRows<T extends Parameters<typeof encounterLine>[0] & { id: string }>(encounters: T[], wantToBuy: boolean) {
  return encounters.map((e) => ({ entry: e, line: encounterLine(e), buy: wantToBuy ? BUY_MARK : null }));
}

export const BUY_MARK = "🛒\u00a0kaufen";

/** „Zum Wein“: Zeilen nach den Stammdaten; die Fotos stehen zuletzt (ohne Überschrift). */
export const WINE_EXTRA_ROWS = ["Laut Verkostung", "Jahrgang", "Notiz", "Fotos"] as const;
