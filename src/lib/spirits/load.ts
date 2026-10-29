import "server-only";

// Kategorien und Angaben der Spirituosen laden. Tolerant: vor der Migration (Tabelle bzw. Spalten
// fehlen) einfach leer – die Seiten funktionieren weiter, nur ohne Kategorien.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toCategory, toSpiritFields, type SpiritCategory, type SpiritFields } from "./categories";

type Db = SupabaseClient<Database>;

/** Tabelle oder Spalte fehlt (Migration noch nicht eingespielt). */
export const missingSchema = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST205", "PGRST204", "42P01", "42703", "PGRST200"].includes(error.code ?? "") || /spirit_categor|age_years|bottled_year|distilled_year|cask/.test(error.message ?? ""));

export async function loadSpiritCategories(db: Db): Promise<SpiritCategory[]> {
  const { data, error } = await db.from("spirit_categories").select("id, parent_id, name, sort_order");
  if (missingSchema(error)) return [];
  if (error) throw error;
  return (data ?? []).map(toCategory);
}

const SPIRIT_COLUMNS = "id, spirit_category_id, age_years, cask, distilled_year, bottled_year";

/** Angaben je Wein (nur Weine mit mindestens einer Angabe); wineIds null = alle. */
export async function loadSpiritFields(db: Db, wineIds: string[] | null): Promise<Map<string, SpiritFields>> {
  if (wineIds && !wineIds.length) return new Map();
  const query = db.from("wines").select(SPIRIT_COLUMNS);
  const { data, error } = await (wineIds ? query.in("id", wineIds) : query);
  if (missingSchema(error)) return new Map();
  if (error) throw error;
  const out = new Map<string, SpiritFields>();
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const f = toSpiritFields(r);
    if (f.categoryId || f.ageYears || f.cask || f.distilledYear || f.bottledYear) out.set(String(r.id), f);
  }
  return out;
}

/** Beides zusammen (Listen, Weinseite). */
export async function loadSpirits(db: Db, wineIds: string[] | null) {
  const [categories, fields] = await Promise.all([loadSpiritCategories(db), loadSpiritFields(db, wineIds)]);
  return { categories, fields };
}
