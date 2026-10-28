// Ablaufdatum („mindestens haltbar bis“, „best before“, „à consommer de préférence avant“, …)
// vom Etikett bzw. aus Bild-/Freitext (rein, ohne DB). Alkoholfreie Weine und manche
// Schaumweine haben eins, oft nur mit Monat und Jahr. Nur klar Lesbares zählt – sonst nichts.
// Gespeichert als drink_until_year (Jahr) und Satz „Haltbar bis …“ in wine_vintages.notes.

/** Im Zustand der Erfassung: „2028-09“ (nur Monat) bzw. „2027-05-31“ (mit Tag). */
export type BestBefore = { year: number; month: number; day: number | null };

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Monatsnamen und Abkürzungen (de, en, fr, es, it, nl) → 1–12. */
const MONTH_WORDS: [RegExp, number][] = [
  [/^(jan|janv|janvier|januar|january|jänner|jaenner|enero|ene|gennaio|gen|januari)\.?$/, 1],
  [/^(feb|febr|fév|fev|févr|fevr|février|fevrier|februar|february|febrero|febbraio|februari)\.?$/, 2],
  [/^(mar|mär|maer|mrz|märz|maerz|march|mars|marzo|maart)\.?$/, 3],
  [/^(apr|avr|avril|april|abril|abr|aprile)\.?$/, 4],
  [/^(may|mai|mayo|maggio|mag|mei)\.?$/, 5],
  [/^(jun|juin|juni|june|junio|giugno|giu)\.?$/, 6],
  [/^(jul|juil|juillet|juli|july|julio|luglio|lug)\.?$/, 7],
  [/^(aug|août|aout|august|agosto|ago|augustus)\.?$/, 8],
  [/^(sep|sept|september|septembre|septiembre|settembre|set)\.?$/, 9],
  [/^(oct|okt|october|oktober|octobre|octubre|ottobre|ott)\.?$/, 10],
  [/^(nov|november|novembre|noviembre)\.?$/, 11],
  [/^(dec|dez|déc|december|dezember|décembre|decembre|diciembre|dic|dicembre)\.?$/, 12],
];

const monthFromWord = (word: string) => MONTH_WORDS.find(([re]) => re.test(word.toLowerCase()))?.[1] ?? null;

/** Zweistellige Jahre: 00–79 → 2000er (Ablaufdaten liegen nahe), sonst 1900er. */
const fullYear = (y: string) => (y.length === 2 ? (Number(y) < 80 ? 2000 + Number(y) : 1900 + Number(y)) : Number(y));

function valid(bb: BestBefore): BestBefore | null {
  if (!(bb.year >= 1990 && bb.year <= 2100) || !(bb.month >= 1 && bb.month <= 12)) return null;
  if (bb.day != null) {
    const date = new Date(Date.UTC(bb.year, bb.month - 1, bb.day));
    if (date.getUTCMonth() !== bb.month - 1 || date.getUTCDate() !== bb.day) return null;
  }
  return bb;
}

/**
 * Ein Datum ohne Stichwort lesen: „2028-09“, „2027-05-31“, „31.05.27“, „31/05/2027“, „09/2028“,
 * „10.2025“, „SEP 2028“, „September 2028“, „sept. 2028“. Unklar (z. B. „5/6/27“ ist eindeutig
 * Tag/Monat, „2028“ allein nicht) → null.
 */
export function parseBestBefore(raw: string | null | undefined): BestBefore | null {
  const t = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) return valid({ year: Number(m[1]), month: Number(m[2]), day: m[3] ? Number(m[3]) : null });
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) return valid({ year: fullYear(m[3]), month: Number(m[2]), day: Number(m[1]) });
  m = t.match(/^(\d{1,2})[./-](\d{4})$/);
  if (m) return valid({ year: Number(m[2]), month: Number(m[1]), day: null });
  m = t.match(/^(\d{1,2})\.? ?([\p{L}.]+) (\d{4})$/u);
  if (m && monthFromWord(m[2])) return valid({ year: Number(m[3]), month: monthFromWord(m[2])!, day: Number(m[1]) });
  m = t.match(/^([\p{L}.]+)[ /-]?(\d{4})$/u);
  if (m && monthFromWord(m[1])) return valid({ year: Number(m[2]), month: monthFromWord(m[1])!, day: null });
  return null;
}

/** Stichwörter vor dem Datum (de, en, fr, es, it, nl, pt). */
const KEYWORD =
  /(?:mindestens\s+haltbar\s+bis(?:\s+ende)?|haltbar\s+bis(?:\s+ende)?|zu\s+verbrauchen\s+bis|mhd|best\s+before(?:\s+end)?|best\s+by|use\s+by|bbe|à\s+consommer\s+de\s+préférence\s+avant(?:\s+(?:le|fin))?|a\s+consommer\s+de\s+preference\s+avant(?:\s+(?:le|fin))?|à\s+consommer\s+avant|consumir\s+preferentemente\s+antes\s+(?:del?|de\s+fin\s+de)|consumir\s+preferentemente\s+antes\s+de|consumir\s+antes\s+de|da\s+consumarsi\s+preferibilmente\s+entro(?:\s+(?:il|fine))?|ten\s+minste\s+houdbaar\s+tot(?:\s+eind)?|consumir\s+de\s+preferência\s+antes\s+de)\s*:?\s*/giu;

/** Ablaufdatum im Bild- oder Freitext („haltbar bis 09/2028“). Mehrere verschiedene → null. */
export function bestBeforeInText(text: string | null | undefined): BestBefore | null {
  const t = (text ?? "").replace(/\s+/g, " ");
  const found = new Map<string, BestBefore>();
  for (const m of t.matchAll(KEYWORD)) {
    const rest = t.slice((m.index ?? 0) + m[0].length);
    // Längste lesbare Form zuerst (mit Tag vor nur Monat).
    const candidate = rest.match(/^(\d{4}-\d{1,2}(?:-\d{1,2})?|\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})(?!\d)|\d{1,2}[./-]\d{4}|\d{1,2}\.? ?[\p{L}]+\.? \d{4}|[\p{L}]+\.?[ /-]?\d{4})/u)?.[1];
    const bb = parseBestBefore(candidate);
    if (bb) found.set(toBestBeforeValue(bb), bb);
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

/** Für den Zustand: „2028-09“ bzw. „2027-05-31“. */
export function toBestBeforeValue(bb: BestBefore) {
  const mm = String(bb.month).padStart(2, "0");
  return bb.day == null ? `${bb.year}-${mm}` : `${bb.year}-${mm}-${String(bb.day).padStart(2, "0")}`;
}

/** In der Genauigkeit des Etiketts: „31.05.27“ bzw. „September 2028“. */
export function formatBestBefore(bb: BestBefore) {
  if (bb.day == null) return `${MONTHS_DE[bb.month - 1]} ${bb.year}`;
  return `${String(bb.day).padStart(2, "0")}.${String(bb.month).padStart(2, "0")}.${String(bb.year).slice(-2)}`;
}

/** Satz für wine_vintages.notes. */
export const bestBeforeSentence = (bb: BestBefore) => `Haltbar bis ${formatBestBefore(bb)}`;

/** Abgelaufen? Nur Monat: nach dem letzten Tag dieses Monats. today = „YYYY-MM-DD“. */
export function isExpired(bb: BestBefore, today: string) {
  const last = bb.day ?? new Date(Date.UTC(bb.year, bb.month, 0)).getUTCDate();
  return toBestBeforeValue({ ...bb, day: last }) < today;
}

/** Satz an eine bestehende Notiz hängen (nichts überschreiben, nichts doppelt). */
export function appendNote(existing: string | null | undefined, sentence: string) {
  const before = existing?.trim();
  if (!before) return sentence;
  if (before.includes(sentence)) return before;
  return `${before}\n${sentence}`;
}
