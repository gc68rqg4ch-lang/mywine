import "server-only";

// Recherche einer Spirituose (nach dem Einbuchen bzw. 🔎 Nachrecherchieren): fehlende Angaben
// ergänzen – Alter, Fass/Finish, Destilliert, Abgefüllt, Alkohol, Region (und Hersteller/Land).
// Leeres wird gefüllt („is null“ schützt vor gleichzeitigen Änderungen); Abweichungen bei
// Hersteller, Land, Region und Alkohol werden Vorschläge, die übrigen bleiben, wie sie sind.
// Kategorie nur, wenn leer und eine bestehende passt – die Recherche legt nie Kategorien an.
// Quellen: zuerst Schweizer Händler, dann die Websuche; Preise nur von Schweizer Händlern.

import type { Database } from "@/lib/database.types";
import { webResearch } from "@/lib/ingest/recognize";
import { spiritCategoriesForAi } from "@/lib/spirits/load";
import { SPIRIT_FIELD_LABELS, spiritFindings, spiritResearchSchema, type SpiritFindings } from "@/lib/spirits/research";
import { toSpiritFields } from "@/lib/spirits/categories";
import type { Db } from "@/lib/taste/store";
import { sameValue, type SuggestionField } from "./compare";
import { recordSuggestion } from "./suggestions";
import { sourceNote } from "./compare";
import { COUNTRY_HINT } from "@/lib/format";

const SWISS_SHOPS = "finespirits.ch, moevenpick-wein.com (Spirituosen), ullrich.ch, smithandsmith.ch";

export type SpiritWine = { id: string; name: string; producer: string | null; country: string | null; region: string | null; alcohol_content: number | null };

/** Recherchieren und auswerten; filled: Bezeichnungen des Ergänzten, suggested: Anzahl Vorschläge. */
export async function researchAndFillSpirit(
  db: Db,
  wine: SpiritWine,
  extra: { pages?: { url: string; title: string; text: string }[]; pagesNote?: string } = {},
): Promise<{ filled: string[]; suggested: number }> {
  const [ai, { data: row, error }] = await Promise.all([
    // Kategorien aus der DB (5 Min. zwischengespeichert); nicht lesbar → feste Liste fürs Schema,
    // dann aber keine Zuordnung zu einer id.
    spiritCategoriesForAi(db),
    db.from("wines").select("*").eq("id", wine.id).maybeSingle(),
  ]);
  if (error) throw error;
  if (!row) return { filled: [], suggested: 0 };
  const current = { ...toSpiritFields(row as unknown as Record<string, unknown>), producer: row.producer, country: row.country, region: row.region, alcohol_content: row.alcohol_content };

  const raw = await webResearch({
    prompt: `Recherchiere diese Spirituose im Web und melde die Angaben, die die Quellen für genau diese Abfüllung belegen: ${JSON.stringify({ name: wine.name, hersteller: wine.producer, land: wine.country, region: wine.region })}.
- Zuerst Schweizer Händler (${SWISS_SHOPS}), dann Website des Herstellers bzw. der Destillerie, seriöse Händler oder Fachpresse. Preise nur von Schweizer Händlern beachten (keine anderen).
- Gesucht: Hersteller/Destillerie, Land (${COUNTRY_HINT}), Region, Alkohol (% vol), Altersangabe (Jahre), Fass/Reifung/Finish, Jahr der Destillation, Jahr der Abfüllung, passende Kategorie aus der Liste.
- Nur was die Quellen für genau diese Spirituose belegen; sonst leer bzw. 0. Keine Altersangabe erfinden (NAS = 0).
- Kategorie nur aus der Liste; passt keine eindeutig: „unbekannt“.${extra.pagesNote ?? ""}`,
    toolName: "report_spirit_details",
    pages: extra.pages,
    toolDescription: "Meldet die per Websuche gefundenen Angaben zur Spirituose samt Quellen-URLs.",
    schema: spiritResearchSchema(ai.categories),
    maxSearches: 5,
  });
  if (!raw) return { filled: [], suggested: 0 };
  const found = spiritFindings(raw, ai.fromDb ? ai.categories : []);
  if (!found) return { filled: [], suggested: 0 };
  return applySpiritFindings(db, wine.id, current, found, sourceNote(raw.sources));
}

const SUGGESTABLE: Partial<Record<keyof SpiritFindings, SuggestionField>> = {
  producer: "producer",
  country: "country",
  region: "region",
  alcohol_content: "alcohol_content",
};

const DB_FIELD: Record<keyof SpiritFindings, keyof Database["public"]["Tables"]["wines"]["Update"]> = {
  producer: "producer",
  country: "country",
  region: "region",
  alcohol_content: "alcohol_content",
  age_years: "age_years",
  cask: "cask",
  distilled_year: "distilled_year",
  bottled_year: "bottled_year",
  spirit_category_id: "spirit_category_id",
};

/** Gefundenes speichern: nur Leeres; Abweichungen (Hersteller, Land, Region, Alkohol) als Vorschlag. */
export async function applySpiritFindings(
  db: Db,
  wineId: string,
  current: { producer: string | null; country: string | null; region: string | null; alcohol_content: number | null; categoryId: string | null; ageYears: number | null; cask: string | null; distilledYear: number | null; bottledYear: number | null },
  found: SpiritFindings,
  note: string | null,
) {
  const now: Record<keyof SpiritFindings, unknown> = {
    producer: current.producer,
    country: current.country,
    region: current.region,
    alcohol_content: current.alcohol_content,
    age_years: current.ageYears,
    cask: current.cask,
    distilled_year: current.distilledYear,
    bottled_year: current.bottledYear,
    spirit_category_id: current.categoryId,
  };
  const filled: string[] = [];
  let suggested = 0;
  for (const key of Object.keys(SPIRIT_FIELD_LABELS) as (keyof SpiritFindings)[]) {
    const value = found[key];
    if (value === undefined) continue;
    const field = DB_FIELD[key];
    if (now[key] == null) {
      const { data: updated, error } = await db
        .from("wines")
        .update({ [field]: value } as Database["public"]["Tables"]["wines"]["Update"])
        .eq("id", wineId)
        .is(field, null)
        .select("id");
      if (error) throw error;
      if (updated?.length) filled.push(SPIRIT_FIELD_LABELS[key]);
      continue;
    }
    const suggestion = SUGGESTABLE[key];
    if (suggestion && !sameValue(suggestion, now[key], value)) {
      const r = await recordSuggestion(db, { wineId, year: null, field: suggestion, current: now[key], suggested: value, note });
      if (r !== "skipped") suggested++;
    }
  }
  return { filled, suggested };
}
