import "server-only";

// Geschmacksprofile lesen und schreiben (wine_taste_profiles). Ein Profil pro Wein und
// Jahrgang (null = allgemein). Kein Upsert: erst lesen, dann ändern bzw. anlegen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { fromRow, toRow, type StoredTasteProfile, type TasteProfileData } from "./profile";

export type Db = SupabaseClient<Database>;

const COLUMNS =
  "id, wine_id, vintage_year, sweetness, acidity, tannin, alcohol, body, flavour_intensity, finish, aromas, style_summary, food_pairing, source, source_note, researched_at, sources, evidence, confidence" as const;

/** Profil genau für diesen Jahrgang (null = das allgemeine). */
export async function loadExactTasteProfile(db: Db, wineId: string, year: number | null): Promise<StoredTasteProfile | null> {
  const q = db.from("wine_taste_profiles").select(COLUMNS).eq("wine_id", wineId);
  const { data, error } = await (year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year)).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

/** Profil für die Anzeige: nur das des gewählten Jahrgangs (NV: das des Weins ohne Jahrgang). */
export const loadTasteProfile = loadExactTasteProfile;

/** IDs der Weine mit mindestens einem Profil (für „Geschmacksprofil fehlt“). */
export async function winesWithTasteProfile(db: Db): Promise<Set<string>> {
  const { data, error } = await db.from("wine_taste_profiles").select("wine_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.wine_id));
}

/**
 * Profil speichern (Jahrgang aus profile.vintageYear). onlyResearch: ein bestehendes Profil
 * von Hand bleibt unangetastet → „manual“.
 */
export async function saveTasteProfile(
  db: Db,
  s: { wineId: string; profile: TasteProfileData; source: "research" | "manual"; onlyResearch?: boolean },
): Promise<"saved" | "manual"> {
  const existing = await loadExactTasteProfile(db, s.wineId, s.profile.vintageYear);
  if (existing?.source === "manual" && s.onlyResearch) return "manual";
  const row = {
    ...toRow(s.profile),
    aromas: s.profile.aromas as Json,
    sources: s.profile.sources as unknown as Json,
    evidence: s.profile.evidence as unknown as Json,
    source: s.source,
    ...(s.source === "research" ? { researched_at: new Date().toISOString() } : {}),
  };
  const { error } = existing
    ? await db.from("wine_taste_profiles").update(row).eq("id", existing.id)
    : await db.from("wine_taste_profiles").insert({ ...row, wine_id: s.wineId, vintage_year: s.profile.vintageYear });
  if (error) throw error;
  return "saved";
}
