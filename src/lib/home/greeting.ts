// Begrüssung vor Antoines Text (rein): nach der Uhrzeit beim Anzeigen in Europe/Zurich – der
// Tagestext entsteht frühmorgens und bleibt den ganzen Tag stehen. Gespeicherte Texte, die noch
// selbst begrüssen („Guten Morgen Michel, …“), verlieren diese Begrüssung beim Anzeigen.

import { HOME_TEXTS, pick } from "@/lib/bot/texts";
import { zurichParts } from "./dates";
import { seededRandom } from "./random";

export type GreetingSlot = "morning" | "day" | "evening" | "late";

/** 05–11 Morgen, 11–17 Tag, 17–22 Abend, 22–05 spät (volle Stunde in Zürich). */
export function greetingSlot(hour: number): GreetingSlot {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "late";
}

/** „Guten Abend, Michel.“ – Variante fest je Tag, Tageszeit und Person (Server und Browser gleich). */
export function greetingText(person: string | null, at: Date | number) {
  const p = zurichParts(at);
  const slot = greetingSlot(p.hour);
  const random = seededRandom(`${p.date}|${slot}|${person ?? ""}`);
  return person ? pick(HOME_TEXTS.greeting[slot], random)(person) : pick(HOME_TEXTS.greetingAnonymous[slot], random);
}

// Grussworte am Textanfang; nur der erste Buchstabe je Wort beliebig gross/klein (der Name danach
// muss gross beginnen – ein Flag „i“ würde auch kleine Wörter als Namen nehmen).
const word = (w: string) => w.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => `${sp}[${c.toUpperCase()}${c.toLowerCase()}]`);
const GREETINGS = [
  ...["guten", "gute", "schönen guten", "schöne", "schönen"].flatMap((g) => ["morgen", "tag", "mittag", "nachmittag", "abend"].map((t) => `${g} ${t}`)),
  "hallo", "hoi", "hey", "grüezi", "grüessech", "grüss dich", "servus", "salü", "salut", "guete morge", "guete abig", "bonjour", "bonsoir", "buongiorno", "buonasera",
]
  .sort((x, y) => y.length - x.length)
  .map((g) => word(g).replace(/ /g, "\\s+"))
  .join("|");
/** Begrüssung + optional Name (1–2 Wörter, gross geschrieben) + Satzzeichen bzw. Gedankenstrich am Textanfang. */
const LEADING = new RegExp(`^\\s*(?:${GREETINGS})(?:,?\\s+(?:[Ll]iebe[r]?\\s+)?\\p{Lu}[\\p{L}'-]*(?:\\s+\\p{Lu}[\\p{L}'-]*)?)?\\s*(?:[,.!;:]+|\\s[–—-])\\s*`, "u");

/** Führende Begrüssung entfernen (gespeicherte Texte von früher); Rest beginnt gross. */
export function stripGreeting(text: string) {
  const rest = text.replace(LEADING, "");
  if (rest === text || !rest.trim()) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
