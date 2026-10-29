import "server-only";

// Spirituosen öffnet man von Hand (open_bottle wie bei Wein): Alle Flaschen bleiben zu, bis man
// eine öffnet. Eine offene Spirituose hat Öffnungsdatum und Füllstand, bleibt im Bestand und
// erscheint nie unter „Offen“. „Leer“ (auch Füllstand 0 %) bucht sie als getrunken – es rückt
// keine nächste Flasche nach (DB-Funktion spirit_bottle_empty; ohne sie Schritt für Schritt).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyEdit } from "@/lib/edit/edit";
import { NOTHING } from "@/lib/edit/helpers";

type Db = SupabaseClient<Database>;

/** DB-Funktion fehlt? */
const missingFunction = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST202", "42883"].includes(error.code ?? "") || /Could not find the function/i.test(error.message ?? ""));

export type OpenSpiritBottle = { itemId: string; fill: number | null; sizeMl: number | null; dateOpened: string | null };

/** Offene Flaschen einer Spirituose (zuerst geöffnete zuerst). */
export async function openSpiritBottles(db: Db, wineId: string): Promise<OpenSpiritBottle[]> {
  const { data, error } = await db
    .from("cellar_overview")
    .select("inventory_item_id, fill_level_percent, bottle_size_ml, date_opened")
    .eq("wine_id", wineId)
    .eq("status", "open")
    .order("date_opened", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).flatMap((r) =>
    r.inventory_item_id ? [{ itemId: r.inventory_item_id, fill: r.fill_level_percent, sizeMl: r.bottle_size_ml, dateOpened: r.date_opened }] : [],
  );
}

/** Bestand einer Spirituose: volle und offene Flaschen. */
export async function spiritStock(db: Db, wineId: string) {
  const { data, error } = await db.from("inventory_items").select("status, quantity").eq("wine_id", wineId).in("status", ["sealed", "open"]);
  if (error) throw error;
  const rows = data ?? [];
  return {
    sealed: rows.filter((r) => r.status === "sealed").reduce((n, r) => n + r.quantity, 0),
    open: rows.filter((r) => r.status === "open").length,
  };
}

export type EmptyResult =
  | { ok: true; name: string; sealed: number; open: number }
  | { ok: false; error: string; /** Mehrere offene Flaschen: welche? */ choices?: OpenSpiritBottle[] };

/** Welche offene Flasche? Angegeben, sonst die einzige offene. */
async function pickOpen(db: Db, wineId: string, name: string, itemId?: string | null): Promise<{ id: string } | { ok: false; error: string; choices?: OpenSpiritBottle[] }> {
  if (itemId) return { id: itemId };
  const open = await openSpiritBottles(db, wineId);
  if (open.length === 1) return { id: open[0].itemId };
  if (!open.length) return { ok: false, error: `Von ${name} ist gerade keine Flasche offen – nichts geändert.` };
  return { ok: false, error: `Von ${name} sind ${open.length} Flaschen offen – welche meinst du?`, choices: open };
}

/** Offene Flasche leer: getrunken (Füllstand 0). Keine nächste Flasche rückt nach. */
export async function emptySpiritBottle(db: Db, wineId: string, itemId?: string | null): Promise<EmptyResult> {
  const { data: wine, error: wineError } = await db.from("wines").select("name, type").eq("id", wineId).maybeSingle();
  if (wineError) throw wineError;
  if (!wine || wine.type !== "spirit") return { ok: false, error: "Das ist keine Spirituose – nichts geändert." };
  const picked = await pickOpen(db, wineId, wine.name, itemId);
  if (!("id" in picked)) return picked;

  const { data, error } = await db.rpc("spirit_bottle_empty", { p_item_id: picked.id });
  if (!error) {
    // Alte DB-Funktion (vor der Migration) öffnet die nächste Flasche gleich mit – wieder schliessen.
    const next = (data as { next_id?: string | null } | null)?.next_id;
    if (next) await closeAgain(db, next);
    return { ok: true, name: wine.name, ...(await spiritStock(db, wineId)) };
  }
  if (error.code === "22023" || error.code === "P0002") return { ok: false, error: "Diese Flasche ist nicht mehr offen – nichts geändert." };
  if (!missingFunction(error)) throw error;
  const { data: updated, error: updateError } = await db.from("inventory_items").update({ status: "drunk" }).eq("id", picked.id).eq("status", "open").select("id");
  if (updateError) throw updateError;
  if (!updated?.length) return { ok: false, error: "Diese Flasche ist nicht mehr offen – nichts geändert." };
  await db.from("open_bottle_details").update({ fill_level_percent: 0 }).eq("inventory_item_id", picked.id);
  return { ok: true, name: wine.name, ...(await spiritStock(db, wineId)) };
}

/** Von der alten DB-Funktion automatisch geöffnete Flasche wieder zu (bleibt als eigene Charge). */
async function closeAgain(db: Db, itemId: string) {
  const { error } = await db.from("inventory_items").update({ status: "sealed" }).eq("id", itemId).eq("status", "open");
  if (error) throw error;
  await db.from("open_bottle_details").delete().eq("inventory_item_id", itemId);
}

export type FillResult = { ok: true; fill: number; emptied?: EmptyResult & { ok: true } } | { ok: false; error: string; choices?: OpenSpiritBottle[] };

/** Füllstand einer offenen Flasche setzen (0 % = leer). */
export async function setSpiritFill(db: Db, wineId: string, percent: number, itemId?: string | null): Promise<FillResult> {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return { ok: false, error: "Füllstand bitte zwischen 0 und 100 %." };
  if (percent === 0) {
    const emptied = await emptySpiritBottle(db, wineId, itemId);
    return emptied.ok ? { ok: true, fill: 0, emptied } : emptied;
  }
  const { data: wine, error } = await db.from("wines").select("name").eq("id", wineId).maybeSingle();
  if (error) throw error;
  const picked = await pickOpen(db, wineId, wine?.name ?? "dieser Spirituose", itemId);
  if (!("id" in picked)) return picked;
  const result = await applyEdit(db, { kind: "openBottle", itemId: picked.id, fill: percent });
  // „Nichts zu ändern“ (gleicher Wert) gilt als erledigt.
  if (!result.ok && result.error !== NOTHING) return { ok: false, error: result.error };
  return { ok: true, fill: percent };
}
