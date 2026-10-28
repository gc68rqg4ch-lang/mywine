// Geschenk beim Einbuchen (rein, ohne DB): aus Bild- oder Freitext erkennen, ob es ein Geschenk
// ist und von wem („Geschenk von Marc“, „von Anna geschenkt bekommen“, „Mitbringsel von Sara“).

const NAME = String.raw`(\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){0,2})`;
// Ohne i-Flag, damit der Name gross beginnen muss („von meinem Bruder“ ist kein Name).
const AFTER = new RegExp(String.raw`(?:[Gg]eschenk|[Mm]itbringsel|[Pp]räsent)\p{L}*\s+(?:von|vom|bekommen von|erhalten von)\s+${NAME}`, "u");
const BEFORE = new RegExp(String.raw`(?:von|vom)\s+${NAME}\s+(?:geschenkt|als [Gg]eschenk|zum [Gg]eschenk|mitgebracht)`, "u");
const HINT = /\b(geschenk\w*|geschenkt|mitbringsel|präsent)\b/i;

/** Name aufräumen: getrimmt, Leerräume vereinheitlicht, höchstens 120 Zeichen; leer → null. */
export function cleanGiftFrom(name: string | null | undefined) {
  const t = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return t ? t : null;
}

/** Geschenk erkannt? from = Name, falls genannt. null = kein Hinweis auf ein Geschenk. */
export function giftInText(text: string | null | undefined): { from: string | null } | null {
  const t = (text ?? "").trim();
  if (!t || !HINT.test(t)) return null;
  const m = t.match(AFTER) ?? t.match(BEFORE);
  return { from: cleanGiftFrom(m?.[1]) };
}
