// Jahrgang eines Weins holen oder anlegen (wine_vintages) – die einzige Stelle im Code, die
// einen Jahrgang anlegt. Sicher bei gleichzeitigen Aufrufen (Geschmacksprofil- und Trinkfenster-
// Suche laufen nach dem Einbuchen parallel): DB-Funktion ensure_wine_vintage (INSERT … ON CONFLICT
// DO NOTHING, dann SELECT). Ohne eingespielte Migration: lesen, sonst anlegen; scheitert das am
// eindeutigen Index (anderer Aufruf war schneller), nochmals lesen. Danach schreibt jeder Aufrufer
// nur seine eigenen Felder per UPDATE – keiner überschreibt die Felder des anderen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

const missingFunction = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || /ensure_wine_vintage/.test(error.message ?? ""));

async function findVintage(db: Db, wineId: string, year: number | null) {
  const q = db.from("wine_vintages").select("id").eq("wine_id", wineId);
  const { data, error } = await (year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year)).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** id des Jahrgangs (bestehend oder neu angelegt). year null = ohne Jahrgang (NV). */
export async function ensureVintage(db: Db, wineId: string, year: number | null): Promise<string> {
  const { data, error } = await db.rpc("ensure_wine_vintage", { p_wine_id: wineId, p_vintage_year: year as number });
  if (!error && data) return data;
  if (error && !missingFunction(error)) throw error;

  const existing = await findVintage(db, wineId, year);
  if (existing) return existing;
  const { data: created, error: insertError } = await db.from("wine_vintages").insert({ wine_id: wineId, vintage_year: year }).select("id").single();
  if (!insertError) return created.id;
  if (insertError.code !== "23505") throw insertError;
  // Gleichzeitig angelegt: den Eintrag des anderen Aufrufs nehmen.
  const again = await findVintage(db, wineId, year);
  if (!again) throw insertError;
  return again;
}
