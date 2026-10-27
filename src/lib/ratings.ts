import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { todayIso } from "@/lib/format";

type Db = SupabaseClient<Database>;

export function isValidRating(rating: number) {
  return rating >= 0 && rating <= 5 && Number.isInteger(rating * 2);
}

/**
 * Subjektive Bewertung einer Person (0–5 in halben Schritten) für Wein + Jahrgang.
 * Pro Person und Tag gibt es eine Bewertung: am selben Tag wird sie überschrieben,
 * an einem neuen Tag kommt eine neue hinzu (Verlauf bleibt erhalten).
 * rating = null entfernt die heutige Bewertung.
 */
export async function saveRating(
  db: Db,
  target: { wineId: string; vintageYear: number | null; itemId: string | null },
  personId: string,
  rating: number | null,
) {
  const today = todayIso();
  let query = db
    .from("wine_ratings")
    .select("id")
    .eq("wine_id", target.wineId)
    .eq("person_id", personId)
    .eq("rated_at", today);
  query = target.vintageYear == null
    ? query.is("vintage_year", null)
    : query.eq("vintage_year", target.vintageYear);
  const { data: existing, error: findError } = await query.order("created_at", { ascending: false });
  if (findError) throw findError;

  const todayId = existing?.[0]?.id;
  let error;
  if (rating == null) {
    if (!todayId) return;
    ({ error } = await db.from("wine_ratings").delete().eq("id", todayId));
  } else if (todayId) {
    ({ error } = await db
      .from("wine_ratings")
      .update({ rating, ...(target.itemId ? { inventory_item_id: target.itemId } : {}) })
      .eq("id", todayId));
  } else {
    ({ error } = await db.from("wine_ratings").insert({
      wine_id: target.wineId,
      vintage_year: target.vintageYear,
      person_id: personId,
      rating,
      rated_at: today,
      inventory_item_id: target.itemId,
      source: "manual",
    }));
  }
  if (error) throw error;
}
