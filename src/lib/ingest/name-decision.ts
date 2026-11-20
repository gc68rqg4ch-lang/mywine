// Auswertung des Prüfschritts der Namen (rein, ohne Netz): Muss Antoine nachfragen? Welche
// Varianten zeigt er? Wie tief wird die confidence gesetzt?
// - Nachfragen, wenn der Prüfschritt den Namen bzw. Produzenten ändert oder einen Widerspruch
//   meldet – und auch ohne Prüfschritt, wenn die Farbe laut Foto der Farbe der Quellen widerspricht
//   (z. B. rosa Etikett, Quellen zu einem Weisswein).
// - Bei Widerspruch höchstens NAME_CHECK_MAX_CONFIDENCE.
// - Sonst: keine zusätzliche Frage.

import { z } from "zod";
import { foldText } from "@/lib/text/fold";
import { sameProducer } from "@/lib/producers/match";
import { T } from "@/lib/bot/texts";
import type { WineColor, WineProposal } from "./schema";

export const NAME_CHECK_MAX_CONFIDENCE = 0.7;

const COLORS = ["white", "rose", "red", "unclear"] as const;

export const NameCheckSchema = z.object({
  verdict: z.enum(["ok", "correct", "conflict"]).describe("ok = stimmt; correct = korrigiert; conflict = Foto und Quellen widersprechen sich"),
  name: z.string().describe("Weinname (Cuvée) ohne Produzent und Jahrgang – bei ok der Vorschlag, sonst deine Fassung"),
  producer: z.string().describe("Produzent – bei ok der Vorschlag, sonst deine Fassung"),
  color: z.enum(COLORS).describe("Farbe laut Foto: white, rose, red, unclear"),
  reason: z.string().describe("Ein kurzer Satz auf Deutsch, warum (bei correct/conflict); sonst leer"),
});
export type NameCheck = z.infer<typeof NameCheckSchema>;

export type NameCheckInput = {
  proposal: Pick<WineProposal, "name" | "producer" | "vintage_year" | "type" | "grape_shares">;
  /** Farbe laut Foto (Erkennung). */
  color: WineColor;
  /** Herkunfts-/Lagenangabe vom Etikett, die kein Name ist. */
  labelNote?: string | null;
  /** Was die Quellen der Recherche beschreiben. */
  described?: { name: string | null; color: WineColor; official: string | null } | null;
  sources: string[];
};

export type NameVariant = { name: string; producer: string | null };

export type NameDecision =
  | { ask: false }
  | {
      ask: true;
      /** Varianten zur Auswahl: zuerst die Erkennung, dann die Korrektur bzw. was die Quellen nennen. */
      variants: NameVariant[];
      reason: string;
      /** Widerspruch (Foto ↔ Quellen) bzw. geänderter Name → confidence höchstens 0.7. */
      maxConfidence: number;
    };

const sameName = (a: string | null | undefined, b: string | null | undefined) => foldText(a) === foldText(b);

const COLOR_LOOK: Record<WineColor, string> = { white: "weiss", rose: "rosa", red: "rot", unclear: "unklar" };
const COLOR_WINE: Record<WineColor, string> = { white: "Weisswein", rose: "Rosé", red: "Rotwein", unclear: "Wein" };

/** Farben widersprechen sich (beide bekannt und verschieden)? */
export const colorsConflict = (a: WineColor | null | undefined, b: WineColor | null | undefined) =>
  !!a && !!b && a !== "unclear" && b !== "unclear" && a !== b;

/** Muss nachgefragt werden – und mit welchen Varianten? check null = Prüfschritt ohne Ergebnis. */
export function decideNameCheck(input: NameCheckInput, check: NameCheck | null): NameDecision {
  const p = input.proposal;
  if (!p.name) return { ask: false };
  const original: NameVariant = { name: p.name, producer: p.producer };
  const variants: NameVariant[] = [original];
  const add = (v: NameVariant) => {
    if (!v.name.trim()) return;
    if (variants.some((x) => sameName(x.name, v.name) && (sameProducer(x.producer, v.producer) || !x.producer || !v.producer))) return;
    variants.push({ name: v.name.trim(), producer: v.producer?.trim() || null });
  };

  // Widerspruch der Farben im Code (unabhängig vom Prüfschritt): Foto ↔ Quellen.
  const photoColor = check && check.color !== "unclear" ? check.color : input.color;
  const colorConflict = colorsConflict(photoColor, input.described?.color);

  const corrected =
    check &&
    check.verdict !== "ok" &&
    (!sameName(check.name, p.name) || (!!check.producer.trim() && !!p.producer && !sameProducer(check.producer, p.producer)));
  if (corrected) add({ name: check.name, producer: check.producer.trim() || p.producer });
  const conflict = colorConflict || check?.verdict === "conflict";
  // Bei Widerspruch auch die Fassung der Quellen zeigen (z. B. „Brut Vintage“ neben „Rosé Vintage“).
  if (conflict && input.described?.name) add({ name: input.described.name, producer: p.producer });

  if (!corrected && !conflict) return { ask: false };
  const reason =
    check?.reason.trim() ||
    (colorConflict ? T.nameCheckColor(COLOR_LOOK[photoColor], COLOR_WINE[input.described!.color]) : T.nameCheckCorrected);
  return { ask: true, variants: variants.slice(0, 3), reason: reason.slice(0, 300), maxConfidence: NAME_CHECK_MAX_CONFIDENCE };
}

/** Nur Wein (keine Spirituose bzw. unklare Art) mit Namen wird geprüft. */
export const needsNameCheck = (p: Pick<WineProposal, "name" | "type">) => Boolean(p.name) && p.type !== "spirit" && p.type != null;
