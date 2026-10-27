import "server-only";

// Einen Wein vollständig recherchieren: alle leeren Angaben in einem Durchgang (Stammdaten,
// Alkohol, Trinkfenster je Jahrgang, Rebsorten mit %). Vorhandenes wird nie überschrieben;
// Rebsorten mit source = research. Für „Nachrecherchieren“ auf der Weinseite und den Sammellauf.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatShares, hasAnyPercent } from "@/lib/grapes/shares";
import { replaceGrapeShares } from "@/lib/grapes/store";
import { researchWineWeb } from "@/lib/ingest/recognize";
import { recordSuggestion } from "./suggestions";
import type { EnrichableField } from "@/lib/ingest/schema";
import { grapesOnlyAddPercent, sameGrapes, sameValue, sourceNote, type SuggestionField } from "./compare";
import { wineGaps, type GapItem, type GapShare, type GapVintage, type GapWine, type ResearchScope, type WineGaps } from "./gaps";

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
  /** Neue bzw. aktualisierte Vorschläge (Abweichungen) – nichts überschrieben. */
  suggested: number;
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
const WINE_FIELDS = ["producer", "country", "region", "appellation", "type", "alcohol_content"] as const;

const yearLabel = (year: number | null) => (year == null ? "NV" : String(year));

/**
 * Recherchiert einen Wein (immer alle Angaben) und wertet aus: Leeres wird direkt gefüllt,
 * Abweichungen werden zu Vorschlägen (research_suggestions) – nie überschrieben.
 * Jahrgänge: die mit Flaschen im gewählten Umfang (sonst alle mit Flaschen).
 */
export async function researchAndFillWine(db: Db, wineId: string, scope: ResearchScope): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const data = await loadGapData(db, wineId);
  const wine = data.wines[0];
  const gaps: WineGaps | null = wine ? (wineGaps(wine, data, scope) ?? wineGaps(wine, data, "all")) : null;
  if (!wine || !gaps) return { status: "complete", filled: [], suggested: 0, seconds: seconds() };

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
    vintages: gaps.vintages.map((v) => ({ year: v.year, knownGrapes: v.knownGrapes })),
  });
  if (!found) return { status: "nothing", filled: [], suggested: 0, seconds: seconds() };

  const note = sourceNote(found.sources);
  const filled: string[] = [];
  let suggested = 0;
  const suggest = async (field: SuggestionField, year: number | null, current: unknown, value: unknown) => {
    const r = await recordSuggestion(db, { wineId, year, field, current, suggested: value, note });
    if (r !== "skipped") suggested++;
  };

  // Stammdaten: Leeres füllen („is null“ schützt vor gleichzeitigen Änderungen), Abweichendes vorschlagen.
  for (const field of WINE_FIELDS) {
    const value = found.fields[field];
    if (value == null) continue;
    const current = wine[field];
    if (current == null) {
      const { data: updated, error } = await db
        .from("wines")
        .update({ [field]: value } as Database["public"]["Tables"]["wines"]["Update"])
        .eq("id", wineId)
        .is(field, null)
        .select("id");
      if (error) throw error;
      if (updated?.length) filled.push(FIELD_LABELS[field]);
    } else if (!sameValue(field, current, value)) {
      await suggest(field, null, current, value);
    }
  }

  for (const v of found.vintages) {
    const gap = gaps.vintages.find((g) => g.year === v.year);
    if (!gap) continue;

    // Trinkfenster: leere Teile ergänzen, abweichende vorschlagen.
    if (v.year != null && (v.drink.from != null || v.drink.until != null)) {
      const { data: row, error } = await db
        .from("wine_vintages")
        .select("id, drink_from_year, drink_until_year")
        .eq("wine_id", wineId)
        .eq("vintage_year", v.year)
        .maybeSingle();
      if (error) throw error;
      let from = row?.drink_from_year ?? null;
      let until = row?.drink_until_year ?? null;
      if (from == null && v.drink.from != null) from = v.drink.from;
      else if (from != null && v.drink.from != null && from !== v.drink.from) await suggest("drink_from_year", v.year, from, v.drink.from);
      if (until == null && v.drink.until != null) until = v.drink.until;
      else if (until != null && v.drink.until != null && until !== v.drink.until) await suggest("drink_until_year", v.year, until, v.drink.until);
      const changed = from !== (row?.drink_from_year ?? null) || until !== (row?.drink_until_year ?? null);
      if (changed && (from == null || until == null || from <= until)) {
        const { error: saveError } = row
          ? await db.from("wine_vintages").update({ drink_from_year: from, drink_until_year: until }).eq("id", row.id)
          : await db.from("wine_vintages").insert({ wine_id: wineId, vintage_year: v.year, drink_from_year: from, drink_until_year: until });
        if (saveError) throw saveError;
        filled.push(`Trinkfenster ${yearLabel(v.year)} (${from ?? "?"}–${until ?? "?"})`);
      }
    }

    // Rebsorten: keine → direkt; ohne % und gleiche Sorten → % direkt ergänzen; sonst Abweichung → Vorschlag.
    if (v.grapes.length) {
      const stored = effectiveGrapes(data, wine, v.year);
      const direct = (stored.shares.length === 0 || grapesOnlyAddPercent(stored.shares, v.grapes)) && !stored.manual;
      if (direct) {
        const result = await replaceGrapeShares(db, { wineId, vintageYear: v.year, shares: v.grapes, source: "research", keepManual: true });
        if (result === "saved") {
          filled.push(`Rebsorten ${yearLabel(v.year)}${hasAnyPercent(v.grapes) ? " mit %" : ""}: ${formatShares(v.grapes)}`);
        }
      } else if (!sameGrapes(stored.shares, v.grapes)) {
        await suggest("grapes", v.year, stored.shares, v.grapes);
      }
    }
  }

  return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, seconds: seconds() };
}

/** Gespeicherte Rebsorten eines Jahrgangs: eigene, sonst die für alle Jahrgänge, sonst wines.grapes. */
function effectiveGrapes(data: { shares: GapShare[] }, wine: GapWine, year: number | null) {
  const specific = year == null ? [] : data.shares.filter((s) => s.wine_id === wine.id && s.vintage_year === year);
  const general = data.shares.filter((s) => s.wine_id === wine.id && s.vintage_year == null);
  const rows = specific.length ? specific : general;
  if (rows.length) {
    return { shares: rows.map((r) => ({ grape: r.grape, percent: r.percent })), manual: rows.some((r) => r.source === "manual") };
  }
  return { shares: wine.grapes.map((grape) => ({ grape, percent: null })), manual: false };
}
