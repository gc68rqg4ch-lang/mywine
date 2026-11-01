import "server-only";

// Stammdaten und Geschmacksprofil in EINEM Recherche-Aufruf (Sonnet + Websuche), wenn beides
// fällig ist: dieselben Quellen (Datenblatt, Verkostungsnotiz des Jahrgangs) liefern meist beides,
// die Suchergebnisse werden nur einmal gelesen statt in zwei getrennten Suchschleifen. Antwort über
// ein gemeinsames Tool mit zwei Teilen (wine, taste); geprüft wie bei den einzelnen Aufrufen.

import { z } from "zod";
import {
  EnrichmentSchema,
  readWineResearch,
  webResearch,
  wineResearchNotes,
  wineResearchRules,
  type WineResearch,
  type WineResearchInput,
} from "@/lib/ingest/recognize";
import type { TasteProfileData } from "@/lib/taste/profile";
import { readTasteResearch, tasteResearchRequest, type TasteWine } from "./taste";
import type { ResearchDocument } from "./documents";
import type { ShopPage } from "./shops";

/** Höchstens so viele Websuchen – wie ein einzelner Aufruf heute, nicht die Summe beider. */
export const WINE_TASTE_SEARCHES = 6;
/** Ausgabe je Runde: Stammdaten (~1000) plus Profil mit Zitaten (~2500), Reserve fürs Denken. */
export const WINE_TASTE_MAX_TOKENS = 9000;

/** Gemeinsames Schema: Stammdaten (wine) und Profil (taste) als zwei Teile – Unions wie bei den einzelnen. */
export function wineTasteSchema(taste: z.ZodType) {
  return z.object({
    wine: EnrichmentSchema.describe("Teil 1: Stammdaten und je angefragtem Jahrgang Trinkfenster und Rebsorten"),
    taste: taste.describe("Teil 2: belegtes Geschmacksprofil des Profiljahrgangs (mit Quellen und Zitaten)"),
  });
}

export type WineTasteInput = {
  wine: WineResearchInput;
  taste: { wine: TasteWine; year: number | null; documents: ResearchDocument[]; pages: ShopPage[] };
};

/** Prompt des gemeinsamen Aufrufs (rein): gezielte Suche zuerst, dann die Regeln beider Teile. */
export function wineTastePrompt(input: WineTasteInput, tasteRules: string, notes: string) {
  const year = input.taste.year;
  return `Du recherchierst in EINER Websuche für zwei Berichte zu genau diesem Wein und meldest beide zusammen.
Suche zuerst gezielt das technische Datenblatt (Tech Sheet, Fiche technique) bzw. die Verkostungsnotiz${year != null ? ` des Jahrgangs ${year}` : ""} beim Produzenten, dann seriöse Händler, Kritiker und Fachpresse – solche Seiten belegen meist Stammdaten und Geschmack zugleich. Keine Suche doppelt.

Teil 1 (Feld wine) – Stammdaten und Jahrgänge:
${wineResearchRules(input.wine)}

Teil 2 (Feld taste) – Geschmacksprofil:
${tasteRules}
Die Regeln jedes Teils gelten nur für diesen Teil; Quellen und Zitate von Teil 2 in taste.sources bzw. taste.evidence.${notes}`;
}

/**
 * Ein Aufruf für beides. wine/profile null = nichts Verlässliches im jeweiligen Teil; das
 * Ganze null = gar keine Antwort (der Aufrufer macht dann keinen Ersatz-Aufruf).
 */
export async function researchWineAndTaste(input: WineTasteInput): Promise<{ wine: WineResearch | null; profile: TasteProfileData | null } | null> {
  if (!input.wine.wine.name) return null;
  const t = tasteResearchRequest(input.taste.wine, input.taste.year, input.taste.documents, input.taste.pages);
  // Beilagen beider Teile, ohne Doppelte (gleiches Datenblatt bzw. gleiche Händlerseite).
  const documents = uniqueBy([...(input.wine.documents ?? []), ...t.documents], (d) => d.name);
  const pages = uniqueBy([...(input.wine.pages ?? []), ...t.pages], (p) => p.url);
  const raw = await webResearch({
    prompt: wineTastePrompt(input, t.rules, `${wineResearchNotes(input.wine)}${t.notes}`),
    toolName: "report_wine_and_taste",
    documents,
    pages,
    fetchShops: Boolean(input.wine.fetchShops || t.fetchShops),
    toolDescription: "Meldet Stammdaten und Jahrgänge (wine) sowie das belegte Geschmacksprofil (taste) des Weins, je mit Quellen.",
    schema: wineTasteSchema(t.schema),
    // Jeden Teil für sich prüfen: ein ungültiger Teil verwirft nicht den anderen.
    parseSchema: z.object({ wine: z.unknown(), taste: z.unknown() }),
    maxSearches: WINE_TASTE_SEARCHES,
    maxTokens: WINE_TASTE_MAX_TOKENS,
  });
  if (!raw) return null;
  const wine = EnrichmentSchema.safeParse(raw.wine);
  const taste = t.schema.safeParse(raw.taste);
  return {
    wine: wine.success ? readWineResearch(wine.data, input.wine) : null,
    profile: taste.success ? readTasteResearch(taste.data, { wine: input.taste.wine, year: input.taste.year, documents: input.taste.documents }) : null,
  };
}

function uniqueBy<T>(list: T[], key: (x: T) => string) {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}
