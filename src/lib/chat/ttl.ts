// Zeitgrenze für offene Rückfragen im Bot (rein, ohne DB): 10 Minuten ab der letzten Antwort.
// Gilt für alle offenen Zustände – Kauf, Neuer Wein, Verkostet, WSET, Foto zuordnen,
// Chat-Vorschläge und Blättern im Menü. Der DB-Job expire-stale-ingest-jobs (alle 2 Min.)
// nutzt dieselbe Grenze.

export const PENDING_TTL_MINUTES = 10;
export const PENDING_TTL_MS = PENDING_TTL_MINUTES * 60 * 1000;
export const EXPIRED_ERROR = `abgelaufen: ${PENDING_TTL_MINUTES} Min. ohne Antwort`;

/** Knopf einer Nachricht: zuletzt angefasst (gesendet bzw. bearbeitet) vor mehr als 10 Minuten? date 0 = unbekannt. */
export function staleMessage(msg: { date: number; edit_date?: number } | undefined, now = Date.now()) {
  const last = Math.max(msg?.date ?? 0, msg?.edit_date ?? 0);
  return last > 0 && last * 1000 < now - PENDING_TTL_MS;
}
