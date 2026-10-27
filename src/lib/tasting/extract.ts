import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { usageLimit } from "@/lib/ai/api-errors";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { FALLBACK_MODEL, RECOGNITION_MODEL, SONNET_FALLBACK, anthropic } from "@/lib/ingest/recognize";
import { aromaLexicon, extractableFields, type Extraction } from "./bot-draft";
import { WINE_STYLE, type SatData, type SatType } from "./sat";

type Options = [string, ...string[]];

/**
 * Wert für „im Text nicht erwähnt“. Das Schema kommt so ohne nullable/Union-Typen aus –
 * die API erlaubt höchstens MAX_UNION_PARAMS davon (Mehrfachfelder: leere Liste,
 * Notizen: leerer String).
 */
export const NOT_MENTIONED = "nicht_erwähnt";

/** Schema mit exakten Optionswerten je Feld; nicht Erwähntes ist NOT_MENTIONED bzw. leer. */
export function extractionSchema(type: SatType) {
  const fields = Object.fromEntries(
    extractableFields(type).map((def) => [
      def.key,
      (def.multi ? z.array(z.enum(def.options as Options)) : z.enum([NOT_MENTIONED, ...def.options] as Options)).describe(
        def.label,
      ),
    ]),
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
    notes: z.string().describe("Leer, wenn es nichts zu notieren gibt"),
  });
}

/** Antwort von Claude → Extraction (nicht Erwähntes wird null, wie applyExtraction es erwartet). */
export function toExtraction(raw: z.infer<ReturnType<typeof extractionSchema>>): Extraction {
  const fields: Extraction["fields"] = {};
  for (const [key, value] of Object.entries(raw.fields as Record<string, string | string[]>)) {
    fields[key] = value === NOT_MENTIONED || (Array.isArray(value) && value.length === 0) ? null : value;
  }
  return {
    fields,
    aromas_add: raw.aromas_add,
    aromas_remove: raw.aromas_remove,
    notes: raw.notes.trim() || null,
  };
}

function systemPrompt(type: SatType) {
  const defs = extractableFields(type)
    .map((d) => `- ${d.key} (${d.label}${d.multi ? ", mehrere möglich" : ""}): ${d.options.map((o) => `„${o}“`).join(", ")}`)
    .join("\n");
  const aromas = [...aromaLexicon(type)].map(([group, list]) => `- ${group}: ${list.join(", ")}`).join("\n");
  return `Du überträgst Verkostungseindrücke nach WSET Level 3 (SAT) in ein Formular. Weinart: ${WINE_STYLE[type]}.

Regeln:
- Übernimm nur, was im neuen Text tatsächlich gesagt wird. Nichts erfinden, nichts ableiten, was nicht gesagt ist.
- Nicht Erwähntes ist „${NOT_MENTIONED}“ (bei Mehrfachfeldern eine leere Liste, notes ein leerer String). Der bisherige Stand bleibt dann automatisch erhalten.
- Verwende ausschliesslich die exakten Optionswerte unten. Übliche Umschreibungen darfst du zuordnen, wenn die Bedeutung eindeutig ist (z. B. „knackige Säure“ → saeure „hoch“, „eher hohe Säure“ → „mittel (+)“, „langer Abgang“ → abgang „lang“, „trocken“ → suesse „trocken“). Ist es nicht eindeutig, setze „${NOT_MENTIONED}“.
- Aromen nur aus dem Lexikon, mit der passenden Gruppe; nur eindeutige Entsprechungen (z. B. „Kirsche“ bei Rotwein nur, wenn rot oder schwarz klar ist – sonst weglassen und in notes erwähnen).
- Korrigiert der Text etwas Bisheriges („doch eher kurzer Abgang“, „keine Vanille“), setze den neuen Wert bzw. nimm das Aroma in aromas_remove auf.
- notes: kurze Bemerkungen, die in kein Feld passen (z. B. Speisebegleitung, Anlass), sonst leer.

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
  return toExtraction(response.parsed_output);
}

/** Ordnet Freitext den SAT-Feldern zu: zuerst Haiku, bei Fehler oder Ablehnung Sonnet. */
export async function extractTasting(data: SatData, text: string): Promise<Extraction> {
  try {
    return await extractWith(RECOGNITION_MODEL, data, text);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
    if (usageLimit(error)) throw error;
    console.warn("tasting: escalating to", FALLBACK_MODEL, error instanceof Error ? error.message : error);
    return await extractWith(FALLBACK_MODEL, data, text);
  }
}
