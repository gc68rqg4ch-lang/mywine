import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  RecognitionSchema,
  WineProposalSchema,
  missingEnrichableFields,
  normalizeProposal,
  type EnrichableField,
  type Recognition,
  type WineProposal,
} from "./schema";

export const RECOGNITION_MODEL = "claude-haiku-5-5";
export const FALLBACK_MODEL = "claude-sonnet-5-5";
export const MIN_CONFIDENCE = 0.7;

// Sonnet 5.5 kann bei Sicherheitsklassifikatoren ablehnen; die serverseitige
// Fallback-Kette springt dann automatisch auf ein passendes Modell.
const SONNET_FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic(); // liest ANTHROPIC_API_KEY
  return client;
}

export type LabelImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export class RecognitionError extends Error {}

const RECOGNITION_SYSTEM = `Du liest Weinetiketten für einen privaten Weinkeller in der Schweiz.
Du bekommst Fotos der Vorder- und meist auch der Rückseite derselben Flasche.
Lies nur ab, was auf dem Etikett steht oder sich daraus eindeutig ergibt (z. B. Land aus "Product of Spain").
Erfinde nichts: Was nicht lesbar oder nicht angegeben ist, ist null bzw. eine leere Liste.
- name: der Weinname ohne Produzent und ohne Jahrgang (z. B. "Reserva", "Les Pagodes de Cos"). Hat der Wein keinen eigenen Namen, nimm die Rebsorte oder Appellation, wie sie auf dem Etikett hervorgehoben ist.
- country: auf Deutsch (Spanien, Frankreich, Italien, Portugal, Schweiz, USA, …).
- type: red (Rotwein), white (Weisswein), rose, sparkling (Schaumwein/Champagner/Cava), sweet (Süsswein), fortified (Port, Sherry, Madeira), orange.
- bottle_size_ml: aus der Füllmenge (75 cl = 750, 37,5 cl = 375, 1,5 l = 1500).
- confidence: wie sicher Name, Produzent und Jahrgang stimmen (1.0 = klar lesbar, unter 0.7 = geraten oder unleserlich).`;

function imageBlocks(images: LabelImage[]): Anthropic.Beta.BetaContentBlockParam[] {
  return images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
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
};

/** Etikett erkennen: zuerst Haiku, bei Konfidenz < 0.7 nochmals mit Sonnet. */
export async function recognizeLabel(images: LabelImage[]): Promise<RecognitionResult> {
  let model = RECOGNITION_MODEL;
  let result = await recognizeWith(model, images);

  if (result.confidence < MIN_CONFIDENCE) {
    model = FALLBACK_MODEL;
    result = await recognizeWith(model, images);
  }

  const { confidence, uncertain_notes, ...proposal } = result;
  return {
    proposal: normalizeProposal(proposal),
    model,
    confidence: Math.min(1, Math.max(0, confidence)),
    notes: uncertain_notes?.trim() || null,
  };
}

const REPORT_TOOL_NAME = "report_wine_details";

const EnrichmentSchema = WineProposalSchema.pick({
  country: true,
  region: true,
  appellation: true,
  type: true,
  grapes: true,
  alcohol_content: true,
}).extend({ sources: z.array(z.string()).describe("URLs der verwendeten Quellen") });

const REPORT_INPUT_SCHEMA = z.toJSONSchema(EnrichmentSchema, {
  target: "draft-7",
}) as Anthropic.Beta.BetaTool.InputSchema;
// Das Tool-Schema braucht nur type/properties/required – ohne "$schema"-Schlüssel.
delete REPORT_INPUT_SCHEMA.$schema;

/**
 * Ergänzt fehlende Felder per Websuche (Sonnet 5.5 + web_search). Das Ergebnis
 * meldet Claude über ein striktes Tool, damit es schemakonform ist.
 */
export async function enrichFromWeb(
  proposal: WineProposal,
): Promise<{ proposal: WineProposal; filled: EnrichableField[]; sources: string[] }> {
  const missing = missingEnrichableFields(proposal);
  if (missing.length === 0 || !proposal.name || !proposal.producer) {
    return { proposal, filled: [], sources: [] };
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Suche im Web nach diesem Wein und ergänze die fehlenden Angaben: ${missing.join(", ")}.
Bekannte Angaben (vom Etikett, nicht ändern): ${JSON.stringify(proposal)}
Nutze bevorzugt die Website des Produzenten oder seriöse Händler. Gib nur an, was die Quellen für genau diesen Wein belegen; sonst null.
Land auf Deutsch. Rufe am Ende genau einmal ${REPORT_TOOL_NAME} auf.`,
    },
  ];

  const tools: Anthropic.Beta.BetaToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: 4 },
    {
      name: REPORT_TOOL_NAME,
      description: "Meldet die per Websuche gefundenen Angaben zum Wein samt Quellen-URLs.",
      strict: true,
      input_schema: REPORT_INPUT_SCHEMA,
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

    if (response.stop_reason === "refusal") break;

    const report = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === REPORT_TOOL_NAME,
    );
    if (report) {
      const parsed = EnrichmentSchema.safeParse(report.input);
      if (!parsed.success) break;
      return mergeEnrichment(proposal, missing, parsed.data);
    }

    // Serverseitige Suchschleife pausiert: Antwort unverändert zurückgeben und fortsetzen.
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  return { proposal, filled: [], sources: [] };
}

function mergeEnrichment(
  proposal: WineProposal,
  missing: EnrichableField[],
  found: { sources: string[] } & Pick<WineProposal, EnrichableField>,
) {
  const merged: WineProposal = { ...proposal };
  const filled: EnrichableField[] = [];
  for (const field of missing) {
    const value = found[field];
    if (field === "grapes") {
      if (found.grapes.length) {
        merged.grapes = found.grapes;
        filled.push(field);
      }
    } else if (value != null) {
      (merged as Record<EnrichableField, unknown>)[field] = value;
      filled.push(field);
    }
  }
  return {
    proposal: normalizeProposal(merged),
    filled,
    sources: found.sources.filter((s) => /^https?:\/\//.test(s)).slice(0, 5),
  };
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
