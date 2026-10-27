import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { usageLimit } from "@/lib/ai/api-errors";
import { strictSchemaProblems } from "@/lib/ai/schema-limits";
import { hasCompletePercents, normalizeGrapeShares, type GrapeShare } from "@/lib/grapes/shares";
import {
  GrapeShareSchema,
  RecognitionSchema,
  TextEntrySchema,
  WineProposalSchema,
  missingEnrichableFields,
  normalizeProposal,
  type EnrichableField,
  type Recognition,
  type TextEntry,
  type WineProposal,
} from "./schema";

export const RECOGNITION_MODEL = "claude-haiku-5-5";
export const FALLBACK_MODEL = "claude-sonnet-5-5";
export const MIN_CONFIDENCE = 0.7;

// Sonnet 5.5 kann bei Sicherheitsklassifikatoren ablehnen; die serverseitige
// Fallback-Kette springt dann automatisch auf ein passendes Modell.
export const SONNET_FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;
export function anthropic() {
  client ??= new Anthropic(); // liest ANTHROPIC_API_KEY
  return client;
}

export type LabelImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export class RecognitionError extends Error {}

const RECOGNITION_SYSTEM = `Du liest Weinetiketten für eine private Weinsammlung in der Schweiz.
Du bekommst Fotos der Vorder- und meist auch der Rückseite derselben Flasche.
Lies nur ab, was auf dem Etikett steht oder sich daraus eindeutig ergibt (z. B. Land aus "Product of Spain").
Erfinde nichts: Was nicht lesbar oder nicht angegeben ist, ist null bzw. eine leere Liste.
- name: der Weinname ohne Produzent und ohne Jahrgang (z. B. "Reserva", "Les Pagodes de Cos"). Hat der Wein keinen eigenen Namen, nimm die Rebsorte oder Appellation, wie sie auf dem Etikett hervorgehoben ist.
- country: auf Deutsch (Spanien, Frankreich, Italien, Portugal, Schweiz, USA, …).
- type: red (Rotwein), white (Weisswein), rose, sparkling (Schaumwein/Champagner/Cava), sweet (Süsswein), fortified (Port, Sherry, Madeira), orange.
- bottle_size_ml: aus der Füllmenge (75 cl = 750, 37,5 cl = 375, 1,5 l = 1500).
- grape_shares: Rebsorten, die auf dem Etikett stehen; percent nur, wenn der Anteil aufgedruckt ist (z. B. "85 % Tempranillo"), sonst null. Bei reinsortigen Weinen ("100 % Merlot" oder Sortenbezeichnung wie "Pinot Noir") ist percent 100.
- vintage_certain: true nur, wenn der Jahrgang klar auf dem Etikett steht. Fehlt er oder ist er unleserlich, ist vintage_year null bzw. vintage_certain false – rate keinen Jahrgang.
- image_sides: für jedes Foto in Reihenfolge, ob es das Vorderetikett (front), das Rückenetikett (back) oder etwas anderes (other) zeigt.
- confidence: wie sicher Name, Produzent und Jahrgang stimmen (1.0 = klar lesbar, unter 0.7 = geraten oder unleserlich).`;

function imageBlocks(images: LabelImage[]): Anthropic.Beta.BetaContentBlockParam[] {
  // „Foto n“ vor jedem Bild, damit image_sides der Reihenfolge eindeutig folgt.
  return images.flatMap((img, i): Anthropic.Beta.BetaContentBlockParam[] => [
    { type: "text", text: `Foto ${i + 1}:` },
    { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
  ]);
}

async function recognizeWith(model: string, images: LabelImage[]): Promise<Recognition> {
  const response = await anthropic().beta.messages.parse({
    model,
    max_tokens: 16000,
    system: RECOGNITION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks(images),
          { type: "text", text: "Erfasse diesen Wein." },
        ],
      },
    ],
    output_config: { format: betaZodOutputFormat(RecognitionSchema) },
    ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
  });

  if (response.stop_reason === "refusal") {
    throw new RecognitionError(`${model} hat die Anfrage abgelehnt.`);
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new RecognitionError(`${model} hat kein gültiges Ergebnis geliefert.`);
  }
  return response.parsed_output;
}

export type RecognitionResult = {
  proposal: WineProposal;
  model: string;
  confidence: number;
  notes: string | null;
  imageSides: Recognition["image_sides"] | null;
  /** Jahrgang eindeutig gelesen; sonst fragt der Bot nach. */
  vintageCertain: boolean;
};

/** Etikett erkennen: zuerst Haiku, bei Konfidenz < 0.7 nochmals mit Sonnet. */
export async function recognizeLabel(images: LabelImage[]): Promise<RecognitionResult> {
  let model = RECOGNITION_MODEL;
  let result = await recognizeWith(model, images);

  if (result.confidence < MIN_CONFIDENCE) {
    model = FALLBACK_MODEL;
    result = await recognizeWith(model, images);
  }

  const { confidence, uncertain_notes, image_sides, vintage_certain, ...proposal } = result;
  return {
    proposal: normalizeProposal(proposal),
    model,
    confidence: Math.min(1, Math.max(0, confidence)),
    notes: uncertain_notes?.trim() || null,
    imageSides: image_sides.length === images.length ? image_sides : null,
    vintageCertain: vintage_certain && proposal.vintage_year != null,
  };
}

/** JSON-Schema für ein striktes Tool aus einem Zod-Schema (ohne "$schema"-Schlüssel). */
export function toolInputSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Anthropic.Beta.BetaTool.InputSchema;
  delete json.$schema;
  return json;
}

/**
 * Web-Recherche mit Sonnet 5.5 + web_search. Claude meldet das Ergebnis über ein
 * striktes Tool, damit es schemakonform ist. null, wenn kein Ergebnis kam.
 */
export async function webResearch<T>(options: {
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxSearches: number;
}): Promise<T | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${options.prompt}\nRufe am Ende genau einmal ${options.toolName} auf.`,
    },
  ];
  const inputSchema = toolInputSchema(options.schema);
  const problems = strictSchemaProblems(inputSchema);
  if (problems.length) throw new Error(`Schema für ${options.toolName} nicht strict-tauglich: ${problems.join(", ")}`);
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: options.maxSearches },
    {
      name: options.toolName,
      description: options.toolDescription,
      strict: true,
      input_schema: inputSchema,
    },
  ];

  for (let round = 0; round < 4; round++) {
    const response = await anthropic().beta.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: 16000,
      tools,
      tool_choice: { type: "auto" },
      messages,
      ...SONNET_FALLBACK,
    });

    if (response.stop_reason === "refusal") return null;

    const report = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === options.toolName,
    );
    if (report) {
      const parsed = options.schema.safeParse(report.input);
      return parsed.success ? parsed.data : null;
    }

    // Serverseitige Suchschleife pausiert: Antwort unverändert zurückgeben und fortsetzen.
    if (response.stop_reason !== "pause_turn") return null;
    messages.push({ role: "assistant", content: response.content });
  }
  return null;
}

export function cleanSources(sources: string[]) {
  return sources.filter((s) => /^https?:\/\//.test(s)).slice(0, 5);
}

/**
 * Ergebnis der Web-Recherche zu einem Wein – in einem Durchgang: Stammdaten und je
 * Jahrgang Trinkfenster und Rebsorten mit %. vintage_year 0 = ohne Jahrgang.
 */
export const EnrichmentSchema = WineProposalSchema.pick({
  producer: true,
  country: true,
  region: true,
  appellation: true,
  type: true,
  alcohol_content: true,
}).extend({
  vintages: z
    .array(
      z.object({
        // Keine .int()/.min()/.max(): strict Tools kennen minimum/maximum nicht (400). Die
        // Wertebereiche prüft researchWineWeb nach der Antwort und verwirft Ungültiges.
        vintage_year: z.number().describe("Jahrgang wie angefragt (ganze Zahl); 0 = ohne Jahrgang"),
        drink_from_year: z.number().nullable().describe("Trinkfenster ab (Jahr, ganze Zahl) für diesen Jahrgang"),
        drink_until_year: z.number().nullable().describe("Trinkfenster bis (Jahr, ganze Zahl) für diesen Jahrgang"),
        grapes: z.array(GrapeShareSchema).describe("Rebsorten dieses Jahrgangs, wichtigste zuerst; leer wenn unbekannt"),
        percentages_for_vintage: z
          .boolean()
          .describe("true, wenn die Prozente ausdrücklich für diesen Jahrgang belegt sind oder der Wein reinsortig ist"),
      }),
    )
    .describe("Je angefragtem Jahrgang ein Eintrag"),
  sources: z.array(z.string()).describe("URLs der verwendeten Quellen"),
});

export type DrinkWindow = { from: number | null; until: number | null };

/** Jahr nur, wenn ganzzahlig und 1800–2100; sonst verworfen. */
const plausibleYear = (y: number | null | undefined) =>
  y != null && Number.isInteger(y) && y >= 1800 && y <= 2100 ? y : null;

/** Antwort der Recherche prüfen: ungültige Werte verwerfen statt speichern. */
function validField(field: EnrichableField, value: unknown) {
  if (value == null) return false;
  if (field === "alcohol_content") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 25;
  return typeof value === "string" ? value.trim().length > 0 && value.length <= 200 : true;
}

const FIELD_NAMES: Record<EnrichableField, string> = {
  producer: "Produzent",
  country: "Land",
  region: "Region",
  appellation: "Appellation",
  type: "Typ",
  alcohol_content: "Alkohol",
};

export type ResearchVintage = { year: number | null; knownGrapes: string[] };

export type WineResearch = {
  /** Gefundene, gültige Werte für alle Stammdaten (auch wenn schon etwas gespeichert ist). */
  fields: Partial<Pick<WineProposal, EnrichableField>>;
  vintages: { year: number | null; drink: DrinkWindow; grapes: GrapeShare[] }[];
  sources: string[];
};

/**
 * Web-Recherche für einen Wein in einem Durchgang (Sonnet + web_search): immer alle
 * Angaben – Produzent, Land, Region, Appellation, Typ, Alkohol und je Jahrgang Trinkfenster
 * und Rebsorten mit %. Was davon gespeichert wird (nur Leeres) oder als Vorschlag gilt
 * (Abweichung), entscheidet der Aufrufer. null, wenn nichts kam.
 */
export async function researchWineWeb(input: {
  wine: Pick<WineProposal, "name" | EnrichableField>;
  vintages: ResearchVintage[];
}): Promise<WineResearch | null> {
  if (!input.wine.name) return null;
  const label = (year: number | null) => (year == null ? "ohne Jahrgang (NV) – als 0 melden" : String(year));
  const found = await webResearch({
    prompt: `Recherchiere diesen Wein im Web und melde alle Angaben, die die Quellen belegen:
- ${Object.values(FIELD_NAMES).join(", ")}
${input.vintages.map((v) => `- Jahrgang ${label(v.year)}: Trinkfenster ab/bis, Rebsorten mit Prozent${v.knownGrapes.length ? ` (bei uns erfasst: ${v.knownGrapes.join(", ")})` : ""}`).join("\n")}
Bei uns gespeichert (nur Kontext): ${JSON.stringify(input.wine)}
Melde den Wert aus den Quellen, auch wenn er von unseren Angaben abweicht – wir vergleichen selbst.
Nutze bevorzugt die Website bzw. technische Datenblätter (Fiche technique, Tech Sheet) des Produzenten, sonst seriöse Händler oder Fachpresse. Gib nur an, was die Quellen für genau diesen Wein belegen; sonst null bzw. leere Liste.
- Für jeden genannten Jahrgang genau einen Eintrag in vintages.
- Rebsorten: percent nur, wenn eine Quelle den Anteil für genau diesen Jahrgang belegt (Cuvées ändern sich); reinsortig = 100; sonst Rebsorten mit percent null. Internationale Schreibweise (Cabernet Sauvignon, Tempranillo …).
- Land auf Deutsch.`,
    toolName: "report_wine_details",
    toolDescription: "Meldet die per Websuche gefundenen Angaben zum Wein samt Quellen-URLs.",
    schema: EnrichmentSchema,
    maxSearches: Math.min(8, 3 + input.vintages.length),
  });
  if (!found) return null;

  const fields: WineResearch["fields"] = {};
  for (const field of Object.keys(FIELD_NAMES) as EnrichableField[]) {
    if (validField(field, found[field])) (fields as Record<EnrichableField, unknown>)[field] = found[field];
  }
  const result: WineResearch["vintages"] = [];
  for (const v of input.vintages) {
    const hit = found.vintages.find((x) => (x.vintage_year === 0 ? null : x.vintage_year) === v.year);
    if (!hit) continue;
    const from = v.year != null ? plausibleYear(hit.drink_from_year) : null;
    const until = v.year != null ? plausibleYear(hit.drink_until_year) : null;
    // Prozente ausserhalb 0–100 verwirft normalizeGrapeShares (dann ohne Anteil).
    let grapes = normalizeGrapeShares(hit.grapes);
    const singleVarietal = grapes.length === 1 && grapes[0].percent === 100;
    if (!hit.percentages_for_vintage && !singleVarietal) grapes = grapes.map((g) => ({ ...g, percent: null }));
    result.push({
      year: v.year,
      drink: from == null || until == null || from <= until ? { from, until } : { from: null, until: null },
      grapes,
    });
  }
  return { fields, vintages: result, sources: cleanSources(found.sources) };
}

/**
 * Erfassung (Bot): leere Stammdaten, Trinkfenster und Rebsorten mit % des Jahrgangs in
 * einem Durchgang. Vorhandene Angaben bleiben. grapes = null: keine gesucht/gefunden.
 */
export async function enrichFromWeb(proposal: WineProposal): Promise<{
  proposal: WineProposal;
  filled: EnrichableField[];
  sources: string[];
  drink: DrinkWindow;
  grapes: { shares: GrapeShare[]; sources: string[] } | null;
}> {
  const none = { proposal, filled: [], sources: [], drink: { from: null, until: null }, grapes: null };
  const missing = missingEnrichableFields(proposal);
  const found = await researchWineWeb({
    wine: proposal,
    vintages: [{ year: proposal.vintage_year, knownGrapes: proposal.grape_shares.map((g) => g.grape) }],
  });
  if (!found) return none;
  // Bei der Erfassung nur Leeres ergänzen; Etikett bzw. bekannter Wein gehen vor.
  const fill = Object.fromEntries(missing.flatMap((f) => (found.fields[f] != null ? [[f, found.fields[f]]] : [])));
  const merged: WineProposal = { ...proposal, ...fill };
  const vintage = found.vintages[0];
  return {
    proposal: normalizeProposal(merged),
    filled: missing.filter((f) => found.fields[f] != null),
    sources: found.sources,
    drink: vintage?.drink ?? { from: null, until: null },
    grapes: vintage?.grapes.length && !hasCompletePercents(proposal.grape_shares) ? { shares: vintage.grapes, sources: found.sources } : null,
  };
}

const TEXT_SYSTEM = `Du erfasst Weineinkäufe für eine private Weinsammlung in der Schweiz aus einer kurzen Nachricht, z. B. „Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“.
Übernimm nur, was in der Nachricht steht oder sich eindeutig daraus ergibt; erfinde nichts.
- name: Weinname ohne Produzent und Jahrgang. producer nur, wenn genannt (sonst null – wird später recherchiert).
- type, country, grape_shares, alcohol_content, bottle_size_ml nur, wenn genannt bzw. eindeutig (z. B. „Magnum“ = 1500).
- Land auf Deutsch.
- purchase: Anzahl Flaschen, Lagerort (nur Weinkeller oder Wohnzimmer), bezahlter Preis und Normalpreis pro Flasche in CHF, Händler. Nicht Genanntes: 0 bzw. leer. Ein Gesamtpreis für mehrere Flaschen wird durch die Anzahl geteilt.`;

/** Freitext → Wein + Kaufangaben (Haiku, bei Fehler oder Ablehnung Sonnet). */
export async function parseTextEntry(text: string): Promise<{ proposal: WineProposal; purchase: TextEntry["purchase"] }> {
  const run = async (model: string) => {
    const response = await anthropic().beta.messages.parse({
      model,
      max_tokens: 8000,
      system: TEXT_SYSTEM,
      messages: [{ role: "user", content: text }],
      output_config: { format: betaZodOutputFormat(TextEntrySchema) },
      ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new RecognitionError(`${model} hat den Text nicht erfasst.`);
    }
    return response.parsed_output;
  };
  let parsed: TextEntry;
  try {
    parsed = await run(RECOGNITION_MODEL);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || usageLimit(error)) throw error;
    parsed = await run(FALLBACK_MODEL);
  }
  const { purchase, ...wine } = parsed;
  return { proposal: normalizeProposal(wine), purchase };
}

/** Übernimmt eine Freitext-Korrektur in den Vorschlag (Haiku, strukturierte Ausgabe). */
export async function applyCorrection(
  proposal: WineProposal,
  correction: string,
): Promise<WineProposal> {
  const response = await anthropic().beta.messages.parse({
    model: RECOGNITION_MODEL,
    max_tokens: 16000,
    system:
      "Du pflegst Weindaten. Übernimm die Korrektur des Users in die bestehenden Daten und gib den vollständigen, aktualisierten Datensatz zurück. Ändere nur, was die Korrektur betrifft. Land auf Deutsch.",
    messages: [
      {
        role: "user",
        content: `Aktuelle Daten: ${JSON.stringify(proposal)}\n\nKorrektur: ${correction}`,
      },
    ],
    output_config: { format: betaZodOutputFormat(WineProposalSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new RecognitionError("Die Korrektur konnte nicht übernommen werden.");
  }
  return normalizeProposal(response.parsed_output);
}
