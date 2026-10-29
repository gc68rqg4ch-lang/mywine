import "server-only";

// Preissuche – Abgleich „gleiches Produkt?“ mit einem einzigen Haiku-Aufruf (strukturierte
// Ausgabe) statt Wortregeln: je Google-Shopping-Kandidat yes / variant / no mit Grund sowie
// erkanntem Jahrgang. Danach im Code hart: Grösse (aus dem Titel, in ml) und Jahrgang müssen passen, sonst
// höchstens variant; bei Gattungsnamen muss der Produzent passen, sonst no. Die Preiswahl nimmt nur yes-Kandidaten (siehe pickBest).

import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anthropic, RECOGNITION_MODEL } from "@/lib/ingest/recognize";
import { withUsage } from "@/lib/ai/usage";
import type { ShoppingCandidate } from "./serpapi";
import { brandFromProducer, brandInName, genericName, sizeFromText } from "./price-match";

export const JUDGE_MODEL = RECOGNITION_MODEL;

export const JudgeSchema = z.object({
  candidates: z.array(
    z.object({
      index: z.number().describe("Nummer des Kandidaten wie in der Liste"),
      same_product: z.enum(["yes", "variant", "no"]),
      reason: z.string().describe("Ein kurzer Grund auf Deutsch, z. B. „gleiches Produkt“, „Riserva statt normal“, „andere Marke“"),
      vintage: z.number().describe("Jahrgang laut Titel; 0 = keiner genannt"),
    }),
  ),
});
export type Judged = z.infer<typeof JudgeSchema>["candidates"][number];

export type JudgeBottle = {
  name: string;
  producer: string | null;
  type: string | null;
  category?: string | null;
  year: number | null;
  sizeMl: number;
  alcohol?: number | null;
  age?: number | null;
  cask?: string | null;
};

export const JUDGE_SYSTEM = `Du prüfst für eine private Weinsammlung in der Schweiz, welche Angebote aus Google Shopping genau diese Flasche sind.
Je Kandidat same_product:
- yes: dasselbe Produkt. Werbewörter („Top-Angebot“, „Aktion“), Schreibweisen, Apostrophe, Gross-/Kleinschreibung, Reihenfolge von Marke und Name und zusätzliche Beschreibungen (Kategorie, Herkunft, Alkohol) sind egal. Fehlt die Firma (z. B. Destillerie) im Titel, ist das egal, solange Marke bzw. Name stimmen.
- variant: dasselbe Produkt in anderer Ausführung – Riserva/Reserva/Reservado statt normal (oder umgekehrt), anderes Alter bzw. andere Reifezeit, Cask Strength, Single Cask, XO/VSOP/VS, Sonderedition, anderer Jahrgang, Geschenkset/mit Gläsern, Mehrfachpackung.
- Die Flaschengrösse prüft der Code (je Kandidat schon in ml umgerechnet): bewerte sie nicht – auch nicht „50 cl“ gegen „500 ml“.
- no: anderer Produzent bzw. andere Marke oder anderes Produkt (auch gleiche Gattung wie „Amaretto“ einer anderen Marke), Zubehör, Gutscheine.
Bei Gattungsnamen (gattungsname: true – z. B. Pflaumenbrand, Amaretto, Grappa, Kirsch) muss der Produzent bzw. die Marke im Titel oder beim Händler stehen, sonst no.
Gib vintage so an, wie er im Titel steht (0 = nicht genannt). Bewerte jeden Kandidaten genau einmal, mit seiner Nummer.`;

/** Prompt mit Flasche und nummerierten Kandidaten (rein). */
export function judgePrompt(bottle: JudgeBottle, candidates: Pick<ShoppingCandidate, "title" | "source" | "price">[]) {
  const b = {
    name: bottle.name,
    produzent: bottle.producer,
    ...(genericName(bottle.name) ? { gattungsname: true } : {}),
    art: bottle.type === "spirit" ? "Spirituose" : bottle.type ? `Wein (${bottle.type})` : null,
    kategorie: bottle.category ?? null,
    jahrgang: bottle.year ?? "ohne Jahrgang",
    groesse_ml: bottle.sizeMl,
    alkohol: bottle.alcohol ?? null,
    alter_jahre: bottle.age ?? null,
    fass: bottle.cask ?? null,
  };
  const list = candidates
    .map((c, i) => {
      const ml = sizeFromText(c.title);
      return `${i}. ${c.title} – ${c.source} – CHF ${c.price.toFixed(2)}${ml ? ` – ${ml} ml` : ""}`;
    })
    .join("\n");
  return `Gesuchte Flasche: ${JSON.stringify(b)}\n\nKandidaten:\n${list}`;
}

export type Verdict = "yes" | "variant" | "no";
export type CandidateVerdict = { verdict: Verdict; reason: string; sizeMl: number | null; year: number | null };

/**
 * Harte Prüfung nach dem Urteil (rein): Grösse und Jahrgang müssen passen, sonst höchstens variant.
 * Grösse nicht genannt: Standardflasche angenommen. Jahrgang gesucht, aber nicht genannt: variant
 * (nicht belegt). Wein ohne Jahrgang, Angebot mit Jahrgang: variant.
 */
export function hardCheck(bottle: Pick<JudgeBottle, "year" | "sizeMl">, j: Pick<Judged, "same_product" | "reason" | "vintage"> & { size_ml: number }): CandidateVerdict {
  const sizeMl = j.size_ml > 0 ? Math.round(j.size_ml) : null;
  const year = j.vintage >= 1900 && j.vintage <= 2100 ? Math.round(j.vintage) : null;
  const base = { sizeMl, year };
  if (j.same_product === "no") return { verdict: "no", reason: j.reason, ...base };
  if (sizeMl != null && sizeMl !== bottle.sizeMl) return { verdict: "variant", reason: `andere Grösse (${Math.round(sizeMl / 10)} cl)`, ...base };
  if (bottle.year != null && year !== bottle.year) return { verdict: "variant", reason: year == null ? "Jahrgang nicht genannt" : `Jahrgang ${year}`, ...base };
  if (bottle.year == null && year != null) return { verdict: "variant", reason: `Jahrgang ${year}`, ...base };
  return { verdict: j.same_product, reason: j.reason, ...base };
}

/**
 * Produzent hart (rein): bei Gattungsnamen („Pflaumenbrand“, „Amaretto“) muss die Marke laut
 * Produzent im Titel oder im Händlernamen stehen, sonst no.
 */
export function producerCheck(bottle: Pick<JudgeBottle, "name" | "producer">, c: Pick<ShoppingCandidate, "title" | "source">, v: CandidateVerdict): CandidateVerdict {
  if (v.verdict === "no" || !genericName(bottle.name)) return v;
  const brand = brandFromProducer(bottle.producer);
  if (!brand || brandInName(brand, `${c.title} ${c.source}`)) return v;
  return { ...v, verdict: "no", reason: `anderer bzw. kein Produzent (nicht ${brand})` };
}

/** Haiku urteilt über alle Kandidaten in einem Aufruf; fehlende Urteile gelten als no. */
export async function judgeCandidates(bottle: JudgeBottle, candidates: ShoppingCandidate[]): Promise<CandidateVerdict[]> {
  if (!candidates.length) return [];
  const response = await withUsage({ purpose: "research_price" }, () =>
    anthropic().beta.messages.parse({
      model: JUDGE_MODEL,
      max_tokens: 4000,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: judgePrompt(bottle, candidates) }],
      output_config: { format: betaZodOutputFormat(JudgeSchema) },
    }),
  );
  const judged = response.parsed_output?.candidates ?? [];
  return candidates.map((_, i) => {
    const j = judged.find((x) => x.index === i);
    // Grösse allein aus dem Titel (im Code in ml umgerechnet), nicht aus dem Urteil.
    return j ? producerCheck(bottle, candidates[i], hardCheck(bottle, { ...j, size_ml: sizeFromText(candidates[i].title) ?? 0 })) : { verdict: "no", reason: "nicht bewertet", sizeMl: null, year: null };
  });
}
