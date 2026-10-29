import "server-only";

// Kategorien und Angaben der Spirituosen laden. Tolerant: vor der Migration (Tabelle bzw. Spalten
// fehlen) einfach leer – die Seiten funktionieren weiter, nur ohne Kategorien.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { toCategory, toSpiritFields, type SpiritCategory, type SpiritFields } from "./categories";
import { FALLBACK_CATEGORIES } from "./ai-categories";

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

/** Kategorien für Antoine: so lange zwischengespeichert (pro Instanz). */
export const AI_CATEGORIES_TTL_MS = 5 * 60 * 1000;
let aiCache: { at: number; categories: SpiritCategory[] } | null = null;

/** Zwischenspeicher leeren (Tests; nach Änderungen an den Kategorien). */
export function clearAiCategoryCache() {
  aiCache = null;
}

/**
 * Kategorien für Erkennung und Recherche (Schema und Prompt-Liste): aus spirit_categories,
 * 5 Minuten zwischengespeichert. Nicht lesbar bzw. leer: die feste Rückfall-Liste – der Fehler
 * wird protokolliert, der Ablauf läuft weiter. fromDb: Liste aus der DB (ids gültig).
 */
export async function spiritCategoriesForAi(db?: Db, now = Date.now()): Promise<{ categories: SpiritCategory[]; fromDb: boolean }> {
  if (aiCache && now - aiCache.at < AI_CATEGORIES_TTL_MS) return { categories: aiCache.categories, fromDb: true };
  try {
    const client = db ?? (await import("@/lib/supabase/admin")).createAdminClient();
    const categories = await loadSpiritCategories(client);
    if (!categories.length) throw new Error("spirit_categories leer bzw. fehlt");
    aiCache = { at: now, categories };
    return { categories, fromDb: true };
  } catch (error) {
    console.error("spirit categories for AI: fallback", error instanceof Error ? error.message : error);
    return { categories: FALLBACK_CATEGORIES, fromDb: false };
  }
}
