import "server-only";

// Einen Wein vollständig recherchieren: alle leeren Angaben in einem Durchgang (Stammdaten,
// Alkohol, Trinkfenster je Jahrgang, Rebsorten mit %). Vorhandenes wird nie überschrieben;
// Rebsorten mit source = research. Für „Nachrecherchieren“ auf der Weinseite und den Sammellauf.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatShares, hasAnyPercent } from "@/lib/grapes/shares";
import { replaceGrapeShares } from "@/lib/grapes/store";
import { researchWineWeb } from "@/lib/ingest/recognize";
import type { EnrichableField } from "@/lib/ingest/schema";
import { needsResearch, wineGaps, type GapItem, type GapShare, type GapVintage, type GapWine, type ResearchScope, type WineGaps } from "./gaps";

type Db = SupabaseClient<Database>;

const WINE_COLUMNS = "id, name, producer, country, region, appellation, type, alcohol_content, grapes" as const;

/** Alles, was die Lückenberechnung braucht – für einen Wein oder den ganzen Keller. */
export async function loadGapData(db: Db, wineId?: string) {
  const one = <Q extends { eq: (c: "wine_id", v: string) => Q }>(q: Q) => (wineId ? q.eq("wine_id", wineId) : q);
  const [wines, items, vintages, shares] = await Promise.all([
    wineId ? db.from("wines").select(WINE_COLUMNS).eq("id", wineId) : db.from("wines").select(WINE_COLUMNS),
    one(db.from("inventory_items").select("wine_id, vintage_year, status")),
    one(db.from("wine_vintages").select("wine_id, vintage_year, drink_from_year, drink_until_year")),
    one(db.from("wine_grape_shares").select("wine_id, vintage_year, grape, percent, source")),
  ]);
  for (const r of [wines, items, vintages, shares]) if (r.error) throw r.error;
  return {
    wines: (wines.data ?? []) as GapWine[],
    items: (items.data ?? []) as GapItem[],
    vintages: (vintages.data ?? []) as GapVintage[],
    shares: (shares.data ?? []) as GapShare[],
  };
}

export type ResearchOutcome = {
  status: "filled" | "nothing" | "complete" | "error";
  /** Was ergänzt wurde, z. B. „Region“, „Trinkfenster 2019“, „Rebsorten 2019 mit %“. */
  filled: string[];
  seconds: number;
};

const FIELD_LABELS: Record<EnrichableField, string> = {
  producer: "Produzent",
  country: "Land",
  region: "Region",
  appellation: "Appellation",
  type: "Typ",
  alcohol_content: "Alkohol",
};

const yearLabel = (year: number | null) => (year == null ? "NV" : String(year));

/** Recherchiert einen Wein und ergänzt die Lücken (Jahrgänge im gewählten Umfang). */
export async function researchAndFillWine(db: Db, wineId: string, scope: ResearchScope): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const data = await loadGapData(db, wineId);
  const wine = data.wines[0];
  // Ein einzelner Wein ohne Flaschen im Keller: alle Jahrgänge mit Flaschen nehmen.
  const gaps: WineGaps | null = wine ? (wineGaps(wine, data, scope) ?? wineGaps(wine, data, "all")) : null;
  if (!wine || !gaps || !needsResearch(gaps)) return { status: "complete", filled: [], seconds: seconds() };

  const missing = (["country", "region", "appellation", "type", "alcohol_content"] as const).filter((f) => wine[f] == null);
  const found = await researchWineWeb({
    wine: {
      name: wine.name,
      producer: wine.producer,
      country: wine.country,
      region: wine.region,
      appellation: wine.appellation,
      type: wine.type as Database["public"]["Enums"]["wine_type"] | null,
      alcohol_content: wine.alcohol_content,
    },
    missing,
    vintages: gaps.vintages.map((v) => ({ year: v.year, window: v.window, grapes: v.grapes, knownGrapes: v.knownGrapes })),
  });
  if (!found) return { status: "nothing", filled: [], seconds: seconds() };

  const filled: string[] = [];

  // Stammdaten: nur leere Felder (die Bedingung „is null“ schützt vor gleichzeitigen Änderungen).
  for (const field of missing) {
    const value = found.fields[field];
    if (value == null) continue;
    const { data: updated, error } = await db
      .from("wines")
      .update({ [field]: value } as Database["public"]["Tables"]["wines"]["Update"])
      .eq("id", wineId)
      .is(field, null)
      .select("id");
    if (error) throw error;
    if (updated?.length) filled.push(FIELD_LABELS[field]);
  }

  for (const v of found.vintages) {
    const gap = gaps.vintages.find((g) => g.year === v.year);
    if (!gap) continue;

    // Trinkfenster: leere Teile ergänzen, vorhandene behalten.
    if (gap.window && (v.drink.from != null || v.drink.until != null)) {
      let q = db.from("wine_vintages").select("id, drink_from_year, drink_until_year").eq("wine_id", wineId);
      q = v.year == null ? q.is("vintage_year", null) : q.eq("vintage_year", v.year);
      const { data: row, error } = await q.maybeSingle();
      if (error) throw error;
      const from = row?.drink_from_year ?? v.drink.from;
      const until = row?.drink_until_year ?? v.drink.until;
      const changed = from !== (row?.drink_from_year ?? null) || until !== (row?.drink_until_year ?? null);
      if (changed && (from == null || until == null || from <= until)) {
        const { error: saveError } = row
          ? await db.from("wine_vintages").update({ drink_from_year: from, drink_until_year: until }).eq("id", row.id)
          : await db.from("wine_vintages").insert({ wine_id: wineId, vintage_year: v.year, drink_from_year: from, drink_until_year: until });
        if (saveError) throw saveError;
        filled.push(`Trinkfenster ${yearLabel(v.year)} (${from ?? "?"}–${until ?? "?"})`);
      }
    }

    // Rebsorten: mit % ersetzen die Angaben ohne % dieses Jahrgangs; ohne % nur, wenn es gar keine gibt.
    if (gap.grapes && v.grapes.length && (hasAnyPercent(v.grapes) || gap.grapesMissing)) {
      const result = await replaceGrapeShares(db, {
        wineId,
        vintageYear: v.year,
        shares: v.grapes,
        source: "research",
        keepManual: true,
      });
      if (result === "saved") {
        filled.push(`Rebsorten ${yearLabel(v.year)}${hasAnyPercent(v.grapes) ? " mit %" : ""}: ${formatShares(v.grapes)}`);
      }
    }
  }

  return { status: filled.length ? "filled" : "nothing", filled, seconds: seconds() };
}
