import "server-only";

// Likörweine: Haltbarkeit offen laden und von Hand setzen (wines.open_keep_*). Vor der Migration
// fehlen die Spalten – dann einfach keine Haltbarkeit (nichts bricht).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asKeepSource, estimateKeep, guessKeepStyle, type KeepSource } from "./keep";

type Db = SupabaseClient<Database>;

/** Spalten fehlen (Migration noch nicht eingespielt)? */
export const missingKeepColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST204", "42703"].includes(error.code ?? "") || /open_keep_/.test(error.message ?? ""));

export type KeepRow = { days: number | null; source: KeepSource | null; note: string | null };

/** Haltbarkeit offen je Wein (nur Likörweine); ohne Migration leer. */
export async function loadOpenKeep(db: Db, wineIds: string[]): Promise<Map<string, KeepRow>> {
  const ids = [...new Set(wineIds)];
  if (!ids.length) return new Map();
  const { data, error } = await db.from("wines").select("id, open_keep_days, open_keep_source, open_keep_note").in("id", ids).eq("type", "fortified");
  if (error) {
    if (!missingKeepColumn(error)) console.error("loading open keep failed", error.message);
    return new Map();
  }
  return new Map((data ?? []).map((w) => [w.id, { days: w.open_keep_days, source: asKeepSource(w.open_keep_source), note: w.open_keep_note }]));
}

/** Haltbarkeit von Hand (Weinseite, Bot): 1–3650 Tage bzw. leer (null). false = kein Likörwein. */
export async function saveManualKeep(db: Db, wineId: string, days: number | null) {
  const values = days == null ? { open_keep_days: null, open_keep_source: null, open_keep_note: null } : { open_keep_days: days, open_keep_source: "manual", open_keep_note: null };
  const { data, error } = await db.from("wines").update(values).eq("id", wineId).eq("type", "fortified").select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Beim Öffnen eines Likörweins: Haltbarkeit sicherstellen – fehlt sie noch (Recherche nach dem
 * Einbuchen noch nicht gelaufen), gleich die Schätzung nach Stil speichern; eine Quelle ersetzt sie
 * später. Gibt die Tage zurück (null: kein Likörwein bzw. vor der Migration).
 */
export async function ensureOpenKeep(db: Db, wineId: string): Promise<number | null> {
  const { data: wine, error } = await db.from("wines").select("name, producer, type, country, region, appellation, open_keep_days").eq("id", wineId).maybeSingle();
  if (missingKeepColumn(error)) return null;
  if (error) throw error;
  if (!wine || wine.type !== "fortified") return null;
  if (wine.open_keep_days != null) return wine.open_keep_days;
  const estimate = estimateKeep(guessKeepStyle(wine));
  const { error: updateError } = await db
    .from("wines")
    .update({ open_keep_days: estimate.days, open_keep_source: estimate.source, open_keep_note: estimate.note })
    .eq("id", wineId)
    .is("open_keep_days", null);
  if (updateError) throw updateError;
  return estimate.days;
}
