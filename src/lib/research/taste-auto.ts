import "server-only";

// Geschmacksprofil automatisch nach dem Erfassen (Einbuchen per Foto/Text, Nachkauf,
// Verkostet in Bot und App): im Hintergrund nach der Antwort, für genau diesen Jahrgang,
// mit denselben Regeln wie die Recherche (jahrgangsgenau, nur Belegtes, NV-Ausnahme).
// Gibt es schon ein Profil oder wurde der Jahrgang in den letzten 12 Monaten (ohne Fund) gesucht,
// wird nicht gesucht. Jede Suche setzt wine_vintages.taste_profile_checked_at. Nichts gefunden
// oder Fehler (auch API-Limit): keine Meldung an die Person, nur ins Log.
// Angehängte PDFs dieses Jahrgangs gehen als zusätzliche Quelle mit. Neues PDF (force): gesucht
// wird auch, wenn der Jahrgang in den letzten 12 Monaten schon gesucht wurde.

import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export type AutoTasteResult = "exists" | "recent" | "saved" | "suggested" | "unchanged" | "none" | "failed";

export type AutoTasteOptions = {
  /** Neues Dokument angehängt: 12-Monats-Regel gilt nicht. */
  force?: boolean;
};

export async function autoTasteProfile(
  db: AdminClient,
  wineId: string,
  year: number | null,
  options: AutoTasteOptions = {},
): Promise<AutoTasteResult> {
  try {
    // Erst hier laden: die Recherche zieht das Bearbeiten-Modul nach (Vorschläge) – kein Kreis beim Start.
    const [
      { loadExactTasteProfile, markTasteChecked, tasteCheckedAt },
      { researchTasteProfile, saveResearchedProfile },
      { withinRecentMonths, newDocumentSince },
      { loadResearchDocuments },
    ] = await Promise.all([import("@/lib/taste/store"), import("./taste"), import("./gaps"), import("./documents")]);
    if (await loadExactTasteProfile(db, wineId, year)) return "exists";
    if (!options.force) {
      const checkedAt = await tasteCheckedAt(db, wineId, year);
      if (withinRecentMonths(checkedAt) && !newDocumentSince(await documentRows(db, wineId, year), wineId, year, checkedAt)) return "recent";
    }
    const { data: wine, error } = await db.from("wines").select("name, producer, type, region, country").eq("id", wineId).maybeSingle();
    if (error) throw error;
    if (!wine) return "none";
    const documents = await loadResearchDocuments(db, { id: wineId, name: wine.name }, [year]);
    const profile = await researchTasteProfile(wine, year, documents);
    await markTasteChecked(db, wineId, year);
    if (!profile) return "none";
    return await saveResearchedProfile(db, wineId, profile);
  } catch (error) {
    const { usageLimit } = await import("@/lib/ai/api-errors");
    if (usageLimit(error)) console.error("api limit reached", "taste profile auto", wineId, year);
    console.error("taste profile auto failed", wineId, year, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** PDFs genau dieses Jahrgangs (ohne Inhalt) – für „neues Dokument seit der letzten Suche“. */
async function documentRows(db: AdminClient, wineId: string, year: number | null) {
  const query = db.from("wine_media").select("wine_id, vintage_year, created_at").eq("wine_id", wineId).eq("kind", "document");
  const { data, error } = await (year == null ? query.is("vintage_year", null) : query.eq("vintage_year", year));
  if (error) throw error;
  return data ?? [];
}

/** Nach dem Speichern einplanen (läuft nach der Antwort, blockiert nichts). */
export function scheduleTasteProfile(wineId: string, year: number | null, options: AutoTasteOptions = {}) {
  // Admin-Client erst beim Ausführen laden (Umgebungsvariablen werden dort geprüft).
  later(async () => autoTasteProfile((await import("@/lib/supabase/admin")).createAdminClient(), wineId, year, options));
}
