import "server-only";

// Geschmacksprofil automatisch nach dem Erfassen (Einbuchen per Foto/Text, Nachkauf,
// Verkostet in Bot und App): im Hintergrund nach der Antwort, für genau diesen Jahrgang,
// mit denselben Regeln wie die Recherche (jahrgangsgenau, nur Belegtes, NV-Ausnahme).
// Gibt es schon ein Profil, wird nicht gesucht. Nichts gefunden oder Fehler (auch API-Limit):
// keine Meldung an die Person, nur ins Log.

import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export type AutoTasteResult = "exists" | "saved" | "suggested" | "unchanged" | "none" | "failed";

export async function autoTasteProfile(db: AdminClient, wineId: string, year: number | null): Promise<AutoTasteResult> {
  try {
    // Erst hier laden: die Recherche zieht das Bearbeiten-Modul nach (Vorschläge) – kein Kreis beim Start.
    const [{ loadExactTasteProfile }, { researchTasteProfile, saveResearchedProfile }] = await Promise.all([
      import("@/lib/taste/store"),
      import("./taste"),
    ]);
    if (await loadExactTasteProfile(db, wineId, year)) return "exists";
    const { data: wine, error } = await db.from("wines").select("name, producer, type, region, country").eq("id", wineId).maybeSingle();
    if (error) throw error;
    if (!wine) return "none";
    const profile = await researchTasteProfile(wine, year);
    if (!profile) return "none";
    return await saveResearchedProfile(db, wineId, profile);
  } catch (error) {
    console.error("taste profile auto failed", wineId, year, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** Nach dem Speichern einplanen (läuft nach der Antwort, blockiert nichts). */
export function scheduleTasteProfile(wineId: string, year: number | null) {
  // Admin-Client erst beim Ausführen laden (Umgebungsvariablen werden dort geprüft).
  later(async () => autoTasteProfile((await import("@/lib/supabase/admin")).createAdminClient(), wineId, year));
}
