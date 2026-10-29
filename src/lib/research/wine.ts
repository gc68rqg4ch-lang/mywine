import "server-only";

// Einen Wein vollständig recherchieren: alle leeren Angaben in einem Durchgang (Stammdaten,
// Alkohol, Trinkfenster je Jahrgang, Rebsorten mit %). Vorhandenes wird nie überschrieben;
// Rebsorten mit source = research. Danach in einem eigenen Aufruf das Geschmacksprofil.
// Für „Nachrecherchieren“ auf der Weinseite, den Sammellauf und den Bot. Auch Weine ohne
// Flaschen (nur verkostet) werden recherchiert – Jahrgänge dann aus „Verkostet“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asWineType } from "@/lib/format";
import { asDrinkSource, saveVintageWindow } from "@/lib/cellar/drink-window";
import { apiProblem } from "@/lib/ai/api-errors";
import { formatShares, hasAnyPercent } from "@/lib/grapes/shares";
import { replaceGrapeShares } from "@/lib/grapes/store";
import { researchWineWeb } from "@/lib/ingest/recognize";
import { recordSuggestion } from "./suggestions";
import { researchTasteProfile, saveResearchedProfile } from "./taste";
import { markTasteChecked } from "@/lib/taste/store";
import type { EnrichableField } from "@/lib/ingest/schema";
import { grapesOnlyAddPercent, sameGrapes, sameValue, sourceNote, type SuggestionField } from "./compare";
import { loadResearchDocuments, documentsNote, type ResearchDocument } from "./documents";
import { researchAndFillSpirit } from "./spirit";
import { findAndStoreOpenKeep, openKeepFilled } from "./open-keep";
import { loadShopPages, shopDocuments, shopFetchNote, shopPagesNote, type ShopPage } from "./shops";
import { TASTED, profileKey, type DocumentRow, tasteTargets, wineGaps, type GapItem, type GapShare, type GapVintage, type GapWine, type ResearchScope, type WineGaps } from "./gaps";

type Db = SupabaseClient<Database>;

const WINE_COLUMNS = "id, name, producer, country, region, appellation, type, alcohol_content, grapes, researched_at" as const;

/** Alles, was die Lückenberechnung braucht – für einen Wein oder alle Weine. */
export async function loadGapData(db: Db, wineId?: string) {
  const one = <Q extends { eq: (c: "wine_id", v: string) => Q }>(q: Q) => (wineId ? q.eq("wine_id", wineId) : q);
  const [wines, items, encounters, vintages, shares, profiles, documents] = await Promise.all([
    wineId ? db.from("wines").select(WINE_COLUMNS).eq("id", wineId) : db.from("wines").select(WINE_COLUMNS),
    one(db.from("inventory_items").select("wine_id, vintage_year, status")),
    one(db.from("wine_encounters").select("wine_id, vintage_year")),
    one(db.from("wine_vintages").select("wine_id, vintage_year, drink_from_year, drink_until_year, taste_profile_checked_at")),
    one(db.from("wine_grape_shares").select("wine_id, vintage_year, grape, percent, source")),
    one(db.from("wine_taste_profiles").select("wine_id, vintage_year")),
    one(db.from("wine_media").select("wine_id, vintage_year, created_at").eq("kind", "document")),
  ]);
  for (const r of [wines, items, encounters, vintages, shares, profiles, documents]) if (r.error) throw r.error;
  return {
    wines: (wines.data ?? []) as GapWine[],
    // Verkostete Jahrgänge zählen wie Flaschen (nur im Umfang „alle“).
    items: [
      ...((items.data ?? []) as GapItem[]),
      ...(encounters.data ?? []).map((e) => ({ wine_id: e.wine_id, vintage_year: e.vintage_year, status: TASTED })),
    ],
    vintages: (vintages.data ?? []) as GapVintage[],
    shares: (shares.data ?? []) as GapShare[],
    /** Vorhandene Profile je Wein und Jahrgang (profileKey). */
    profiles: new Set((profiles.data ?? []).map((p) => profileKey(p.wine_id, p.vintage_year))),
    /** Angehängte PDFs (ohne Inhalt) – ein neues PDF hebt die 12-Monats-Regel fürs Profil auf. */
    documents: (documents.data ?? []) as DocumentRow[],
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
   * bzw. abgelehnt, skipped = nicht gesucht (Profil schon da oder in den letzten 12 Monaten gesucht).
   */
  taste?: "saved" | "suggested" | "none" | "unchanged" | "skipped";
  /** Jahrgang, für den das Profil gesucht wurde (null = Wein ohne Jahrgang). */
  tasteYear?: number | null;
  /** Bei status „error“: was schiefging (Nutzungslimit → Lauf sofort stoppen). */
  error?: { kind: "usage_limit" | "temporary" | "api" | "other"; message: string };
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

/**
 * Jahrgang fürs Profil (nur jahrgangsgenaue Profile): angegeben, sonst der neueste bekannte
 * Jahrgang; null nur für Weine ohne Jahrgang (NV) bzw. ganz ohne Jahrgänge.
 */
function tasteYear(gaps: WineGaps, year: number | null | undefined) {
  if (year !== undefined) return year;
  const years = gaps.vintages.map((v) => v.year).filter((y): y is number => y != null);
  return years.length ? Math.max(...years) : null;
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
  options: {
    taste?: TasteMode;
    year?: number | null;
    /**
     * Profil (missing/only): Jahrgänge überspringen, die in den letzten 12 Monaten gesucht wurden
     * (Standard). „always“ (Nachrecherchieren) sucht immer.
     */
    skipRecent?: boolean;
  } = {},
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
  // Welcher Jahrgang? Nachrecherchieren: der gewählte (bzw. neueste). Sammellauf: der neueste
  // ohne Profil, der nicht in den letzten 12 Monaten gesucht wurde – sonst nichts.
  const targets = tasteTargets(gaps, data, { skipRecent: options.skipRecent ?? true });
  const profileYear =
    tasteMode === "always" || options.year !== undefined ? tasteYear(gaps, options.year) : (targets[0] ?? tasteYear(gaps, undefined));
  const runTaste = tasteMode === "always" || targets.includes(profileYear);
  // Angehängte PDFs nur für die gesuchten Jahrgänge laden (Profil bzw. Recherche).
  const docYears = [...new Set([...(tasteMode === "only" ? [] : gaps.vintages.map((v) => v.year)), ...(runTaste ? [profileYear] : [])])];
  // Händler-Shops (zuerst der Händler der Flasche): dieselben Jahrgänge, Profiljahrgang zuerst.
  const shopYears = [...new Set([...(runTaste ? [profileYear] : []), ...docYears])];
  const [documents, pages]: [ResearchDocument[], ShopPage[]] = await Promise.all([
    loadResearchDocuments(db, { id: wine.id, name: wine.name }, docYears),
    loadShopPages(db, wine, shopYears),
  ]);
  const taste = async (): Promise<ResearchOutcome["taste"]> => {
    if (!runTaste) return "skipped";
    const profile = await researchTasteProfile(
      wine,
      profileYear,
      documents.filter((d) => d.year === profileYear),
      pages.filter((p) => p.year === profileYear),
    );
    // Jede Profilsuche vermerken – auch ohne Fund (nicht bei einem Fehler).
    await markTasteChecked(db, wineId, profileYear);
    if (!profile) return "none";
    const saved = await saveResearchedProfile(db, wineId, profile);
    if (saved === "saved") filled.push("Geschmacksprofil");
    if (saved === "suggested") suggested++;
    return saved;
  };

  if (tasteMode === "only") {
    // Nur das Profil: wines.researched_at (Stammdaten) bleibt, massgebend ist taste_profile_checked_at.
    const result = await taste();
    return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, taste: result, tasteYear: profileYear, seconds: seconds() };
  }

  // Spirituose: eigene Recherche (Alter, Fass, Destilliert, Abgefüllt, Alkohol, Region, Kategorie
  // aus den bestehenden) – ohne Trinkfenster und Rebsorten.
  if (wine.type === "spirit") {
    const spirit = await researchAndFillSpirit(db, wine, researchPages(pages, gaps.vintages.map((v) => v.year), wine));
    filled.push(...spirit.filled);
    suggested += spirit.suggested;
  }
  // Likörwein bzw. Likör: Haltbarkeit offen (fehlt bzw. nur geschätzt → Quelle suchen; von Hand bleibt).
  if (wine.type === "fortified" || wine.type === "spirit") {
    const keep = await findAndStoreOpenKeep(db, wineId, { onlyIfEmpty: false });
    if (keep.result === "set" && keep.keep) filled.push(openKeepFilled(keep.keep));
  }
  const found = wine.type === "spirit" ? null : await researchWineWeb({
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
    ...researchDocs(documents, gaps.vintages.map((v) => v.year)),
    ...researchPages(pages, gaps.vintages.map((v) => v.year), wine),
  });
  if (!found) {
    const result = await taste();
    await markResearched(db, wineId);
    return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, taste: result, tasteYear: profileYear, seconds: seconds() };
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
        .select("*")
        .eq("wine_id", wineId)
        .eq("vintage_year", v.year)
        .maybeSingle();
      if (error) throw error;
      const source = asDrinkSource(row?.drink_window_source) ?? (row?.drink_from_year != null || row?.drink_until_year != null ? "manual" : null);
      let from = row?.drink_from_year ?? null;
      let until = row?.drink_until_year ?? null;
      if (source === "estimate") {
        // Schätzung: eine Quelle ersetzt sie (Rangfolge in cellar/drink-window.ts).
        from = v.drink.from ?? from;
        until = v.drink.until ?? until;
      } else if (source !== "label") {
        if (from == null && v.drink.from != null) from = v.drink.from;
        else if (from != null && v.drink.from != null && from !== v.drink.from) await suggest("drink_from_year", v.year, from, v.drink.from);
        if (until == null && v.drink.until != null) until = v.drink.until;
        else if (until != null && v.drink.until != null && until !== v.drink.until) await suggest("drink_until_year", v.year, until, v.drink.until);
      }
      const changed = from !== (row?.drink_from_year ?? null) || until !== (row?.drink_until_year ?? null);
      if (changed && (from == null || until == null || from <= until)) {
        // Vorher leer bzw. geschätzt → „research“; teils von Hand → bleibt „manual“.
        const nextSource = source == null || source === "estimate" ? "research" : source;
        await saveVintageWindow(db, { rowId: row?.id ?? null, wineId, year: v.year }, { drink_from_year: from, drink_until_year: until }, nextSource, nextSource === "research" ? note : (row?.drink_window_note ?? null));
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
  let tasteError: ResearchOutcome["error"];
  try {
    tasteResult = await taste();
  } catch (error) {
    if (!filled.length && !suggested) throw error;
    console.error("taste research failed", wineId, error);
    // API-Limit beim Profil: Ergänztes bleibt, aber der Sammellauf muss sofort anhalten.
    const problem = apiProblem(error);
    if (problem?.kind === "usage_limit") {
      tasteError = problem;
      console.error("api limit reached", wineId);
    }
  }
  // Stammdaten wurden recherchiert (researched_at); das Profil gilt nur nach einer Suche als geprüft.
  await markResearched(db, wineId);
  return {
    status: filled.length || suggested ? "filled" : "nothing",
    filled,
    suggested,
    taste: tasteResult,
    tasteYear: profileYear,
    ...(tasteError ? { error: tasteError } : {}),
    seconds: seconds(),
  };
}

/** PDFs für die Jahrgänge der Recherche (zusätzlich zur Websuche). */
function researchDocs(documents: ResearchDocument[], years: (number | null)[]) {
  const docs = documents.filter((d) => years.includes(d.year));
  return docs.length ? { documents: docs, documentsNote: documentsNote(docs) } : {};
}

/** Händlerseiten für die Jahrgänge der Recherche (zusätzlich zur Websuche). */
function researchPages(pages: ShopPage[], years: (number | null)[], wine: { name: string; producer: string | null }) {
  const list = pages.filter((p) => years.includes(p.year));
  if (list.length) return { pages: shopDocuments(list), pagesNote: shopPagesNote(list) };
  // Shops ohne Treffer: Datenblatt per web_fetch – nur bei genau einem Jahrgang (eindeutige Prüfung).
  const year = years.length === 1 ? years[0] : null;
  return year != null ? { fetchShops: true, fetchNote: shopFetchNote(wine, year) } : {};
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
