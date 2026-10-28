// Text für Vergleiche und Suche: ohne Akzente, klein, ß = ss, Satzzeichen als Leerzeichen
// („Peñafiel“ → „penafiel“, „Cuvée Spéciale“ → „cuvee speciale“, „Saint-Émilion“ → „saint emilion“).

export function foldText(text: string | null | undefined) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
