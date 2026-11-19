// Adressen des WSET-Tools (rein): Start mit Flasche, aus einem Eintrag „Verkostet“ oder nur
// für Wein + Jahrgang; Bearbeiten einer bestehenden Bewertung je nach Zuordnung.

const yearParam = (year: number | null) => (year == null ? "ohne" : String(year));

/** Neue WSET-Bewertung aus einem Eintrag „Verkostet“ (optional für eine bestimmte Person). */
export function encounterWsetHref(encounterId: string, options: { personId?: string | null; tastingId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.tastingId) params.set("t", options.tastingId);
  if (options.personId) params.set("person", options.personId);
  const query = params.toString();
  return `/verkostet/${encounterId}/wset${query ? `?${query}` : ""}`;
}

/**
 * WSET-Bewertung für Wein + Jahrgang ohne Flasche: mit Verkostungen erst die Auswahl
 * (welcher Eintrag bzw. ohne), frei=1 direkt das Formular ohne Eintrag.
 */
export function wineWsetHref(wineId: string, year: number | null, options: { free?: boolean; tastingId?: string } = {}) {
  const params = new URLSearchParams({ jahrgang: yearParam(year) });
  if (options.free) params.set("frei", "1");
  if (options.tastingId) params.set("t", options.tastingId);
  return `/wein/${wineId}/wset?${params.toString()}`;
}

/** Knopf „WSET-Bewertung“ der Weinseite: mit Flasche wie bisher, sonst ohne Flasche. */
export function newWsetHref(wineId: string, year: number | null, itemId: string | null | undefined) {
  return itemId ? `/flasche/${itemId}/verkostung` : wineWsetHref(wineId, year);
}

/** Bestehende Bewertung bearbeiten – dort, woran sie hängt (Eintrag, Flasche oder nur Wein). */
export function tastingHref(t: {
  id: string;
  wine_id: string;
  vintage_year: number | null;
  inventory_item_id: string | null;
  encounter_id: string | null;
}) {
  if (t.encounter_id) return encounterWsetHref(t.encounter_id, { tastingId: t.id });
  if (t.inventory_item_id) return `/flasche/${t.inventory_item_id}/verkostung?t=${t.id}`;
  return wineWsetHref(t.wine_id, t.vintage_year, { tastingId: t.id });
}

/** Personen-Vorauswahl: ?person=<id> (Link von Antoine) gilt, wenn es die Person gibt; sonst das Login. */
export function preselectedPerson(param: unknown, persons: { id: string }[], loggedIn: string | null) {
  return typeof param === "string" && persons.some((p) => p.id === param) ? param : loggedIn;
}
