import "server-only";

// Spirituose nach dem Einbuchen: fehlende Angaben (Alter, Fass, Destilliert, Abgefüllt, Alkohol,
// Region; Kategorie nur aus den bestehenden) im Hintergrund recherchieren. Nichts gefunden oder
// Fehler (auch API-Limit): nichts gesetzt, keine Meldung an die Person, nur ins Log.

import { later } from "@/lib/later";
import type { AdminClient } from "@/lib/supabase/admin";

export async function autoSpiritResearch(db: AdminClient, wineId: string) {
  try {
    const [{ researchAndFillSpirit }, { loadShopPages }] = await Promise.all([import("./spirit"), import("./shops")]);
    const { data: wine, error } = await db.from("wines").select("id, name, producer, type, country, region, appellation, alcohol_content").eq("id", wineId).maybeSingle();
    if (error) throw error;
    if (!wine || wine.type !== "spirit") return "none";
    const pages = await loadShopPages(db, wine, [null]).catch(() => []);
    const result = await researchAndFillSpirit(db, wine, { pages });
    return result.filled.length || result.suggested ? "filled" : "none";
  } catch (error) {
    const { usageLimit } = await import("@/lib/ai/api-errors");
    if (usageLimit(error)) console.error("api limit reached", "spirit research auto", wineId);
    console.error("spirit research auto failed", wineId, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/** Nach dem Speichern einplanen (läuft nach der Antwort, blockiert nichts). */
export function scheduleSpiritResearch(wineId: string) {
  later(async () => autoSpiritResearch((await import("@/lib/supabase/admin")).createAdminClient(), wineId));
}
