import "server-only";

// Likörwein nach dem Einbuchen: Haltbarkeit offen im Hintergrund (Quelle, sonst Schätzung nach
// Stil) – nur wenn noch keine gesetzt ist. Fehler (auch API-Limit): nichts gesetzt, keine Meldung
// an die Person, nur ins Log.

import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export async function autoOpenKeep(db: AdminClient, wineId: string, options: { replaceEstimate?: boolean } = {}) {
  try {
    const { findAndStoreOpenKeep } = await import("./open-keep");
    return (await findAndStoreOpenKeep(db, wineId, { onlyIfEmpty: !options.replaceEstimate })).result;
  } catch (error) {
    const { usageLimit } = await import("@/lib/ai/api-errors");
    if (usageLimit(error)) console.error("api limit reached", "open keep auto", wineId);
    console.error("open keep auto failed", wineId, error instanceof Error ? error.message : error);
    return "failed" as const;
  }
}

/** Nach dem Speichern einplanen (läuft nach der Antwort, blockiert nichts). replaceEstimate: eine Schätzung durch eine Quelle ersetzen. */
export function scheduleOpenKeep(wineId: string, options: { replaceEstimate?: boolean } = {}) {
  later(async () => autoOpenKeep((await import("@/lib/supabase/admin")).createAdminClient(), wineId, options));
}

/**
 * Likörwein geöffnet (App und Bot): Haltbarkeit sicherstellen – fehlt sie, gleich die Schätzung
 * nach Stil speichern und im Hintergrund eine Quelle suchen. Gibt die Tage zurück (null: keine).
 * Fehler: nur ins Log (das Öffnen ist dann trotzdem gelungen).
 */
export async function keepOnOpen(db: AdminClient, wineId: string): Promise<number | null> {
  try {
    const { ensureOpenKeep, loadOpenKeep } = await import("@/lib/fortified/store");
    const known = await loadOpenKeep(db, [wineId]);
    const days = await ensureOpenKeep(db, wineId);
    if (days != null && known.get(wineId)?.days == null) scheduleOpenKeep(wineId, { replaceEstimate: true });
    return days;
  } catch (error) {
    console.error("open keep on open failed", wineId, error instanceof Error ? error.message : error);
    return null;
  }
}
