// PDF im Bot einem Wein zuordnen (rein, ohne DB): aus Dateiname und Bildtext passende Weine
// und den Jahrgang finden – z. B. „2020-the-hype-cabernet-sauvignon.pdf“ → The Hype 2020.

export type MatchWine = { id: string; name: string; producer: string | null; years: (number | null)[] };
export type WineMatch = { wineId: string; name: string; producer: string | null; year: number | null; score: number };

/** Füllwörter, die allein nichts über den Wein sagen. */
const STOP = new Set(["the", "de", "la", "le", "les", "el", "los", "di", "du", "des", "del", "da", "do", "y", "et", "and", "und", "vin", "vino", "wine", "pdf", "tech", "sheet", "fiche", "technique", "ficha", "tecnica"]);

const norm = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (text: string) => norm(text).split(" ").filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));

/** Jahrgang im Text (1950 bis nächstes Jahr), z. B. „2020-the-hype“ → 2020. */
export function yearInText(text: string, now = new Date()) {
  const max = now.getFullYear() + 1;
  for (const m of norm(text).matchAll(/(?:^|\s)(19\d{2}|20\d{2})(?=\s|$)/g)) {
    const y = Number(m[1]);
    if (y >= 1950 && y <= max) return y;
  }
  return null;
}

/**
 * Passende Weine (beste zuerst): Anteil der Namenswörter im Text, Produzent zählt zusätzlich.
 * Jahrgang: der im Text, sonst der einzige bekannte des Weins, sonst null (gilt für alle Jahrgänge).
 */
export function matchWines(text: string, wines: MatchWine[], limit = 3): WineMatch[] {
  const words = new Set(tokens(text));
  const year = yearInText(text);
  const hits: WineMatch[] = [];
  for (const w of wines) {
    const name = [...new Set(tokens(w.name))];
    if (!name.length) continue;
    const found = name.filter((t) => words.has(t));
    // Mindestens ein aussagekräftiges Wort (≥ 3 Zeichen) und die Hälfte des Namens.
    if (!found.some((t) => t.length >= 3) || found.length / name.length < 0.5) continue;
    const producer = [...new Set(tokens(w.producer ?? ""))];
    const producerShare = producer.length ? producer.filter((t) => words.has(t)).length / producer.length : 0;
    const known = w.years.filter((y): y is number => y != null);
    const fitsYear = year != null && known.includes(year);
    const chosenYear = year ?? (new Set(w.years).size === 1 ? w.years[0] : null);
    hits.push({
      wineId: w.id,
      name: w.name,
      producer: w.producer,
      year: chosenYear,
      score: found.length / name.length + producerShare * 0.5 + (fitsYear ? 0.25 : 0),
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "de")).slice(0, limit);
}
