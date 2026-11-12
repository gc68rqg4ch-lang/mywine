// Offene Flasche zuerst: Bevor irgendwo eine Flasche geöffnet wird (Bot-Menü, Chat-Vorschlag,
// App), prüft dieselbe Funktion, ob vom selben Wein schon eine offen ist – unabhängig vom
// Jahrgang. Ist eine offen, fragt die Stelle nach („Trotzdem eine weitere öffnen?“) statt direkt
// zu öffnen. Ein Glas kommt fast immer von der offenen Flasche.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export type OpenBottle = { itemId: string; year: number | null; fill: number | null; sizeMl: number | null; dateOpened: string | null };

/** Offene Flaschen eines Weins, alle Jahrgänge (zuerst geöffnete zuerst). */
export async function openBottlesOfWine(db: Db, wineId: string): Promise<OpenBottle[]> {
  const { data, error } = await db
    .from("cellar_overview")
    .select("inventory_item_id, vintage_year, fill_level_percent, bottle_size_ml, date_opened")
    .eq("wine_id", wineId)
    .eq("status", "open")
    .order("date_opened", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).flatMap((r) =>
    r.inventory_item_id
      ? [{ itemId: r.inventory_item_id, year: r.vintage_year ?? null, fill: r.fill_level_percent, sizeMl: r.bottle_size_ml, dateOpened: r.date_opened }]
      : [],
  );
}

/**
 * Rückfrage vor dem Öffnen, wenn schon eine offen ist (rein): Wein mit Jahrgang und Füllstand,
 * Spirituose wie bisher („Es ist schon eine offen (~40 %) …“). Keine offen: null.
 */
export function alreadyOpenQuestion(open: readonly OpenBottle[], type: string | null | undefined): string | null {
  const first = open[0];
  if (!first) return null;
  if (type === "spirit") return `Es ist schon eine offen${first.fill != null ? ` (~${first.fill} %)` : ""}. Trotzdem eine weitere öffnen?`;
  const facts = [first.year == null ? "ohne Jahrgang" : String(first.year), first.fill != null ? `${first.fill} %` : null].filter(Boolean).join(", ");
  return `Von diesem Wein ist schon eine Flasche offen (${facts}). Trotzdem eine weitere öffnen?`;
}

/**
 * Vor dem Öffnen einer Charge (App): Rückfrage, wenn vom selben Wein schon eine Flasche offen
 * ist und noch nicht bestätigt wurde („Trotzdem öffnen“); sonst null = öffnen.
 */
export async function openNeedsConfirmation(db: Db, batchId: string, confirmed: boolean): Promise<string | null> {
  if (confirmed) return null;
  const { data: batch, error } = await db.from("inventory_items").select("wine_id, wine:wines(type)").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) return null;
  return alreadyOpenQuestion(await openBottlesOfWine(db, batch.wine_id), (batch.wine as { type?: string | null } | null)?.type);
}
