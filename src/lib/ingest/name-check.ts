import "server-only";

// Prüfschritt der Namen nach der Etikett-Erkennung (Einbuchen per Foto): ein kurzer Aufruf mit
// Sonnet 5.5 prüft nur Produzent und Weinnamen – mit den Fotos, dem Vorschlag (Produzent, Name,
// Jahrgang, Farbe, Rebsorten) und dem, was die gefundenen Quellen beschreiben. Er prüft: Ist der
// Name eine Cuvée (keine Herkunfts-/Lagenangabe)? Passen Name, Farbe und Rebsorten zu den
// Quellen? Beschreiben die Quellen denselben Wein (gleiche Farbe, gleiche Cuvée)?
// Ergebnis „ok“ oder ein korrigierter Vorschlag mit Begründung. Bei Fehlern: kein Ergebnis (das
// Einbuchen läuft wie bisher). Kosten in api_usage (Zweck „label_check“).

import sharp from "sharp";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { withUsage } from "@/lib/ai/usage";
import { formatShares } from "@/lib/grapes/shares";
import { FALLBACK_MODEL, SONNET_FALLBACK, anthropic, type LabelImage } from "./recognize";
import { NameCheckSchema, type NameCheck, type NameCheckInput } from "./name-decision";

export { decideNameCheck, NAME_CHECK_MAX_CONFIDENCE, type NameCheck, type NameCheckInput, type NameDecision } from "./name-decision";

/** Modell des Prüfschritts: Sonnet 5.5 (stärker als die reine Lesehilfe, günstiger als Opus). */
export const CHECK_MODEL = FALLBACK_MODEL;
/** Bilder für den Prüfschritt verkleinern (längste Seite) – genug für die Schrift, weniger Tokens. */
export const CHECK_IMAGE_PX = 1000;
const CHECK_MAX_TOKENS = 3000;

const COLOR_DE = { white: "weiss", rose: "rosé", red: "rot", unclear: "unklar" } as const;

const CHECK_SYSTEM = `Du prüfst für eine private Weinsammlung nur die Namensfelder einer Etikett-Erkennung: Produzent und Weinname (Cuvée).
Prüfe anhand der Fotos und der Quellen:
1. Ist der Name die Cuvée-Bezeichnung vom Vorderetikett – nicht eine Herkunfts-, Lagen- oder Vineyard-Angabe (z. B. „Vignoble de la Rivière“, „Origine“, „Estate grown“)? Bei Champagner/Schaumwein ist der Name die Cuvée („Brut Vintage“, „Rosé Vintage“, „Blanc de Blancs“, „Collection 243“).
2. Passen Name, Farbe und Rebsorten zu den Quellen? Eine offizielle Seite des Produzenten geht vor Händlerseiten.
3. Beschreiben die Quellen denselben Wein (gleiche Farbe, gleiche Cuvée)? Rosa Etikett, Quellen zu einem Weisswein = Widerspruch.
Der Produzent gehört nicht in den Namen; Jahrgang nie im Namen.
verdict: ok = Name und Produzent stimmen; correct = du korrigierst sie (name/producer = deine Fassung); conflict = Foto und Quellen widersprechen sich (name/producer = was zum Foto passt).
reason: ein kurzer Satz auf Deutsch, nur bei correct/conflict; sonst leer.`;

/** Eingabe als kurzer Text (ohne Technik). */
export function nameCheckText(input: NameCheckInput) {
  const p = input.proposal;
  const d = input.described;
  return [
    `Vorschlag: Produzent «${p.producer ?? "–"}», Name «${p.name ?? "–"}», Jahrgang ${p.vintage_year ?? "–"}, Farbe laut Foto ${COLOR_DE[input.color]}, Rebsorten ${formatShares(p.grape_shares) || "–"}.`,
    input.labelNote ? `Herkunftsangabe auf dem Etikett: «${input.labelNote}».` : null,
    d?.name || d?.color !== "unclear"
      ? `Die Quellen beschreiben: Name «${d?.name ?? "–"}», Farbe ${COLOR_DE[d?.color ?? "unclear"]}${d?.official ? `, offizielle Seite ${d.official}` : ""}.`
      : "Die Quellen nennen weder Name noch Farbe.",
    input.sources.length ? `Quellen: ${input.sources.slice(0, 5).join(", ")}` : "Keine Quellen gefunden.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Foto verkleinern (JPEG, längste Seite CHECK_IMAGE_PX); bei Fehlern das Original. */
async function smaller(img: LabelImage): Promise<LabelImage> {
  try {
    const out = await sharp(Buffer.from(img.base64, "base64"))
      .rotate()
      .resize({ width: CHECK_IMAGE_PX, height: CHECK_IMAGE_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { mediaType: "image/jpeg", base64: out.toString("base64") };
  } catch {
    return img;
  }
}

/** Prüfschritt (Sonnet 5.5, effort low). null bei Fehler, Ablehnung oder ohne Fotos. */
export async function checkLabelNames(images: LabelImage[], input: NameCheckInput): Promise<NameCheck | null> {
  if (!images.length || !input.proposal.name) return null;
  try {
    const photos = await Promise.all(images.slice(0, 4).map(smaller));
    const response = await withUsage({ purpose: "label_check" }, () =>
      anthropic().beta.messages.parse({
        model: CHECK_MODEL,
        max_tokens: CHECK_MAX_TOKENS,
        system: CHECK_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              ...photos.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
              { type: "text" as const, text: nameCheckText(input) },
            ],
          },
        ],
        output_config: { effort: "low", format: betaZodOutputFormat(NameCheckSchema) },
        ...SONNET_FALLBACK,
      }),
    );
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) return null;
    return response.parsed_output;
  } catch (error) {
    console.error("label name check failed", error instanceof Error ? error.message : error);
    return null;
  }
}
