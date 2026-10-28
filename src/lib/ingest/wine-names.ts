// Weinnamen (rein, ohne DB): unvollständige Namen ergänzen und bestehende Weine trotz anderer
// Schreibweise finden. Bestehende Weine heissen meist „<Produzent/Marke> <Stufe>“ („Protos
// Reserva“, „Legaris Reserva“). Zeigt das Etikett nur die Stufe („Reserva“), gehört die Marke
// davor. Abgleich: Gross-/Kleinschreibung, Akzente, Satzzeichen, Füllwörter (de, la, …) und
// Zusätze wie Bodegas oder Quinta egal; Name mit und ohne vorangestellten Produzenten gleich.

/** Qualitäts-/Reifestufen und Gattungswörter – allein kein vollständiger Weinname. */
const GENERIC = new Set([
  "reserva", "gran", "grande", "grand", "riserva", "crianza", "reserve", "vin", "vino", "cuvee", "tinto", "tinta",
  "rosso", "rouge", "blanco", "branco", "bianco", "blanc", "rosado", "rosato", "rose", "roble", "joven", "especial",
  "seleccion", "selection", "selezione", "superiore", "classico", "cru", "premier", "brut", "red", "white", "wine",
]);

/** Füllwörter – beim Vergleich egal. */
const FILLERS = new Set(["de", "da", "do", "das", "dos", "la", "le", "les", "el", "los", "las", "di", "del", "della", "du", "des", "the", "y", "e", "et", "and", "und"]);

/** Zusätze vor bzw. nach dem eigentlichen Namen des Produzenten – beim Vergleich egal. */
const HOUSE_WORDS = new Set([
  "bodegas", "bodega", "quinta", "chateau", "weingut", "winery", "wineries", "cellars", "cellar", "vineyards", "vineyard",
  "domaine", "tenuta", "cantina", "cantine", "herdade", "estate", "weinkellerei", "kellerei", "vinedos", "vinas",
]);

const words = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Nur Stufe bzw. Gattungswort („Reserva“, „Gran Reserva“, „Grand Vin“, „Cuvée“, „Tinto“)? */
export function isGenericName(name: string | null | undefined) {
  const w = words(name).filter((t) => !FILLERS.has(t));
  return w.length > 0 && w.every((t) => GENERIC.has(t));
}

/** Produzent als Marke vor dem Namen: ohne vorangestelltes „Bodegas/Bodega/Weingut“. */
function brand(producer: string) {
  return producer.trim().replace(/\s+/g, " ").replace(/^(bodegas?|weingut)\s+(?=\S)/i, "");
}

/**
 * Vollständiger Name: besteht der Name nur aus einer Stufe bzw. einem Gattungswort, kommt der
 * Produzent bzw. die Marke davor („Reserva“ + „Legaris“ → „Legaris Reserva“). Steht die Marke
 * schon drin bzw. fehlt der Produzent: unverändert.
 */
export function completeWineName(name: string | null, producer: string | null): string | null {
  if (!name || !producer?.trim() || !isGenericName(name)) return name;
  const b = brand(producer);
  return b ? `${b} ${name.trim()}` : name;
}

/** Vergleichsschlüssel: Wörter aus Produzent und Name ohne Füllwörter und Zusätze, sortiert. */
export function wineKey(name: string | null, producer: string | null) {
  const set = new Set([...words(producer), ...words(name)].filter((t) => !FILLERS.has(t) && !HOUSE_WORDS.has(t)));
  return [...set].sort().join(" ");
}

export type NamedWine = { id: string; name: string; producer: string | null };

/**
 * Bestehende Weine, die trotz anderer Schreibweise derselbe Wein sind (bis limit). „Reserva“ +
 * „Quinta da La Rosa“ ≈ „Quinta de la Rosa Reserva“ / „Quinta de la Rosa“. Andere Stufe
 * („Crianza“ statt „Reserva“) oder anderer Produzent: kein Treffer.
 */
export function similarWines<W extends NamedWine>(name: string | null, producer: string | null, wines: W[], limit = 3): W[] {
  const key = wineKey(completeWineName(name, producer), producer);
  if (!key) return [];
  return wines
    .filter((w) => wineKey(w.name, w.producer) === key)
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .slice(0, limit);
}
