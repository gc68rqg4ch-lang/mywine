import "server-only";

import { z } from "zod";
import { GrapeShareSchema } from "@/lib/ingest/schema";
import { cleanSources, webResearch } from "@/lib/ingest/recognize";
import { normalizeGrapeShares, type GrapeShare } from "./shares";

export const GrapeResearchSchema = z.object({
  grapes: z.array(GrapeShareSchema).describe("Rebsorten des Weins, wichtigste zuerst"),
  percentages_for_vintage: z
    .boolean()
    .describe(
      "true, wenn die Prozente ausdrücklich für den gefragten Jahrgang belegt sind oder der Wein reinsortig ist",
    ),
  sources: z.array(z.string()).describe("URLs der verwendeten Quellen"),
});

export type WineForResearch = {
  name: string;
  producer: string;
  vintage_year: number | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
};

export type GrapeResearchResult = { shares: GrapeShare[]; sources: string[] };

/**
 * Recherchiert die Rebsorten mit Prozentanteil für den konkreten Jahrgang.
 * Prozente, die nicht für diesen Jahrgang belegt sind, werden verworfen – dann
 * bleiben nur die Rebsorten. null, wenn nichts gefunden wurde.
 */
export async function researchGrapeShares(
  wine: WineForResearch,
  knownGrapes: string[] = [],
): Promise<GrapeResearchResult | null> {
  const vintage = wine.vintage_year ? `Jahrgang ${wine.vintage_year}` : "ohne Jahrgang (NV)";
  const origin = [wine.appellation, wine.region, wine.country].filter(Boolean).join(", ");

  const found = await webResearch({
    prompt: `Recherchiere die Rebsortenzusammensetzung dieses Weins:
Produzent: ${wine.producer}
Wein: ${wine.name}
${vintage}${origin ? `\nHerkunft: ${origin}` : ""}${knownGrapes.length ? `\nBisher bekannte Rebsorten: ${knownGrapes.join(", ")}` : ""}

Gesucht sind die Rebsorten mit Prozentanteil für genau diesen Jahrgang (Cuvées ändern sich von Jahr zu Jahr).
Nutze bevorzugt das technische Datenblatt (Fiche technique, Tech Sheet) des Produzenten, sonst seriöse Händler oder Fachpresse.
- percent nur angeben, wenn eine Quelle den Anteil für diesen Jahrgang belegt; Angaben zu anderen Jahrgängen zählen nicht (dann null).
- Reinsortige Weine: die Rebsorte mit 100.
- Wenn nur die Rebsorten bekannt sind: Rebsorten mit percent null.
- Wenn nichts zu finden ist: leere Liste.
Rebsortennamen in der international üblichen Schreibweise (z. B. Cabernet Sauvignon, Tempranillo, Touriga Nacional).`,
    toolName: "report_grape_shares",
    toolDescription: "Meldet die recherchierten Rebsorten mit Prozentanteilen samt Quellen-URLs.",
    schema: GrapeResearchSchema,
    maxSearches: 5,
  });
  if (!found || found.grapes.length === 0) return null;

  let shares = normalizeGrapeShares(found.grapes);
  const singleVarietal = shares.length === 1 && shares[0].percent === 100;
  if (!found.percentages_for_vintage && !singleVarietal) {
    shares = shares.map((s) => ({ ...s, percent: null }));
  }
  if (shares.length === 0) return null;
  return { shares, sources: cleanSources(found.sources) };
}

