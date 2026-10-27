import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isGrapeSource, type GrapeShare, type GrapeSource } from "./shares";

type Db = SupabaseClient<Database>;

export type StoredGrapeShares = {
  shares: GrapeShare[];
  /** Jahrgang der angezeigten Zeilen; null = gilt für alle Jahrgänge. */
  vintageYear: number | null;
  sources: GrapeSource[];
};

/**
 * Rebsorten eines Weins für einen Jahrgang: jahrgangsspezifische Zeilen, sonst die
 * allgemeinen (vintage_year null). null, wenn es keine gibt.
 */
export async function loadGrapeShares(
  db: Db,
  wineId: string,
  vintageYear: number | null,
): Promise<StoredGrapeShares | null> {
  const { data, error } = await db
    .from("wine_grape_shares")
    .select("*")
    .eq("wine_id", wineId)
    .order("sort_order")
    .order("grape");
  if (error) throw error;

  const rows = data ?? [];
  const specific = vintageYear != null ? rows.filter((r) => r.vintage_year === vintageYear) : [];
  const chosen = specific.length ? specific : rows.filter((r) => r.vintage_year == null);
  if (chosen.length === 0) return null;

  return {
    shares: chosen.map((r) => ({ grape: r.grape, percent: r.percent })),
    vintageYear: specific.length ? vintageYear : null,
    sources: [...new Set(chosen.map((r) => r.source).filter(isGrapeSource))],
  };
}

/** true, wenn für Wein + Jahrgang manuell gepflegte Rebsorten existieren. */
async function hasManualShares(db: Db, wineId: string, vintageYear: number | null) {
  let query = db
    .from("wine_grape_shares")
    .select("id", { count: "exact", head: true })
    .eq("wine_id", wineId)
    .eq("source", "manual");
  query = vintageYear == null ? query.is("vintage_year", null) : query.eq("vintage_year", vintageYear);
  const { count, error } = await query;
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Ersetzt die Rebsorten eines Weins für genau einen Jahrgang (null = alle Jahrgänge)
 * atomar über public.replace_grape_shares. Mit keepManual bleiben manuell gepflegte
 * Angaben unangetastet.
 */
export async function replaceGrapeShares(
  db: Db,
  input: {
    wineId: string;
    vintageYear: number | null;
    shares: GrapeShare[];
    source: GrapeSource;
    keepManual: boolean;
  },
): Promise<"saved" | "kept_manual"> {
  if (input.keepManual && (await hasManualShares(db, input.wineId, input.vintageYear))) {
    return "kept_manual";
  }

  const { error } = await db.rpc("replace_grape_shares", {
    p_wine_id: input.wineId,
    // Die Funktion akzeptiert null (= alle Jahrgänge); der generierte Typ kennt
    // die Nullbarkeit von Funktionsargumenten nicht.
    p_vintage_year: input.vintageYear as number,
    p_shares: input.shares.map((share, index) => ({
      grape: share.grape,
      percent: share.percent,
      sort_order: index,
      source: input.source,
    })),
  });
  if (error) throw error;
  return "saved";
}

/**
 * Rebsorten-Namen je Wein wie in cellar_wine_summary: aus wine_grape_shares (alle Jahrgänge),
 * sonst aus wines.grapes.
 */
export async function loadGrapeNames(db: Db, wines: { id: string; grapes: string[] | null }[]) {
  const ids = [...new Set(wines.map((w) => w.id))];
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const { data, error } = await db.from("wine_grape_shares").select("wine_id, grape").in("wine_id", ids);
  if (error) throw error;
  for (const row of data ?? []) {
    const list = result.get(row.wine_id) ?? [];
    if (!list.includes(row.grape)) list.push(row.grape);
    result.set(row.wine_id, list);
  }
  for (const w of wines) if (!result.has(w.id) && w.grapes?.length) result.set(w.id, [...w.grapes]);
  for (const list of result.values()) list.sort((a, b) => a.localeCompare(b, "de-CH"));
  return result;
}
