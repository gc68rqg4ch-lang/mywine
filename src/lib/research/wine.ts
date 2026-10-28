import "server-only";

// Einen Wein vollständig recherchieren: alle leeren Angaben in einem Durchgang (Stammdaten,
// Alkohol, Trinkfenster je Jahrgang, Rebsorten mit %). Vorhandenes wird nie überschrieben;
// Rebsorten mit source = research. Danach in einem eigenen Aufruf das Geschmacksprofil.
// Für „Nachrecherchieren“ auf der Weinseite, den Sammellauf und den Bot. Auch Weine ohne
// Flaschen (nur verkostet) werden recherchiert – Jahrgänge dann aus „Verkostet“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asWineType } from "@/lib/format";
import { formatShares, hasAnyPercent } from "@/lib/grapes/shares";
import { replaceGrapeShares } from "@/lib/grapes/store";
import { researchWineWeb } from "@/lib/ingest/recognize";
import { recordSuggestion } from "./suggestions";
import { researchTasteProfile, saveResearchedProfile } from "./taste";
import type { EnrichableField } from "@/lib/ingest/schema";
import { grapesOnlyAddPercent, sameGrapes, sameValue, sourceNote, type SuggestionField } from "./compare";
import { TASTED, wineGaps, type GapItem, type GapShare, type GapVintage, type GapWine, type ResearchScope, type WineGaps } from "./gaps";

type Db = SupabaseClient<Database>;

const WINE_COLUMNS = "id, name, producer, country, region, appellation, type, alcohol_content, grapes, researched_at" as const;

/** Alles, was die Lückenberechnung braucht – für einen Wein oder alle Weine. */
export async function loadGapData(db: Db, wineId?: string) {
  const one = <Q extends { eq: (c: "wine_id", v: string) => Q }>(q: Q) => (wineId ? q.eq("wine_id", wineId) : q);
  const [wines, items, encounters, vintages, shares, profiles] = await Promise.all([
    wineId ? db.from("wines").select(WINE_COLUMNS).eq("id", wineId) : db.from("wines").select(WINE_COLUMNS),
    one(db.from("inventory_items").select("wine_id, vintage_year, status")),
    one(db.from("wine_encounters").select("wine_id, vintage_year")),
    one(db.from("wine_vintages").select("wine_id, vintage_year, drink_from_year, drink_until_year")),
    one(db.from("wine_grape_shares").select("wine_id, vintage_year, grape, percent, source")),
    one(db.from("wine_taste_profiles").select("wine_id")),
  ]);
  for (const r of [wines, items, encounters, vintages, shares, profiles]) if (r.error) throw r.error;
  return {
    wines: (wines.data ?? []) as GapWine[],
    // Verkostete Jahrgänge zählen wie Flaschen (nur im Umfang „alle“).
    items: [
      ...((items.data ?? []) as GapItem[]),
      ...(encounters.data ?? []).map((e) => ({ wine_id: e.wine_id, vintage_year: e.vintage_year, status: TASTED })),
    ],
    vintages: (vintages.data ?? []) as GapVintage[],
    shares: (shares.data ?? []) as GapShare[],
    withProfile: new Set((profiles.data ?? []).map((p) => p.wine_id)),
  };
}

export type ResearchOutcome = {
  status: "filled" | "nothing" | "complete" | "error";
  /** Was ergänzt wurde, z. B. „Region“, „Trinkfenster 2019“, „Rebsorten 2019 mit %“. */
  filled: string[];
  /** Neue bzw. aktualisierte Vorschläge (Abweichungen) – nichts überschrieben. */
  suggested: number;
  /**
   * Geschmacksprofil: saved = gespeichert (gilt sofort), suggested = Vorschlag (Profil von Hand),
   * none = keine verlässlichen Angaben (Bestehendes bleibt), unchanged = Vorschlag schon offen
   * bzw. abgelehnt, skipped = nicht gesucht (schon vorhanden).
   */
  taste?: "saved" | "suggested" | "none" | "unchanged" | "skipped";
  /** Bei status „error“: was schiefging (Nutzungslimit → Lauf sofort stoppen). */
  error?: { kind: "usage_limit" | "api" | "other"; message: string };
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
 * Geschmacksprofil: always = immer suchen (Weinseite, Bot), missing = nur ohne Profil
 * (Sammellauf), only = nur das Profil (Option „Geschmacksprofil fehlt“, Knopf in der Karte).
 */
export type TasteMode = "always" | "missing" | "only";

/** Jahrgang fürs Profil: angegeben, sonst der einzige bekannte Jahrgang, sonst allgemein (null). */
function tasteYear(gaps: WineGaps, year: number | null | undefined) {
  if (year !== undefined) return year;
  const years = [...new Set(gaps.vintages.map((v) => v.year))];
  return years.length === 1 ? years[0] : null;
}

/**
 * Recherchiert einen Wein (immer alle Angaben) und wertet aus: Leeres wird direkt gefüllt,
 * Abweichungen werden zu Vorschlägen (research_suggestions) – nie überschrieben.
 * Jahrgänge: die mit Flaschen im gewählten Umfang (sonst alle mit Flaschen oder verkostet;
 * ohne beides nur die Stammdaten).
 */
export async function researchAndFillWine(
  db: Db,
  wineId: string,
  scope: ResearchScope,
  options: { taste?: TasteMode; year?: number | null } = {},
): Promise<ResearchOutcome> {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const data = await loadGapData(db, wineId);
  const wine = data.wines[0];
  if (!wine) return { status: "complete", filled: [], suggested: 0, seconds: seconds() };
  // Früher: ohne Flaschen → gar keine Recherche. Jetzt: Verkostet-Jahrgänge bzw. nur Stammdaten.
  const gaps: WineGaps = wineGaps(wine, data, scope) ?? wineGaps(wine, data, "all") ?? { wine, gaps: [], basics: true, vintages: [] };
  const tasteMode = options.taste ?? "always";

  const filled: string[] = [];
  let suggested = 0;
  const taste = async (): Promise<ResearchOutcome["taste"]> => {
    if (tasteMode === "missing" && data.withProfile.has(wineId)) return "skipped";
    const profile = await researchTasteProfile(wine, tasteYear(gaps, options.year));
    if (!profile) return "none";
    const saved = await saveResearchedProfile(db, wineId, profile);
    if (saved === "saved") filled.push("Geschmacksprofil");
    if (saved === "suggested") suggested++;
    return saved;
  };

  if (tasteMode === "only") {
    const result = await taste();
    await markResearched(db, wineId);
    return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, taste: result, seconds: seconds() };
  }

  const found = await researchWineWeb({
    wine: {
      name: wine.name,
      producer: wine.producer,
      country: wine.country,
      region: wine.region,
      appellation: wine.appellation,
      type: asWineType(wine.type),
      alcohol_content: wine.alcohol_content,
    },
    vintages: gaps.vintages.map((v) => ({ year: v.year, knownGrapes: v.knownGrapes })),
  });
  if (!found) {
    const result = await taste();
    await markResearched(db, wineId);
    return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, taste: result, seconds: seconds() };
  }

  const note = sourceNote(found.sources);
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

  // Eigener Aufruf fürs Profil. Scheitert er, bleibt das Ergänzte gespeichert und wird gemeldet.
  let tasteResult: ResearchOutcome["taste"];
  try {
    tasteResult = await taste();
  } catch (error) {
    if (!filled.length && !suggested) throw error;
    console.error("taste research failed", wineId, error);
  }
  await markResearched(db, wineId);
  return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, taste: tasteResult, seconds: seconds() };
}

/** Nach jeder erfolgreichen Recherche – auch ohne Fund – für „kürzlich geprüfte überspringen“. */
async function markResearched(db: Db, wineId: string) {
  const { error } = await db.from("wines").update({ researched_at: new Date().toISOString() }).eq("id", wineId);
  if (error) throw error;
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
