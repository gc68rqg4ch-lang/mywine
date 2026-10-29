import { parseBestBefore, toBestBeforeValue } from "./best-before";
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { usageLimit } from "@/lib/ai/api-errors";
import { strictSchemaProblems } from "@/lib/ai/schema-limits";
import { SHOP_DOMAINS, shopSourceAllowed } from "@/lib/research/shops/match";
import { hasCompletePercents, normalizeGrapeShares, type GrapeShare } from "@/lib/grapes/shares";
import {
  GrapeShareSchema,
  CorrectionSchema,
  RecognitionSchema,
  TastedTextSchema,
  TextEntrySchema,
  WineProposalSchema,
  missingEnrichableFields,
  normalizeProposal,
  type EnrichableField,
  type Recognition,
  type TastedText,
  type TextEntry,
  type WineProposal,
} from "./schema";

export type { SpiritLabel } from "@/lib/spirits/draft";
import type { SpiritLabel } from "@/lib/spirits/draft";

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

/** Gilt für Foto und Text: nur Stufe bzw. Gattungswort → Marke davor (wie die bestehenden Weine). */
const NAME_RULE =
  "Den Produzenten nicht in den Namen – ausser der Name besteht nur aus einer Qualitäts-/Reifestufe oder einem Gattungswort (Reserva, Gran Reserva, Grande Reserva, Riserva, Crianza, Reserve, Grand Vin, Cuvée, Tinto, Rosso): dann Produzent bzw. Marke davor, z. B. „Legaris Reserva“, „Protos Reserva“, „Pago de los Capellanes Reserva“ (ohne „Bodegas“).";

/** Gilt für Foto und Text: Ablaufdatum nur, wenn klar lesbar – sonst leer. */
const BEST_BEFORE_RULE =
  "best_before: Ablaufdatum, falls eins dasteht (oft bei alkoholfreien Weinen und Schaumweinen: „mindestens haltbar bis“, „MHD“, „best before“, „à consommer de préférence avant“, „consumir preferentemente antes de“, „da consumarsi preferibilmente entro“). Mit Tag als YYYY-MM-DD, nur Monat und Jahr als YYYY-MM (z. B. „09/2028“ oder „SEP 2028“ → 2028-09). Leer, wenn keins dasteht oder es nicht klar lesbar ist – nicht raten, nie den Jahrgang oder das Abfülldatum (Los/Lot) nehmen.";

const RECOGNITION_SYSTEM = `Du liest Weinetiketten für eine private Weinsammlung in der Schweiz.
Du bekommst Fotos der Vorder- und meist auch der Rückseite derselben Flasche.
Lies nur ab, was auf dem Etikett steht oder sich daraus eindeutig ergibt (z. B. Land aus "Product of Spain").
Erfinde nichts: Was nicht lesbar oder nicht angegeben ist, ist null bzw. eine leere Liste.
- name: der Weinname ohne Jahrgang (z. B. "Les Pagodes de Cos", "Pintia"). ${NAME_RULE} Hat der Wein keinen eigenen Namen, nimm die Rebsorte oder Appellation, wie sie auf dem Etikett hervorgehoben ist.
- country: auf Deutsch (Spanien, Frankreich, Italien, Portugal, Schweiz, USA, …).
- type: red (Rotwein), white (Weisswein), rose, sparkling (Schaumwein/Champagner/Cava), sweet (Süsswein), fortified (Port, Sherry, Madeira – das ist Wein), spirit (Spirituose: Whisky, Grappa, Likör, Obstbrand, Cognac/Brandy, Rum, Gin, Vodka, Tequila/Mezcal, Kräuterschnaps).
- bottle_size_ml: aus der Füllmenge (75 cl = 750, 70 cl = 700, 37,5 cl = 375, 1,5 l = 1500).
- spirit: kind „spirit“ bei einer Spirituose, „wine“ bei Wein, „unsure“, wenn du es nicht sicher erkennst. Bei Spirituosen: name = Name der Abfüllung (z. B. „Lagavulin 16“, „Woodford Reserve“), producer = Destillerie bzw. Hersteller, region z. B. Islay, Speyside, Kentucky, Cognac; alcohol_content in % vol (oft 40–60); grape_shares leer (bei Grappa die Rebsorte nur, wenn sie dasteht). Dazu category/subcategory (Haupt-, Unterkategorie – nur aus den im Schema genannten Kategorien, nie neue Namen erfinden; z. B. „Monovitigno Nosiola“ ist keine Unterkategorie, sondern gehört zu Grappa / Trester ohne Unterkategorie), Altersangabe, Fass/Finish, Destilliert- und Abfülljahr – nur, was auf dem Etikett steht; sonst leer bzw. 0. vintage_year nur, wenn ein Jahrgang ausdrücklich als solcher dasteht (sonst null; Destilliert/Abgefüllt gehören in spirit).
- grape_shares: Rebsorten, die auf dem Etikett stehen; percent nur, wenn der Anteil aufgedruckt ist (z. B. "85 % Tempranillo"), sonst null. Bei reinsortigen Weinen ("100 % Merlot" oder Sortenbezeichnung wie "Pinot Noir") ist percent 100.
- vintage_certain: true nur, wenn der Jahrgang klar auf dem Etikett steht. Fehlt er oder ist er unleserlich, ist vintage_year null bzw. vintage_certain false – rate keinen Jahrgang.
- image_sides: für jedes Foto in Reihenfolge, ob es das Vorderetikett (front), das Rückenetikett (back) oder etwas anderes (other) zeigt.
- confidence: wie sicher Name, Produzent und Jahrgang stimmen (1.0 = klar lesbar, unter 0.7 = geraten oder unleserlich).
- ${BEST_BEFORE_RULE}`;

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
  /** Spirituose (kind spirit/unsure) – Angaben vom Etikett; null bei Wein. */
  spirit?: SpiritLabel | null;
  model: string;
  confidence: number;
  notes: string | null;
  imageSides: Recognition["image_sides"] | null;
  /** Jahrgang eindeutig gelesen; sonst fragt der Bot nach. */
  vintageCertain: boolean;
  /** Ablaufdatum vom Etikett („2028-09“ bzw. „2027-05-31“), nur wenn gültig; sonst null. */
  bestBefore?: string | null;
};

/** Ablaufdatum aus der Erkennung prüfen und vereinheitlichen; ungültig/leer → null. */
export function cleanBestBefore(raw: string | null | undefined) {
  const bb = parseBestBefore(raw);
  return bb ? toBestBeforeValue(bb) : null;
}

/** Etikett erkennen: zuerst Haiku, bei Konfidenz < 0.7 nochmals mit Sonnet. */
export async function recognizeLabel(images: LabelImage[]): Promise<RecognitionResult> {
  let model = RECOGNITION_MODEL;
  let result = await recognizeWith(model, images);

  if (result.confidence < MIN_CONFIDENCE) {
    model = FALLBACK_MODEL;
    result = await recognizeWith(model, images);
  }

  const { confidence, uncertain_notes, image_sides, vintage_certain, best_before, spirit, ...wine } = result;
  // Spirituose (bzw. unsicher): Art „spirit“ nur bei sicherer Erkennung – sonst fragt Antoine.
  const proposal = spirit.kind === "spirit" ? { ...wine, type: "spirit" as const } : spirit.kind === "unsure" && wine.type === "spirit" ? { ...wine, type: null } : wine;
  return {
    proposal: normalizeProposal(proposal, { spiritPossible: spirit.kind !== "wine" }),
    spirit: spirit.kind === "wine" && proposal.type !== "spirit" ? null : spirit,
    model,
    confidence: Math.min(1, Math.max(0, confidence)),
    notes: uncertain_notes?.trim() || null,
    imageSides: image_sides.length === images.length ? image_sides : null,
    vintageCertain: vintage_certain && proposal.vintage_year != null,
    bestBefore: cleanBestBefore(best_before),
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
/** Höchstens so viele Abrufe von Händler-Datenblättern (web_fetch) pro Recherche-Aufruf. */
export const MAX_SHOP_FETCHES = 3;

/**
 * Werkzeuge der Recherche: Websuche, das strict-Tool für die Antwort und – nur wenn die
 * Händler-Shops nichts geliefert haben (fetchShops) – web_fetch, beschränkt auf die Shops.
 */
export function researchTools(options: {
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Beta.BetaTool.InputSchema;
  maxSearches: number;
  fetchShops?: boolean;
}): Anthropic.Beta.BetaToolUnion[] {
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: options.maxSearches },
    ...(options.fetchShops
      ? [{ type: "web_fetch_20260209" as const, name: "web_fetch" as const, max_uses: MAX_SHOP_FETCHES, allowed_domains: [...SHOP_DOMAINS] }]
      : []),
    {
      name: options.toolName,
      description: options.toolDescription,
      strict: true,
      input_schema: options.inputSchema,
    },
  ];
}

export async function webResearch<T>(options: {
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxSearches: number;
  /** Angehängte PDFs (Datenblätter) als zusätzliche Quelle – neben der Websuche. */
  documents?: { name: string; base64: string }[];
  /** Seiten aus Händler-Shops (Text) als zusätzliche Quelle – zitiert mit ihrer URL. */
  pages?: { url: string; title: string; text: string }[];
  /** Shops ohne Treffer: Datenblatt per web_fetch (nur Shop-Domains) suchen lassen. */
  fetchShops?: boolean;
}): Promise<T | null> {
  const text = `${options.prompt}\nRufe am Ende genau einmal ${options.toolName} auf.`;
  const blocks: Anthropic.Beta.BetaRequestDocumentBlock[] = [
    ...(options.documents ?? []).map(
      (d): Anthropic.Beta.BetaRequestDocumentBlock => ({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: d.base64 },
        title: d.name,
      }),
    ),
    ...(options.pages ?? []).map(
      (p): Anthropic.Beta.BetaRequestDocumentBlock => ({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: p.text },
        title: p.title,
        context: `Händlerseite ${p.url}`,
      }),
    ),
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: blocks.length ? [...blocks, { type: "text", text }] : text },
  ];
  const inputSchema = toolInputSchema(options.schema);
  const problems = strictSchemaProblems(inputSchema);
  if (problems.length) throw new Error(`Schema für ${options.toolName} nicht strict-tauglich: ${problems.join(", ")}`);
  const tools = researchTools({ ...options, inputSchema });

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

/** Web-Quellen (http/https) und beigelegte Datenblätter („dokument:<Name>“). */
export function cleanSources(sources: string[]) {
  return sources.filter((s) => /^https?:\/\//.test(s) || /^dokument:.+/.test(s)).slice(0, 5);
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
  /** Angehängte Datenblätter der gesuchten Jahrgänge (zusätzlich zur Websuche). */
  documents?: { name: string; year: number | null; base64: string }[];
  /** Hinweis im Prompt zu den Datenblättern. */
  documentsNote?: string;
  /** Seiten aus Händler-Shops (Text) und der Hinweis dazu im Prompt. */
  pages?: { url: string; title: string; text: string }[];
  pagesNote?: string;
  /** Shops ohne Treffer: Datenblatt per web_fetch suchen lassen (Hinweis im Prompt: fetchNote). */
  fetchShops?: boolean;
  fetchNote?: string;
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
- Land auf Deutsch.${input.documentsNote ?? ""}${input.pagesNote ?? ""}${input.fetchShops ? (input.fetchNote ?? "") : ""}`,
    toolName: "report_wine_details",
    documents: input.documents,
    pages: input.pages,
    fetchShops: input.fetchShops,
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
  // Ein Jahrgang: Shop-Adressen mit anderem Jahrgang (bzw. Datenblatt ohne Jahrgang) nicht als Quelle.
  const single = input.vintages.length === 1 ? input.vintages[0].year : undefined;
  const sources = single === undefined ? found.sources : found.sources.filter((s) => shopSourceAllowed(s, single));
  return { fields, vintages: result, sources: cleanSources(sources) };
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
- name: Weinname ohne Jahrgang. ${NAME_RULE} producer nur, wenn genannt (sonst null – wird später recherchiert).
- type, country, grape_shares, alcohol_content, bottle_size_ml nur, wenn genannt bzw. eindeutig (z. B. „Magnum“ = 1500).
- Land auf Deutsch.
- Spirituosen (Whisky, Grappa, Likör, Obstbrand, Cognac, Rum, Gin …): type spirit, im Block spirit Kategorie, Altersangabe, Fass/Finish, Destilliert/Abgefüllt, wenn genannt; kind unsure, wenn unklar ist, ob Wein oder Spirituose. Bei Wein kind wine.
- ${BEST_BEFORE_RULE}
- purchase: Anzahl Flaschen, Lagerort (nur Weinkeller oder Wohnzimmer), bezahlter Preis (price) und Normalpreis (regular_price) pro Flasche in CHF, Händler. Ein einzelner Preis ist der bezahlte (price); regular_price nur, wenn ausdrücklich ein Normal-/Regulärpreis genannt ist (z. B. „49 statt 66“: price 49, regular_price 66). Nicht Genanntes: 0 bzw. leer. Ein Gesamtpreis für mehrere Flaschen wird durch die Anzahl geteilt.`;

/** Freitext → Wein + Kaufangaben (Haiku, bei Fehler oder Ablehnung Sonnet). */
export async function parseTextEntry(
  text: string,
): Promise<{ proposal: WineProposal; purchase: TextEntry["purchase"]; bestBefore: string | null; spirit: SpiritLabel | null }> {
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
  const { purchase, best_before, spirit, ...rest } = parsed;
  const wine = spirit.kind === "spirit" ? { ...rest, type: "spirit" as const } : rest;
  return {
    proposal: normalizeProposal(wine, { spiritPossible: spirit.kind !== "wine" }),
    purchase,
    bestBefore: cleanBestBefore(best_before),
    spirit: spirit.kind === "wine" && wine.type !== "spirit" ? null : spirit,
  };
}

/**
 * Übernimmt eine Freitext-Korrektur in den Vorschlag (Haiku, strukturierte Ausgabe), samt
 * Ablaufdatum („haltbar bis 10/2028“). bestBefore: null = keins (bzw. entfernt).
 */
export async function applyCorrection(
  proposal: WineProposal,
  correction: string,
  bestBefore: string | null = null,
): Promise<WineProposal & { bestBefore: string | null }> {
  const response = await anthropic().beta.messages.parse({
    model: RECOGNITION_MODEL,
    max_tokens: 16000,
    system:
      "Du pflegst Weindaten. Übernimm die Korrektur des Users in die bestehenden Daten und gib den vollständigen, aktualisierten Datensatz zurück. Ändere nur, was die Korrektur betrifft. Land auf Deutsch. best_before (Ablaufdatum) als YYYY-MM-DD bzw. YYYY-MM, leer = keins.",
    messages: [
      {
        role: "user",
        content: `Aktuelle Daten: ${JSON.stringify({ ...proposal, best_before: bestBefore ?? "" })}\n\nKorrektur: ${correction}`,
      },
    ],
    output_config: { format: betaZodOutputFormat(CorrectionSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new RecognitionError("Die Korrektur konnte nicht übernommen werden.");
  }
  const { best_before, ...wine } = response.parsed_output;
  return { ...normalizeProposal(wine), bestBefore: cleanBestBefore(best_before) };
}

const TASTED_SYSTEM = (today: string) => `Du erfasst für eine private Weinsammlung in der Schweiz einen Wein, den jemand irgendwo verkostet hat (Restaurant, Bar, bei Freunden), aus einer kurzen Nachricht – z. B. „Heute im Kronenhalle den Pintia 2019 probiert, 120 Franken die Flasche, mit Sara, 4,5 Sterne, würd ich kaufen“.
Übernimm nur, was in der Nachricht steht; erfinde nichts. Heute ist ${today}.
- name: Weinname ohne Jahrgang. ${NAME_RULE} producer nur, wenn genannt (sonst null). vintage_year nur, wenn genannt (sonst null).
- type, country, region nur, wenn genannt bzw. eindeutig. Land auf Deutsch.
- tasting: Datum (heute/gestern umrechnen, sonst leer), Ort, Preis mit Einheit (Flasche/Glas) und Währung, Anlass, Begleitung, Notiz, Sterne der schreibenden Person (-1 = nicht genannt), want_to_buy.`;

/** Freitext „verkostet“ → Wein + Angaben zum Eintrag (Haiku, bei Fehler oder Ablehnung Sonnet). */
export async function parseTastedText(text: string, today: string): Promise<{ proposal: WineProposal; tasting: TastedText["tasting"] }> {
  const run = async (model: string) => {
    const response = await anthropic().beta.messages.parse({
      model,
      max_tokens: 4000,
      system: TASTED_SYSTEM(today),
      messages: [{ role: "user", content: text }],
      output_config: { format: betaZodOutputFormat(TastedTextSchema) },
      ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new RecognitionError(`${model} hat den Text nicht erfasst.`);
    }
    return response.parsed_output;
  };
  let parsed: TastedText;
  try {
    parsed = await run(RECOGNITION_MODEL);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || usageLimit(error)) throw error;
    parsed = await run(FALLBACK_MODEL);
  }
  const { tasting, ...wine } = parsed;
  const proposal = normalizeProposal({ ...wine, appellation: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null });
  return { proposal, tasting };
}
