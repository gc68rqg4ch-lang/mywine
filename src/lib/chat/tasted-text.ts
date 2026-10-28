// „Verkostet“ im Bot – reine Hilfen ohne DB: Absicht erkennen (gekauft oder nur verkostet),
// Ankündigung („wir verkosten einen Wein“), Preis aus einer Antwort lesen.

import { PENDING_TTL_MS } from "./ttl";
import { parseAmount } from "@/lib/format";
import type { Currency, PriceUnit } from "@/lib/edit/types";

/** So lange gilt „wir verkosten gleich einen Wein“ für das nächste Foto bzw. die nächste Nachricht. */
export const TASTED_WINDOW_MS = PENDING_TTL_MS;

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Hinweise auf „nur verkostet“ (Restaurant, Bar, probiert, trinken gerade …). */
const TASTED_HINTS =
  /verkost|probier|degust|im restaurant|in der bar|in einer bar|im glas|glasweise|beim essen|bei freunden|zum (znacht|zmittag|essen|apero)|trinken (gerade|grad|jetzt)|trinke (gerade|grad|jetzt)|wir trinken|getrunken (im|in|bei)|weinkarte|offen ausgeschenkt/;
/** Hinweise auf einen Kauf (Bestand). */
const BOUGHT_HINTS =
  /gekauft|nachgekauft|eingekauft|bestellt|einbuchen|\bkaufte\b|\d+\s*(fl\b|fl\.|flaschen)|weinkeller|wohnzimmer|in den (keller|bestand)|haendler|handler|mövenpick|movenpick/;

/**
 * Absicht aus Bildtext oder Nachricht: „tasted“, „bought“ oder null (unklar → nachfragen).
 * Widersprüchliche Hinweise gelten als unklar.
 */
export function tastedIntent(text: string | null | undefined): "tasted" | "bought" | null {
  if (!text?.trim()) return null;
  const t = norm(text);
  const tasted = TASTED_HINTS.test(t);
  const bought = BOUGHT_HINTS.test(t);
  if (tasted === bought) return null;
  return tasted ? "tasted" : "bought";
}

/**
 * „Wir verkosten einen Wein“, „ich probiere gleich einen“: Ankündigung ohne den Wein selbst.
 * Das nächste Foto bzw. die nächste Nachricht (innert 10 Min.) gilt dann als verkostet.
 */
export function announcesTasting(text: string) {
  const t = norm(text).replace(/[\s.!?…😀-🙏🍷🥂]+$/u, "");
  if (t.length > 80 || /\d{4}/.test(t)) return false;
  // Nur ohne konkreten Wein: „… einen (Wein)“ am Ende – „ich trinke gerade den Palermo“ ist keine Ankündigung.
  const verb = "(verkoste|probiere|degustiere)n?";
  return (
    new RegExp(`\\b(wir|ich)\\b.*\\b${verb}\\b.*\\b(einen|ein|eine)( (neuen|feinen|weiteren))?( (wein|rotwein|weisswein|rose|schaumwein))?$`).test(t) ||
    new RegExp(`\\b(wir|ich)\\b.*\\b(einen|ein|eine) (wein|rotwein|weisswein)\\b.*\\b${verb}$`).test(t)
  );
}

/** Preis aus einer Antwort: „120“, „14 Glas“, „90 EUR die Flasche“, „AED 65“. */
export function parseEncounterPrice(text: string): { price: number; unit: PriceUnit; currency: Currency } | null {
  const t = norm(text);
  // Gleiche strenge Prüfung wie beim Einbuchen: Betrag über 0, nicht negativ.
  const price = parseAmount(t);
  if (price == null) return null;
  const currency: Currency = /\b(aed|dirham|dhs?)\b/.test(t) ? "AED" : /\b(eur|euro)\b|€/.test(t) ? "EUR" : "CHF";
  const unit: PriceUnit = /glas/.test(t) ? "glass" : "bottle";
  return { price, unit, currency };
}
