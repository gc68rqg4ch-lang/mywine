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
import { UNKNOWN, type TasteProfileData } from "@/lib/taste/profile";
import { readTasteResearch, tasteResearchRequest, type TasteWine } from "./taste";
import type { ResearchDocument } from "./documents";
import type { ShopPage } from "./shops";

/**
 * Höchstens so viele Websuchen: eine verlässliche Quelle genügt (meist schon die erste Suche);
 * die Grenze greift nur, wenn nichts Verlässliches zu finden ist.
 */
export const WINE_TASTE_SEARCHES = 3;
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

/** Kernwerte des Profils, nach denen weitergesucht wird (Tannin nur bei Rotwein). */
export const coreTasteKeys = (wineType: string | null) => ["sweetness", "acidity", ...(wineType === "red" ? ["tannin"] : []), "body"] as const;

/**
 * Prompt des gemeinsamen Aufrufs (rein): Reihenfolge der Quellen, wann weitersuchen und wann
 * aufhören, dann die Regeln beider Teile.
 */
export function wineTastePrompt(input: WineTasteInput, tasteRules: string, notes: string) {
  const year = input.taste.year;
  const core = input.taste.wine.type === "red" ? "Säure, Tannin, Körper, Süsse" : "Säure, Körper, Süsse";
  return `Du recherchierst für zwei Berichte zu genau diesem Wein und meldest beide zusammen (bis zu ${WINE_TASTE_SEARCHES} Websuchen).
Beginne mit dem technischen Datenblatt (Tech Sheet, Fiche technique) bzw. der Verkostungsnotiz${year != null ? ` des Jahrgangs ${year}` : ""} beim Produzenten.
Verlässliche Quellen: Produzent bzw. Datenblatt, offizieller Importeur bzw. Vertreiber, seriöse Fachhändler, Kritiker bzw. Fachpresse. Nicht verlässlich: persönliche Einschätzungen (Blogs, Videos, Foren, Bewertungsportale mit Nutzernotizen).
Wann aufhören: sobald beide Teile (Stammdaten und Geschmacksprofil) mit mindestens einer verlässlichen Quelle belegt sind – eine verlässliche Quelle genügt.
Wann weitersuchen: nur, solange für einen Teil noch keine verlässliche Quelle gefunden ist – dann mit einem anderen Ansatz bzw. einer anderen Art von Quelle; keine Abfrage wiederholen.
Werte, die die verlässliche Quelle nicht nennt (z. B. einzelne Kernwerte wie ${core}), bleiben „unbekannt“ – dafür nicht weitersuchen und nichts erfinden; die Belegregeln (Quellen, Zitate) gelten unverändert.

Teil 1 (Feld wine) – Stammdaten und Jahrgänge:
${wineResearchRules(input.wine)}

Teil 2 (Feld taste) – Geschmacksprofil:
${tasteRules}
Die Regeln jedes Teils gelten nur für diesen Teil; Quellen und Zitate von Teil 2 in taste.sources bzw. taste.evidence.${notes}`;
}

/** Diagnose des gemeinsamen Aufrufs (in research_jobs.result.diagnostics.wine_taste). */
export type WineTasteDiagnostics = {
  /** Ausgeführte Websuchen (alle Runden) */
  web_searches: number;
  /** Anfragen an die API (Runden der pause_turn-Schleife inkl. Nachfrage bei ungültigem Teil) */
  requests: number;
  /** Quellen des gespeicherten Profils (0 = kein Profil) */
  profile_sources: number;
  /** Kernwerte (Süsse, Säure, Tannin bei Rotwein, Körper) „unbekannt“ bzw. ohne Profil alle */
  unknown_core: number;
  confidence: string | null;
  /** Gab es eine Antwort mit dem Tool? */
  answered: boolean;
};

/** Diagnose aus Suchen und geprüftem Profil (rein). */
export function wineTasteDiagnostics(searches: number, profile: TasteProfileData | null, wineType: string | null, answered: boolean, requests = 1): WineTasteDiagnostics {
  const core = coreTasteKeys(wineType);
  const values = (profile?.values ?? {}) as Record<string, string | undefined>;
  return {
    web_searches: searches,
    requests,
    profile_sources: profile?.sources.length ?? 0,
    unknown_core: profile ? core.filter((k) => !values[k] || values[k] === UNKNOWN).length : core.length,
    confidence: profile?.confidence ?? null,
    answered,
  };
}

/**
 * Ein Aufruf für beides. wine/profile null = nichts Verlässliches im jeweiligen Teil bzw. gar
 * keine Antwort (der Aufrufer macht dann keinen Ersatz-Aufruf); dazu die Diagnose.
 */
export async function researchWineAndTaste(
  input: WineTasteInput,
): Promise<{ wine: WineResearch | null; profile: TasteProfileData | null; diagnostics: WineTasteDiagnostics } | null> {
  if (!input.wine.wine.name) return null;
  let searches = 0;
  let requests = 0;
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
    // Ohne strict: als strict-Tool ist das gemeinsame Schema für die API zu gross („compiled grammar
    // is too large“, 400). Stattdessen jeden Teil per Zod prüfen; ist einer ungültig, einmal
    // nachfragen – danach bleibt der gültige Teil erhalten, ein ungültiger verwirft den anderen nie.
    strict: false,
    parseSchema: z.object({ wine: z.unknown(), taste: z.unknown() }),
    repair: (found) => partProblems(found, t.schema),
    maxSearches: WINE_TASTE_SEARCHES,
    maxTokens: WINE_TASTE_MAX_TOKENS,
    onContent: (blocks) => {
      requests++;
      searches += blocks.filter((b) => b.type === "server_tool_use" && b.name === "web_search").length;
    },
  });
  const wineType = input.taste.wine.type;
  if (!raw) return { wine: null, profile: null, diagnostics: wineTasteDiagnostics(searches, null, wineType, false, requests) };
  const wine = EnrichmentSchema.safeParse(raw.wine);
  const taste = t.schema.safeParse(raw.taste);
  const profile = taste.success ? readTasteResearch(taste.data, { wine: input.taste.wine, year: input.taste.year, documents: input.taste.documents }) : null;
  return {
    wine: wine.success ? readWineResearch(wine.data, input.wine) : null,
    profile,
    diagnostics: wineTasteDiagnostics(searches, profile, wineType, true, requests),
  };
}

/**
 * Ungültige Teile der Antwort (für die eine Nachfrage); null = in Ordnung. Ein Profil ohne
 * passende Quelle (matches_wine false) braucht keine Nachfrage – es gibt ohnehin keins.
 */
export function partProblems(found: { wine: unknown; taste: unknown }, tasteSchema: z.ZodType): string | null {
  const noProfile = (found.taste as { matches_wine?: unknown } | null)?.matches_wine === false;
  const problems = [
    ["wine", EnrichmentSchema.safeParse(found.wine)],
    ...(noProfile ? [] : [["taste", tasteSchema.safeParse(found.taste)] as const]),
  ] as const;
  const bad = problems.filter(([, r]) => !r.success).map(([part, r]) => `Teil ${part}: ${r.error!.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(ganz)"} ${i.message}`).join("; ")}`);
  return bad.length ? bad.join(" | ") : null;
}

function uniqueBy<T>(list: T[], key: (x: T) => string) {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}
