import "server-only";

// Geschmacksprofil per Web-Recherche – eigener Tool-Aufruf (die Stammdaten-Recherche hat schon
// 9 nullable Felder). Merkmale als enum mit „unbekannt“ statt nullable. Oberstes Ziel: kein
// falsches Profil – geprüft wird in validateTasteProfile (taste/profile.ts) vor dem Speichern.

import { documentsNote, type ResearchDocument } from "./documents";
import { shopDocuments, shopPagesNote, type ShopPage } from "./shops";
import { z } from "zod";
import { webResearch } from "@/lib/ingest/recognize";
import { satTypeForWine, type SatType } from "@/lib/tasting/sat";
import {
  CLEAR_TERMS,
  SOURCE_KINDS,
  TASTE_FIELDS,
  TASTE_KEYS,
  UNKNOWN,
  aromaGroups,
  tasteOptions,
  sourceRef,
  validateTasteProfile,
  type TasteKey,
  type TasteProfileData,
  type TasteResearchRaw,
} from "@/lib/taste/profile";
import { loadExactTasteProfile, saveTasteProfile, type Db } from "@/lib/taste/store";
import { recordSuggestion } from "./suggestions";
import { sourceNote } from "./compare";

const enumOf = (values: string[]) => z.enum(values as [string, ...string[]]);

/** Strict-Tool-Schema (ohne Unions, ohne min/max); Aromen nur aus dem Lexikon des Weintyps. */
export function tasteResearchSchema(type: SatType) {
  const lexicon = aromaGroups(type);
  const aromas = [...new Set([...lexicon.values()].flat())];
  const fields = Object.fromEntries(
    TASTE_FIELDS.map((f) => [f.key, enumOf([UNKNOWN, ...tasteOptions(f.key)]).describe(`${f.label}; „${UNKNOWN}“ ohne eindeutigen Beleg`)]),
  ) as Record<TasteKey, z.ZodEnum>;
  return z.object({
    matches_wine: z.boolean().describe("true nur, wenn die Quellen genau diesen Wein (Name + Produzent) beschreiben"),
    same_vintage: z.boolean().describe("true, wenn die Belege für genau den angefragten Jahrgang gelten (Wein ohne Jahrgang: true)"),
    sources: z
      .array(
        z.object({
          url: z.string(),
          title: z.string(),
          kind: z.enum(SOURCE_KINDS),
          vintage: z.number().describe("Jahrgang, den die Quelle beschreibt (ganze Zahl); 0 = unbekannt/allgemein"),
        }),
      )
      .describe("Nur Quellen zu genau diesem Wein; leer, wenn keine gefunden"),
    fields: z.object(fields),
    aromas: z
      .array(
        z.object({
          group: enumOf([...lexicon.keys()]),
          aroma: enumOf(aromas),
          source_url: z.string(),
          quote: z.string().describe("Wörtliches Zitat aus der Quelle, höchstens 25 Wörter"),
        }),
      )
      .describe("Nur Aromen mit eindeutiger Entsprechung im Lexikon, je mit Beleg"),
    evidence: z
      .array(
        z.object({
          field: enumOf([...TASTE_KEYS, "style_summary", "food_pairing"]),
          source_url: z.string(),
          quote: z.string().describe("Wörtliches Zitat aus der Quelle, höchstens 25 Wörter"),
        }),
      )
      .describe("Je gemeldetem Merkmal mindestens ein Beleg"),
    contradictions: z
      .array(z.object({ field: enumOf([...TASTE_KEYS]), note: z.string() }))
      .describe("Merkmale, bei denen sich Quellen klar widersprechen"),
    style_summary: z.string().describe("1–2 Sätze auf Deutsch, nur aus den Quellen; leer ohne Beleg"),
    food_pairing: z.array(z.string()).describe("Speiseempfehlungen der Quellen auf Deutsch; leer ohne Beleg"),
  });
}

export type TasteWine = { name: string; producer: string | null; type: string | null; region?: string | null; country?: string | null };

/** Recherche + Prüfung. null = keine verlässlichen Angaben (keine passende Quelle, nichts belegt). */
export async function researchTasteProfile(
  wine: TasteWine,
  year: number | null,
  /** Angehängte Datenblätter genau dieses Jahrgangs (zusätzlich zur Websuche). */
  documents: ResearchDocument[] = [],
  /** Händlerseiten genau dieses Jahrgangs (zusätzlich zur Websuche). */
  pages: ShopPage[] = [],
): Promise<TasteProfileData | null> {
  if (!wine.name) return null;
  const type = satTypeForWine(wine.type);
  const lexicon = aromaGroups(type);
  const raw = await webResearch({
    prompt: `Suche Verkostungsnotizen zu genau diesem Wein: ${JSON.stringify({ name: wine.name, producer: wine.producer, jahrgang: year ?? "ohne Jahrgang", region: wine.region ?? null, land: wine.country ?? null })}.
Oberstes Ziel: kein falsches Profil. Lieber „${UNKNOWN}“ als geraten.
- Nur Quellen zu genau diesem Wein (Name + Produzent): Produzent (Tech Sheet), Kritiker, Händler. Keine allgemeinen Beschreibungen der Rebsorte, Region oder anderer Weine des Produzenten.
- ${year != null ? `Nur Notizen zu genau Jahrgang ${year}. Notizen zu anderen Jahrgängen zählen nicht – gibt es keine zu ${year}: same_vintage false, sources leer.` : "Der Wein hat keinen Jahrgang (NV): Notizen zum Wein selbst; same_vintage true."} Trage bei jeder Quelle den beschriebenen Jahrgang ein (0 = ohne Jahrgang). Findest du nichts Passendes: matches_wine false, sources leer.
- Jedes Merkmal und jedes Aroma braucht ein wörtliches Zitat (≤ 25 Wörter) mit source_url aus sources. Ohne Beleg: „${UNKNOWN}“ bzw. weglassen.
- Übersetze klare Beschreibungen in die WSET-Begriffe, wenn das Zitat eindeutig ist: ${CLEAR_TERMS.map((t) => `„${t.example}“ → ${TASTE_FIELDS.find((f) => f.key === t.key)!.label} ${t.value}`).join(", ")}. Unklar → „${UNKNOWN}“. Nie das nächstbeste Aroma wählen.
- Aromen nur aus diesem Lexikon (Gruppe → Aromen): ${JSON.stringify(Object.fromEntries(lexicon))}
- Widersprechen sich Quellen klar bei einem Merkmal: Merkmal „${UNKNOWN}“ und Eintrag in contradictions.
- style_summary: ein, höchstens zwei kurze Sätze auf Deutsch; food_pairing: kurze Begriffe. Beide nur aus den Quellen, je mit Beleg (field style_summary bzw. food_pairing).${documentsNote(documents)}${shopPagesNote(pages)}`,
    toolName: "report_taste_profile",
    documents,
    pages: shopDocuments(pages),
    toolDescription: "Meldet das belegte Geschmacksprofil des Weins mit Quellen und Zitaten.",
    schema: tasteResearchSchema(type),
    maxSearches: 5,
  });
  if (!raw) return null;
  return validateTasteProfile(raw as TasteResearchRaw, { type, year, wineType: wine.type, documents: documents.map((d) => ({ name: d.name, year: d.year })) });
}

/**
 * Gefundenes Profil speichern: gilt sofort (keine Freigabe). Überschreibt nur Profile aus der
 * Recherche; ist das bestehende von Hand (manual), entsteht ein Vorschlag. Ohne Fund bleibt
 * alles, wie es ist (diese Funktion wird dann gar nicht aufgerufen).
 */
export async function saveResearchedProfile(db: Db, wineId: string, profile: TasteProfileData): Promise<"saved" | "suggested" | "unchanged"> {
  const saved = await saveTasteProfile(db, { wineId, profile, source: "research", onlyResearch: true });
  if (saved !== "manual") return saved;
  const current = await loadExactTasteProfile(db, wineId, profile.vintageYear);
  try {
    const r = await recordSuggestion(db, {
      wineId,
      year: profile.vintageYear,
      field: "taste_profile",
      current,
      suggested: profile,
      note: sourceNote(profile.sources.map(sourceRef)),
    });
    return r === "skipped" ? "unchanged" : "suggested";
  } catch (error) {
    // Ohne Migration research_suggestions_taste_profile lehnt die DB das Feld ab (23514).
    if ((error as { code?: string } | null)?.code === "23514") return "unchanged";
    throw error;
  }
}
