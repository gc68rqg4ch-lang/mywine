import "server-only";

// Startseite: alle Daten in einem Schritt (Abfragen parallel) – für die Kacheln und für Antoines
// Text. Zeitgrenzen in Europe/Zurich (Abfragen etwas grosszügiger, genau gefiltert wird in
// summary.ts). daily_notes fehlt vor der Migration: dann einfach keine Tagestexte.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asWineType } from "@/lib/format";
import { daysBefore, zurichParts } from "./dates";
import type { NoteRow } from "./prompt";
import type { WineRef } from "./note";
import type { DrunkItem, HomeInput, PersonRating, Purchase, StockItem } from "./summary";

type Db = SupabaseClient<Database>;

export type StoredNote = NoteRow & { id: string; wines: WineRef[]; error: string | null; created_at: string };
export type HomeData = HomeInput & {
  notes: StoredNote[] | null;
};

/** Tabelle fehlt (Migration noch nicht eingespielt). */
export const missingNotesTable = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST205", "42P01"].includes(error.code ?? "") || /daily_notes/.test(error.message ?? ""));

export function asRefs(value: unknown): WineRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const r = v as Partial<WineRef>;
    return typeof r?.ref === "string" && typeof r.wine_id === "string" && typeof r.name === "string"
      ? [{ ref: r.ref, wine_id: r.wine_id, vintage_year: typeof r.vintage_year === "number" ? r.vintage_year : null, name: r.name }]
      : [];
  });
}

/** Tagestexte der Person ab vor 8 Tagen (heute + die letzten 7); null = Tabelle fehlt. */
export async function loadNotes(db: Db, personId: string, today: string): Promise<StoredNote[] | null> {
  const { data, error } = await db
    .from("daily_notes")
    .select("id, note_date, status, text, wines, error, created_at")
    .eq("person_id", personId)
    .gte("note_date", daysBefore(today, 8))
    .order("note_date", { ascending: false });
  if (missingNotesTable(error)) return null;
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, wines: asRefs(r.wines) }));
}

export async function loadHomeData(db: Db, personId: string | null, now: Date | number = Date.now()): Promise<HomeData> {
  const p = zurichParts(now);
  const month = `${p.date.slice(0, 7)}-01`;
  const [stock, drunk, purchases, tasted, ratings, profiles, suggestions, notes] = await Promise.all([
    db
      .from("cellar_overview")
      .select("inventory_item_id, wine_id, name, producer, type, vintage_year, status, quantity, stock_value, stock_value_regular, date_opened, purchased_at, drink_from_year, drink_until_year, storage_house, storage_room")
      .in("status", ["sealed", "open"]),
    db
      .from("inventory_items")
      .select("wine_id, vintage_year, quantity, drunk_at, wine:wines(name, type)")
      .eq("status", "drunk")
      .gte("drunk_at", `${p.year - 1}-12-31`),
    db
      .from("inventory_events")
      .select("occurred_at, wine_id, vintage_year, quantity, price, item:inventory_items(is_gift), wine:wines(name)")
      .eq("event_type", "purchased")
      .gte("occurred_at", `${p.year - 2}-12-31`)
      .order("occurred_at", { ascending: false }),
    db.from("wine_encounters").select("id", { count: "exact", head: true }).gte("tasted_on", month),
    personId
      ? db.from("wine_ratings").select("wine_id, vintage_year, rating, rated_at, wine:wines(name)").eq("person_id", personId).order("rated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    db.from("wine_taste_profiles").select("wine_id, vintage_year, style_summary").not("style_summary", "is", null),
    db.from("research_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    personId ? loadNotes(db, personId, p.date) : Promise.resolve(null),
  ]);
  for (const r of [stock, drunk, purchases, ratings]) if (r.error) throw r.error;

  const stockItems: StockItem[] = (stock.data ?? []).flatMap((s) =>
    s.wine_id && s.inventory_item_id && (s.status === "sealed" || s.status === "open")
      ? [
          {
            itemId: s.inventory_item_id,
            wineId: s.wine_id,
            name: s.name ?? "Wein",
            producer: s.producer,
            type: asWineType(s.type),
            year: s.vintage_year,
            // Spirituose: die aktuelle Flasche zählt wie eine volle (Bestand, Wert); kein „offen“.
            status: s.status === "open" && s.type === "spirit" ? "sealed" : s.status,
            quantity: s.quantity ?? 1,
            paid: s.stock_value,
            regular: s.stock_value_regular,
            dateOpened: s.date_opened,
            purchasedAt: s.purchased_at,
            drinkFrom: s.drink_from_year,
            drinkUntil: s.drink_until_year,
            house: s.storage_house,
            room: s.storage_room,
          },
        ]
      : [],
  );
  const drunkItems: DrunkItem[] = (drunk.data ?? []).map((d) => ({
    wineId: d.wine_id,
    name: d.wine?.name ?? "Wein",
    type: asWineType(d.wine?.type),
    year: d.vintage_year,
    quantity: d.quantity ?? 1,
    drunkAt: d.drunk_at,
  }));
  const purchaseRows: Purchase[] = (purchases.data ?? []).map((e) => ({
    at: e.occurred_at,
    wineId: e.wine_id,
    name: e.wine?.name ?? null,
    year: e.vintage_year,
    quantity: e.quantity ?? 0,
    price: e.price,
    gift: !!e.item?.is_gift,
  }));
  // Neuste Bewertung je Wein + Jahrgang; Stil aus dem Geschmacksprofil (Jahrgang, sonst Wein).
  const style = new Map<string, string>();
  for (const t of profiles.data ?? []) if (t.style_summary) style.set(`${t.wine_id}|${t.vintage_year ?? "nv"}`, t.style_summary);
  const seen = new Set<string>();
  const personRatings: PersonRating[] = [];
  for (const r of ratings.data ?? []) {
    const key = `${r.wine_id}|${r.vintage_year ?? "nv"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    personRatings.push({
      wineId: r.wine_id,
      year: r.vintage_year,
      name: (r as { wine?: { name?: string } | null }).wine?.name ?? "Wein",
      rating: r.rating,
      styleSummary: style.get(key) ?? style.get(`${r.wine_id}|nv`) ?? null,
    });
  }
  return {
    stock: stockItems,
    drunk: drunkItems,
    purchases: purchaseRows,
    tastedThisMonth: tasted.count ?? 0,
    ratings: personRatings,
    pendingSuggestions: suggestions.count ?? 0,
    notes,
  };
}
