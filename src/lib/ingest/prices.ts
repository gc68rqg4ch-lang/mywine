// Preise beim Einbuchen aus Bild- oder Freitext (rein, ohne DB): bezahlt und Normalpreis.
// „Aktion 49 statt 66“ bzw. „bezahlt 49, normal 66“ → beide; „Normalpreis 66“ → nur Normalpreis;
// ein einzelner Preis („66 Franken“, „CHF 24.50“) gilt als bezahlt. Zahlen ohne Währung oder
// Stichwort (Anzahl, Jahrgang) zählen nicht.

import { parseAmount } from "@/lib/format";

const NUM = String.raw`(\d{1,3}(?:['’]\d{3})+(?:[.,]\d{1,2})?|\d{1,5}(?:[.,]\d{1,2})?)(?:\.[-–])?`;
const CUR = String.raw`(?:chf|sfr\.?|fr\.?|franken|stutz)`;

const STATT = new RegExp(String.raw`${NUM}\s*${CUR}?\s*(?:statt|anstatt|anstelle von|instead of)\s*${CUR}?\s*${NUM}`, "i");
const PAID = new RegExp(String.raw`(?:bezahlt|gezahlt|kaufpreis|aktionspreis|aktion)\D{0,12}?${NUM}`, "i");
const REGULAR = new RegExp(String.raw`(?:normal\p{L}*|regulär\p{L}*|uvp|listenpreis|neupreis)\D{0,12}?${NUM}`, "iu");
const MONEY = new RegExp(String.raw`${CUR}\s*${NUM}|${NUM}\s*${CUR}(?![a-z])`, "gi");

/** Stichwort für den Normalpreis im Text (dann ist ein einzelner Preis kein Kaufpreis). */
export const REGULAR_HINT = /\b(normal\p{L}*|regulär\p{L}*|uvp|listenpreis|neupreis|statt)\b/iu;

export type TextPrices = { paid: number | null; regular: number | null };

/** Bezahlt und Normalpreis im Text; null = nicht (eindeutig) genannt. */
export function pricesInText(text: string | null | undefined): TextPrices {
  const t = (text ?? "").trim();
  const none: TextPrices = { paid: null, regular: null };
  if (!t) return none;
  const amount = (s: string | undefined) => (s ? parseAmount(s) : null);
  const statt = t.match(STATT);
  if (statt) return { paid: amount(statt[1]), regular: amount(statt[2]) };
  const paid = amount(t.match(PAID)?.[1]);
  const regular = amount(t.match(REGULAR)?.[1]);
  if (paid != null || regular != null) return { paid, regular };
  // Ohne Stichwort: genau ein Betrag mit Währung → bezahlt.
  const amounts = [...new Set([...t.matchAll(MONEY)].map((m) => amount(m[1] ?? m[2])).filter((v): v is number => v != null))];
  return amounts.length === 1 ? { paid: amounts[0], regular: null } : none;
}
