import "server-only";

// Trinkfenster automatisch nach dem Einbuchen (Foto, Text, Nachkauf): im Hintergrund nach der
// Antwort, für genau diesen Jahrgang – nur wenn „ab“ und „bis“ leer sind. Quelle gefunden →
// research, sonst Schätzung (estimate). Nichts gefunden oder Fehler (auch API-Limit): nichts
// gesetzt, keine Meldung an die Person, nur ins Log.

import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export type AutoDrinkWindowResult = "exists" | "set" | "suggested" | "unchanged" | "none" | "failed";

export async function autoDrinkWindow(db: AdminClient, wineId: string, year: number | null): Promise<AutoDrinkWindowResult> {
  try {
    // Erst hier laden: kein Kreis beim Start, Umgebungsvariablen erst beim Ausführen.
    const { findAndStoreDrinkWindow } = await import("./drink-window");
    return (await findAndStoreDrinkWindow(db, wineId, year)).result;
  } catch (error) {
    const { usageLimit } = await import("@/lib/ai/api-errors");
    if (usageLimit(error)) console.error("api limit reached", "drink window auto", wineId, year);
    console.error("drink window auto failed", wineId, year, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** Nach dem Speichern einplanen (läuft nach der Antwort, blockiert nichts). */
export function scheduleDrinkWindow(wineId: string, year: number | null) {
  later(async () => autoDrinkWindow((await import("@/lib/supabase/admin")).createAdminClient(), wineId, year));
}
