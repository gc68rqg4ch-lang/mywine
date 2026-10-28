import "server-only";

// Gemeinsames Laden für die Listen: neueste Bewertung je Person und Trinkfenster je Jahrgang.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { latestByPerson, type PersonRating, type RatingRow } from "./lists";

type Db = SupabaseClient<Database>;

/** Neueste Bewertung je Person und Wein (über alle Jahrgänge), Personen in fester Reihenfolge. */
export async function loadRatingsByWine(db: Db, wineIds: string[] | null): Promise<Map<string, PersonRating[]>> {
  if (wineIds && !wineIds.length) return new Map();
  // null = alle Weine (z. B. Bestand: gleichzeitig mit der Liste laden statt danach).
  const query = db.from("latest_wine_ratings").select("wine_id, person_name, rating, rated_at");
  const [ratings, persons] = await Promise.all([
    wineIds ? query.in("wine_id", wineIds) : query,
    db.from("persons").select("name").order("sort_order"),
  ]);
  if (ratings.error) throw ratings.error;
  const order = (persons.data ?? []).map((p) => p.name);
  const rank = (name: string) => (order.indexOf(name) < 0 ? order.length : order.indexOf(name));
  const byWine = new Map<string, RatingRow[]>();
  for (const r of ratings.data ?? []) if (r.wine_id) byWine.set(r.wine_id, [...(byWine.get(r.wine_id) ?? []), r]);
  return new Map([...byWine].map(([id, rows]) => [id, latestByPerson(rows).sort((a, b) => rank(a.person) - rank(b.person))]));
}

/** Trinkfenster aller Jahrgänge dieser Weine (für Filter und Trinkreife). */
export async function loadDrinkWindows(db: Db, wineIds: string[] | null) {
  if (wineIds && !wineIds.length) return [];
  // „*“: drink_window_source gibt es erst nach der Migration – so geht nichts kaputt. null = alle.
  const query = db.from("wine_vintages").select("*");
  const { data, error } = await (wineIds ? query.in("wine_id", wineIds) : query);
  if (error) throw error;
  return (data ?? []).map((v) => ({
    wine_id: v.wine_id,
    vintage_year: v.vintage_year,
    drink_from_year: v.drink_from_year,
    drink_until_year: v.drink_until_year,
    drink_window_source: v.drink_window_source ?? null,
  }));
}
