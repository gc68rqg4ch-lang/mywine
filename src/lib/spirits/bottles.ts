import "server-only";

// Spirituosen kennen kein „offen“ wie Wein: Im Bestand ist je Spirituose (und Flaschengrösse)
// genau eine Flasche die „aktuelle“ (status open + Füllstand), die übrigen sind voll (sealed);
// leer = drunk. Nach dem Einbuchen wird eine volle aktuell (100 %), eine vorhandene bleibt.
// „Leer“ (auch Füllstand 0 %) bucht die aktuelle als getrunken und macht die nächste volle zur
// aktuellen – atomar über die DB-Funktion spirit_bottle_empty; ohne Migration Schritt für Schritt.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyEdit } from "@/lib/edit/edit";
import { NOTHING } from "@/lib/edit/helpers";
import { todayIso } from "@/lib/format";

type Db = SupabaseClient<Database>;

/** DB-Funktion fehlt (Migration noch nicht eingespielt). */
const missingFunction = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST202", "42883"].includes(error.code ?? "") || /Could not find the function/i.test(error.message ?? ""));

export type CurrentBottle = { itemId: string; fill: number | null; sizeMl: number | null };

/** Aktuelle Flasche(n) einer Spirituose (älteste zuerst). */
export async function currentBottles(db: Db, wineId: string): Promise<CurrentBottle[]> {
  const { data, error } = await db
    .from("cellar_overview")
    .select("inventory_item_id, fill_level_percent, bottle_size_ml")
    .eq("wine_id", wineId)
    .eq("status", "open")
    .order("date_opened", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).flatMap((r) => (r.inventory_item_id ? [{ itemId: r.inventory_item_id, fill: r.fill_level_percent, sizeMl: r.bottle_size_ml }] : []));
}

/** Bestand einer Spirituose: volle plus aktuelle Flaschen. */
async function remainingBottles(db: Db, wineId: string) {
  const { data, error } = await db.from("inventory_items").select("status, quantity").eq("wine_id", wineId).in("status", ["sealed", "open"]);
  if (error) throw error;
  return (data ?? []).reduce((n, r) => n + (r.status === "sealed" ? r.quantity : 1), 0);
}

/**
 * Sicherstellen, dass es eine aktuelle Flasche gibt (z. B. nach dem Einbuchen); gibt ihre ID zurück
 * (null = keine Spirituose bzw. keine Flasche). Eine vorhandene aktuelle bleibt unverändert.
 */
export async function ensureSpiritCurrent(db: Db, wineId: string, sizeMl?: number | null): Promise<string | null> {
  const { data, error } = await db.rpc("ensure_spirit_current", { p_wine_id: wineId, ...(sizeMl != null ? { p_bottle_size_ml: sizeMl } : {}) });
  if (!error) return (data as string | null) ?? null;
  if (!missingFunction(error)) throw error;
  // Ohne Migration: gleiche Regeln, Schritt für Schritt.
  const { data: wine, error: wineError } = await db.from("wines").select("type").eq("id", wineId).maybeSingle();
  if (wineError) throw wineError;
  if (wine?.type !== "spirit") return null;
  const current = (await currentBottles(db, wineId)).find((b) => sizeMl == null || b.sizeMl === sizeMl);
  if (current) return current.itemId;
  let q = db.from("inventory_items").select("id, bottle_size_ml").eq("wine_id", wineId).eq("status", "sealed").gt("quantity", 0);
  if (sizeMl != null) q = q.eq("bottle_size_ml", sizeMl);
  const { data: batches, error: batchError } = await q.order("purchased_at", { ascending: true, nullsFirst: true }).limit(1);
  if (batchError) throw batchError;
  if (!batches?.length) return null;
  const { data: openId, error: openError } = await db.rpc("open_bottle", { p_item_id: batches[0].id, p_fill_level_percent: 100, p_date_opened: todayIso() });
  if (openError) throw openError;
  return openId ?? null;
}

export type EmptyResult = { ok: true; name: string; remaining: number; nextId: string | null } | { ok: false; error: string };

/** Aktuelle Flasche leer: getrunken, die nächste volle wird aktuell (100 %). */
export async function emptySpiritBottle(db: Db, wineId: string, itemId?: string | null): Promise<EmptyResult> {
  const { data: wine, error: wineError } = await db.from("wines").select("name, type").eq("id", wineId).maybeSingle();
  if (wineError) throw wineError;
  if (!wine || wine.type !== "spirit") return { ok: false, error: "Das ist keine Spirituose – nichts geändert." };
  const id = itemId ?? (await ensureSpiritCurrent(db, wineId));
  if (!id) return { ok: false, error: "Von dieser Spirituose ist keine Flasche mehr im Bestand – nichts geändert." };

  const { data, error } = await db.rpc("spirit_bottle_empty", { p_item_id: id });
  if (!error) {
    const r = (data ?? {}) as { next_id?: string | null; remaining?: number };
    return { ok: true, name: wine.name, remaining: Number(r.remaining ?? 0), nextId: r.next_id ?? null };
  }
  if (error.code === "22023" || error.code === "P0002") return { ok: false, error: "Diese Flasche ist nicht mehr die aktuelle – nichts geändert." };
  if (!missingFunction(error)) throw error;
  // Ohne Migration: leer buchen, dann die nächste aktuell.
  const { data: size } = await db.from("inventory_items").select("bottle_size_ml").eq("id", id).maybeSingle();
  const { data: updated, error: updateError } = await db.from("inventory_items").update({ status: "drunk" }).eq("id", id).eq("status", "open").select("id");
  if (updateError) throw updateError;
  if (!updated?.length) return { ok: false, error: "Diese Flasche ist nicht mehr die aktuelle – nichts geändert." };
  await db.from("open_bottle_details").update({ fill_level_percent: 0 }).eq("inventory_item_id", id);
  const nextId = await ensureSpiritCurrent(db, wineId, size?.bottle_size_ml ?? null);
  return { ok: true, name: wine.name, remaining: await remainingBottles(db, wineId), nextId };
}

export type FillResult = { ok: true; fill: number; emptied?: EmptyResult & { ok: true } } | { ok: false; error: string };

/** Füllstand der aktuellen Flasche setzen (0 % = leer). */
export async function setSpiritFill(db: Db, wineId: string, percent: number, itemId?: string | null): Promise<FillResult> {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return { ok: false, error: "Füllstand bitte zwischen 0 und 100 %." };
  if (percent === 0) {
    const emptied = await emptySpiritBottle(db, wineId, itemId);
    return emptied.ok ? { ok: true, fill: 0, emptied } : emptied;
  }
  const id = itemId ?? (await ensureSpiritCurrent(db, wineId));
  if (!id) return { ok: false, error: "Von dieser Spirituose ist keine Flasche mehr im Bestand – nichts geändert." };
  const result = await applyEdit(db, { kind: "openBottle", itemId: id, fill: percent });
  // „Nichts zu ändern“ (gleicher Wert) gilt als erledigt.
  if (!result.ok && result.error !== NOTHING) return { ok: false, error: result.error };
  return { ok: true, fill: percent };
}
