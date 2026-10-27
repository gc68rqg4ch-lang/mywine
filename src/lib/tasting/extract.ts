import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FALLBACK_MODEL, RECOGNITION_MODEL, SONNET_FALLBACK, anthropic } from "@/lib/ingest/recognize";
import { aromaLexicon, extractableFields, type Extraction } from "./bot-draft";
import { WINE_STYLE, type SatData, type SatType } from "./sat";

type Options = [string, ...string[]];

/** Schema mit exakten Optionswerten je Feld; nicht Erwähntes ist null. */
export function extractionSchema(type: SatType) {
  const fields = Object.fromEntries(
    extractableFields(type).map((def) => {
      const option = z.enum(def.options as Options);
      return [def.key, (def.multi ? z.array(option) : option).nullable().describe(def.label)];
    }),
  );
  const lexicon = aromaLexicon(type);
  const aroma = z.object({
    group: z.enum([...lexicon.keys()] as Options),
    aroma: z.enum([...new Set([...lexicon.values()].flat())] as Options),
  });
  return z.object({
    fields: z.object(fields),
    aromas_add: z.array(aroma),
    aromas_remove: z.array(aroma),
    notes: z.string().nullable(),
  });
}

function systemPrompt(type: SatType) {
  const defs = extractableFields(type)
    .map((d) => `- ${d.key} (${d.label}${d.multi ? ", mehrere möglich" : ""}): ${d.options.map((o) => `„${o}“`).join(", ")}`)
    .join("\n");
  const aromas = [...aromaLexicon(type)].map(([group, list]) => `- ${group}: ${list.join(", ")}`).join("\n");
  return `Du überträgst Verkostungseindrücke nach WSET Level 3 (SAT) in ein Formular. Weinart: ${WINE_STYLE[type]}.

Regeln:
- Übernimm nur, was im neuen Text tatsächlich gesagt wird. Nichts erfinden, nichts ableiten, was nicht gesagt ist.
- Nicht Erwähntes ist null (bzw. leere Liste). Der bisherige Stand bleibt dann automatisch erhalten.
- Verwende ausschliesslich die exakten Optionswerte unten. Übliche Umschreibungen darfst du zuordnen, wenn die Bedeutung eindeutig ist (z. B. „knackige Säure“ → saeure „hoch“, „eher hohe Säure“ → „mittel (+)“, „langer Abgang“ → abgang „lang“, „trocken“ → suesse „trocken“). Ist es nicht eindeutig, lass das Feld null.
- Aromen nur aus dem Lexikon, mit der passenden Gruppe; nur eindeutige Entsprechungen (z. B. „Kirsche“ bei Rotwein nur, wenn rot oder schwarz klar ist – sonst weglassen und in notes erwähnen).
- Korrigiert der Text etwas Bisheriges („doch eher kurzer Abgang“, „keine Vanille“), setze den neuen Wert bzw. nimm das Aroma in aromas_remove auf.
- notes: kurze Bemerkungen, die in kein Feld passen (z. B. Speisebegleitung, Anlass), sonst null.

Felder und erlaubte Werte:
${defs}

Aromen-Lexikon (Gruppe: Begriffe):
${aromas}`;
}

function currentState(data: SatData) {
  const fields = Object.fromEntries(
    extractableFields(data.type).flatMap((d) => {
      const v = data.fields[d.key];
      return v == null || (Array.isArray(v) && !v.length) || v === "" ? [] : [[d.key, v]];
    }),
  );
  return JSON.stringify({ fields, aromas: data.aromas, notes: data.notes || null });
}

async function extractWith(model: string, data: SatData, text: string): Promise<Extraction> {
  const response = await anthropic().beta.messages.parse({
    model,
    max_tokens: 8000,
    system: systemPrompt(data.type),
    messages: [
      {
        role: "user",
        content: `Bisheriger Stand: ${currentState(data)}\n\nNeuer Text:\n${text}`,
      },
    ],
    output_config: { format: betaZodOutputFormat(extractionSchema(data.type)) },
    ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`${model}: kein gültiges Ergebnis (${response.stop_reason})`);
  }
  return response.parsed_output as Extraction;
}

/** Ordnet Freitext den SAT-Feldern zu: zuerst Haiku, bei Fehler oder Ablehnung Sonnet. */
export async function extractTasting(data: SatData, text: string): Promise<Extraction> {
  try {
    return await extractWith(RECOGNITION_MODEL, data, text);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
    console.warn("tasting: escalating to", FALLBACK_MODEL, error instanceof Error ? error.message : error);
    return await extractWith(FALLBACK_MODEL, data, text);
  }
}
