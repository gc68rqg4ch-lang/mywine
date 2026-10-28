// Formular „Verkostet erfassen“: Reihenfolge und Pflichtfelder an einer Stelle (rein, ohne
// React) – das Formular rendert danach, die Tests prüfen es. Ziel: in 15 Sekunden erfasst.

/** Sofort sichtbar, in dieser Reihenfolge. */
export const ENCOUNTER_QUICK_FIELDS = ["wine", "vintage", "ratings", "note"] as const;

/** Unter „Mehr Angaben“ (zugeklappt), in dieser Reihenfolge. */
export const ENCOUNTER_MORE_FIELDS = [
  "producer",
  "type",
  "origin",
  "place",
  "price",
  "occasion",
  "companions",
  "wantToBuy",
  "date",
] as const;

export type EncounterFormField = (typeof ENCOUNTER_QUICK_FIELDS)[number] | (typeof ENCOUNTER_MORE_FIELDS)[number];

/** Pflicht sind nur Name und Jahrgang (NV möglich); alles andere ist freiwillig. */
export const ENCOUNTER_REQUIRED = ["name", "vintage"] as const;
