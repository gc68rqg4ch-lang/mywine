import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { researchGrapeShares, type WineForResearch } from "./research";
import { hasAnyPercent, isGrapeSource, type GrapeShare, type GrapeSource } from "./shares";

type Db = SupabaseClient<Database>;
type ShareRow = Tables<"wine_grape_shares">;

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

async function scopeRows(db: Db, wineId: string, vintageYear: number | null) {
  let query = db.from("wine_grape_shares").select("*").eq("wine_id", wineId);
  query = vintageYear == null ? query.is("vintage_year", null) : query.eq("vintage_year", vintageYear);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Ersetzt die Rebsorten eines Weins für genau einen Jahrgang (null = alle Jahrgänge).
 * Mit keepManual bleiben manuell gepflegte Angaben unangetastet.
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
  const existing = await scopeRows(db, input.wineId, input.vintageYear);
  if (input.keepManual && existing.some((r) => r.source === "manual")) return "kept_manual";

  if (existing.length) {
    const { error } = await db
      .from("wine_grape_shares")
      .delete()
      .in(
        "id",
        existing.map((r) => r.id),
      );
    if (error) throw error;
  }

  if (input.shares.length === 0) return "saved";

  const { error } = await db.from("wine_grape_shares").insert(
    input.shares.map((share, index) => ({
      wine_id: input.wineId,
      vintage_year: input.vintageYear,
      grape: share.grape,
      percent: share.percent,
      sort_order: index,
      source: input.source,
    })),
  );
  if (error) {
    await restoreRows(db, existing);
    throw error;
  }
  return "saved";
}

/** Bestmöglich die vorherigen Zeilen wiederherstellen, falls das Einfügen scheitert. */
async function restoreRows(db: Db, rows: ShareRow[]) {
  if (rows.length === 0) return;
  await db.from("wine_grape_shares").insert(
    rows.map(({ wine_id, vintage_year, grape, percent, sort_order, source }) => ({
      wine_id,
      vintage_year,
      grape,
      percent,
      sort_order,
      source,
    })),
  );
}

export type ResearchOutcome = {
  status: "with_percent" | "without_percent" | "nothing_found" | "kept_manual";
  shares: GrapeShare[];
};

/**
 * Nachrecherchieren für einen Wein + Jahrgang und das Ergebnis speichern
 * (source = research). Findet die Recherche nichts, bleibt alles wie es ist.
 */
export async function researchAndStore(
  db: Db,
  wine: WineForResearch & { id: string },
  options: { keepManual: boolean },
): Promise<ResearchOutcome> {
  const current = await loadGrapeShares(db, wine.id, wine.vintage_year);
  if (options.keepManual && current?.vintageYear === wine.vintage_year && current.sources.includes("manual")) {
    return { status: "kept_manual", shares: current.shares };
  }

  const result = await researchGrapeShares(wine, current?.shares.map((s) => s.grape) ?? []);
  if (!result) return { status: "nothing_found", shares: current?.shares ?? [] };

  const saved = await replaceGrapeShares(db, {
    wineId: wine.id,
    vintageYear: wine.vintage_year,
    shares: result.shares,
    source: "research",
    keepManual: options.keepManual,
  });
  if (saved === "kept_manual") return { status: "kept_manual", shares: current?.shares ?? [] };

  return {
    status: hasAnyPercent(result.shares) ? "with_percent" : "without_percent",
    shares: result.shares,
  };
}
