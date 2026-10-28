// Weinseite: Bearbeiten direkt in der Karte (rein, ohne DB/React – auch für Tests).
// Immer nur eine Einheit offen; hat sie ungespeicherte Änderungen, wird vor dem Wechsel
// nachgefragt. Dazu die Reihenfolge in „Zum Wein“ und die Büroklammer für Dokumente.

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

/** Reihenfolge in „Zum Wein“. */
export const WINE_DETAIL_FIELDS = ["Typ", "Land", "Region", "Appellation", "Alkohol", "Flasche"] as const;
export const WINE_SECTIONS = ["details", "grapes", "drink", "photos", "research"] as const;
export type WineSection = (typeof WINE_SECTIONS)[number];

const CLIP_NAME_MAX = 24;

/** Langen Dateinamen kürzen, Endung bleibt sichtbar: „Sehr langer Prospe….pdf“. */
export function shortFileName(name: string, max = CLIP_NAME_MAX) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  return `${name.slice(0, max - ext.length - 1).trimEnd()}…${ext}`;
}

/** Büroklammer im Kopf: ohne Dokument nur „📎“, eines mit (gekürztem) Namen, sonst die Anzahl. */
export function docClip(names: string[]): { text: string; label: string } {
  if (names.length === 0) return { text: "📎", label: "Dokument hinzufügen" };
  if (names.length === 1) return { text: `📎 ${shortFileName(names[0])}`, label: `Dokument ${names[0]}` };
  return { text: `📎 ${names.length} Dokumente`, label: `${names.length} Dokumente` };
}
