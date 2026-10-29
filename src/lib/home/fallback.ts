// Ersatztext für Antoine auf der Startseite (rein): ohne Claude, aus kurzen Bausteinen
// (src/lib/bot/texts.ts) und den Daten zusammengesetzt – vor dem ersten Lauf, beim API-Limit
// oder bei einem Fehler. Jeder Satz nur, wenn die Daten ihn hergeben. Ohne Begrüssung – die setzt
// die App beim Anzeigen nach der Uhrzeit davor (greeting.ts). Weine als Platzhalter
// {{W1}} … wie im Text von Claude (gleiche Anzeige mit Links). Die Varianten hängen vom Tag
// und der Person ab: beim Neuladen bleibt der Text gleich.

import { HOME_TEXTS, pick } from "@/lib/bot/texts";
import { zurichParts } from "./dates";
import { seededRandom } from "./random";
import { wineLabel, type WineRef } from "./note";
import { readiness, unitKey, type StockUnit } from "./summary";

export type FallbackInput = {
  person: string | null;
  now: Date | number;
  units: StockUnit[];
  /** Offene Flaschen, älteste zuerst (Tage offen). */
  open: { wineId: string; year: number | null; days: number | null }[];
  /** Letzte Käufe, neuste zuerst. */
  recent: { wineId: string | null; year: number | null; at: string }[];
  drunkThisMonth: number;
  pendingSuggestions: number;
};

export function fallbackNote(input: FallbackInput): { text: string; refs: WineRef[] } {
  const parts = zurichParts(input.now);
  const random = seededRandom(`${parts.date}|${input.person ?? ""}`);
  const refs: WineRef[] = [];
  const byKey = new Map(input.units.map((u) => [unitKey(u.wineId, u.year), u]));
  const mentioned = new Set<string>();
  /** Platzhalter für einen Wein im Bestand (null, wenn er nicht mehr da ist). */
  const ref = (wineId: string | null, year: number | null) => {
    const unit = wineId ? byKey.get(unitKey(wineId, year)) : undefined;
    if (!unit) return null;
    const key = unitKey(unit.wineId, unit.year);
    let r = refs.find((x) => unitKey(x.wine_id, x.vintage_year) === key);
    if (!r) {
      r = { ref: `W${refs.length + 1}`, wine_id: unit.wineId, vintage_year: unit.year, name: wineLabel(unit.name, unit.year) };
      refs.push(r);
    }
    mentioned.add(key);
    return `{{${r.ref}}}`;
  };

  const sentences: string[] = [];
  const sealed = input.units.filter((u) => u.sealed > 0);
  const bottles = sealed.reduce((n, u) => n + u.sealed, 0);
  const wines = new Set(sealed.map((u) => u.wineId)).size;
  if (bottles > 0) sentences.push(pick(HOME_TEXTS.stock, random)(bottles, wines));
  else if (!input.open.length) sentences.push(pick(HOME_TEXTS.stockEmpty, random));

  const ready = readiness(input.units);
  if (ready.overdue.length) {
    const w = ref(ready.overdue[0].wineId, ready.overdue[0].year)!;
    sentences.push(ready.overdueBottles === 1 ? pick(HOME_TEXTS.overdueOne, random)(w) : pick(HOME_TEXTS.overdueMany, random)(ready.overdueBottles, w));
  }
  const now = ready.now.find((u) => !mentioned.has(unitKey(u.wineId, u.year)));
  if (now) sentences.push(pick(HOME_TEXTS.now, random)(ref(now.wineId, now.year)!));

  // Offen seit mindestens 3 Tagen: bald austrinken.
  const oldOpen = input.open.find((o) => o.days != null && o.days >= 3);
  const openRef = oldOpen ? ref(oldOpen.wineId, oldOpen.year) : null;
  if (oldOpen && openRef) sentences.push(pick(HOME_TEXTS.openOld, random)(openRef, oldOpen.days!));

  // Zuletzt gekauft (in den letzten 14 Tagen), noch im Bestand und noch nicht genannt.
  const cutoff = new Date(Number(new Date(input.now)) - 14 * 86_400_000).toISOString();
  const fresh = input.recent.find((p) => p.at >= cutoff && p.wineId && byKey.has(unitKey(p.wineId, p.year)) && !mentioned.has(unitKey(p.wineId, p.year)));
  if (fresh) sentences.push(pick(HOME_TEXTS.recent, random)(ref(fresh.wineId, fresh.year)!));

  if (input.drunkThisMonth > 0) sentences.push(pick(HOME_TEXTS.drunkMonth, random)(input.drunkThisMonth));
  if (input.pendingSuggestions > 0) sentences.push(pick(HOME_TEXTS.suggestions, random)(input.pendingSuggestions));
  sentences.push(pick(HOME_TEXTS.closing, random));
  return { text: sentences.join(" "), refs };
}
