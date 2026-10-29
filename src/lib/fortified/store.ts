import "server-only";

// Haltbarkeit offen laden und setzen (wines.open_keep_*): Likörweine und Liköre (Spirituosen der
// Kategorie Likör). Fehlen Spalten bzw. ist die Art in der DB noch nicht erlaubt (Migration nicht
// eingespielt), gibt es einfach keine Haltbarkeit – nichts bricht.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { categoryPath, toCategory } from "@/lib/spirits/categories";
import { asKeepSource, estimateKeep, guessKeepStyle, keepApplies, liqueurStyle, type KeepSource, type KeepStyle } from "./keep";

type Db = SupabaseClient<Database>;

/** Spalten fehlen (Migration noch nicht eingespielt)? */
export const missingKeepColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST204", "42703"].includes(error.code ?? "") || /open_keep_/.test(error.message ?? ""));

/** Check verletzt (z. B. Spirituose vor der Migration, die Haltbarkeit bei Spirituosen erlaubt). */
export const keepNotAllowed = (error: { code?: string } | null) => error?.code === "23514";

export type KeepRow = { days: number | null; source: KeepSource | null; note: string | null };

const KEEP_COLUMNS = "id, name, producer, type, country, region, appellation, alcohol_content, spirit_category_id, open_keep_days, open_keep_source, open_keep_note" as const;
type KeepWineRow = Pick<
  Database["public"]["Tables"]["wines"]["Row"],
  "id" | "name" | "producer" | "type" | "country" | "region" | "appellation" | "alcohol_content" | "spirit_category_id" | "open_keep_days" | "open_keep_source" | "open_keep_note"
>;

/** Wein mit Haltbarkeit-Angaben und Stil (Likörwein: aus dem Namen; Likör: aus der Unterkategorie). */
export type KeepWine = KeepWineRow & { style: KeepStyle; liqueur: boolean };

/** Likörweine und Liköre unter den Weinen (andere fallen weg). */
export async function loadKeepWines(db: Db, wineIds: string[]): Promise<KeepWine[]> {
  const ids = [...new Set(wineIds)];
  if (!ids.length) return [];
  const { data, error } = await db.from("wines").select(KEEP_COLUMNS).in("id", ids).in("type", ["fortified", "spirit"]);
  if (error) {
    if (!missingKeepColumn(error)) console.error("loading open keep failed", error.message);
    return [];
  }
  const rows = (data ?? []) as KeepWineRow[];
  const needCategories = rows.some((w) => w.type === "spirit");
  const { data: cats, error: catError } = needCategories ? await db.from("spirit_categories").select("id, parent_id, name, sort_order") : { data: [], error: null };
  if (catError) console.error("loading spirit categories failed", catError.message);
  const categories = (cats ?? []).map(toCategory);
  return rows.flatMap((w): KeepWine[] => {
    if (w.type === "fortified") return [{ ...w, style: guessKeepStyle(w), liqueur: false }];
    const path = categoryPath(categories, w.spirit_category_id);
    const style = liqueurStyle(path.main?.name, path.sub?.name);
    return style && keepApplies(w.type, path.main?.name) ? [{ ...w, style, liqueur: true }] : [];
  });
}

/** Haltbarkeit offen je Wein (nur Likörweine und Liköre); ohne Migration leer. */
export async function loadOpenKeep(db: Db, wineIds: string[]): Promise<Map<string, KeepRow>> {
  const wines = await loadKeepWines(db, wineIds);
  return new Map(wines.map((w) => [w.id, { days: w.open_keep_days, source: asKeepSource(w.open_keep_source), note: w.open_keep_note }]));
}

/** Haltbarkeit von Hand (Weinseite): 1–3650 Tage bzw. leer (null). false = weder Likörwein noch Likör. */
export async function saveManualKeep(db: Db, wineId: string, days: number | null) {
  if (!(await loadKeepWines(db, [wineId])).length) return false;
  const values = days == null ? { open_keep_days: null, open_keep_source: null, open_keep_note: null } : { open_keep_days: days, open_keep_source: "manual", open_keep_note: null };
  const { data, error } = await db.from("wines").update(values).eq("id", wineId).select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Beim Öffnen: Haltbarkeit sicherstellen – fehlt sie noch (Recherche nach dem Einbuchen noch nicht
 * gelaufen), gleich die Schätzung nach Stil speichern; eine Quelle ersetzt sie später. Gibt die
 * Tage zurück (null: weder Likörwein noch Likör bzw. vor der Migration).
 */
export async function ensureOpenKeep(db: Db, wineId: string): Promise<number | null> {
  const [wine] = await loadKeepWines(db, [wineId]);
  if (!wine) return null;
  if (wine.open_keep_days != null) return wine.open_keep_days;
  const estimate = estimateKeep(wine.style);
  const { error } = await db
    .from("wines")
    .update({ open_keep_days: estimate.days, open_keep_source: estimate.source, open_keep_note: estimate.note })
    .eq("id", wineId)
    .is("open_keep_days", null);
  if (keepNotAllowed(error)) return null;
  if (error) throw error;
  return estimate.days;
}
