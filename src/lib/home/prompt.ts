// Antoines Tagestext (rein): kompakte Zusammenfassung der Daten als Eingabe für Claude, die Texte
// der letzten 7 Tage (nicht wiederholen) und das Antwort-Schema. Weine nur über Kürzel W1 … aus
// der mitgegebenen Liste – so kann Claude keine Weine erfinden, und die App macht Links daraus.

import { z } from "zod";
import { WINE_TYPE_LABELS, type WineType } from "@/lib/format";
import { DRINK_STATUS_LABELS } from "@/lib/cellar/overview";
import { daysBefore, season, weekdayName, zurichParts } from "./dates";
import type { WineRef } from "./note";
import { unitKey, type DrunkItem, type PersonRating, type StockUnit, type TypeCount } from "./summary";

/** Antwort von Claude: nur der Text (ohne nullable/Union-Felder). */
export const DailyNoteSchema = z.object({
  text: z.string().describe("Antoines Text, 4–8 Sätze; Weine nur als Platzhalter {{W1}}, {{W2}} … aus der Liste"),
});

export type NoteRow = { note_date: string; status: string; text: string | null };

/** Die Texte der letzten 7 Tage vor heute (fertige, neuste zuerst) – gegen Wiederholungen. */
export function recentNotes(rows: NoteRow[], today: string): { date: string; text: string }[] {
  const from = daysBefore(today, 7);
  return rows
    .filter((r) => r.status === "done" && r.text && r.note_date < today && r.note_date >= from)
    .sort((a, b) => b.note_date.localeCompare(a.note_date))
    .slice(0, 7)
    .map((r) => ({ date: r.note_date, text: r.text! }));
}

export type PromptInput = {
  person: string;
  now: Date | number;
  refs: WineRef[];
  units: StockUnit[];
  totals: { bottles: number; wines: number; open: number };
  drunkMonth: { total: number; byType: TypeCount[]; wines: DrunkItem[] };
  drunkYear: number;
  /** keep: Likörwein „offen gut bis 25.11. · bald trinken“. */
  open: { wineId: string; year: number | null; days: number | null; keep?: string | null }[];
  recent: { wineId: string | null; year: number | null; at: string; name: string | null }[];
  ratings: PersonRating[];
  tastedThisMonth: number;
  pendingSuggestions: number;
  previous: { date: string; text: string }[];
};

const typeName = (t: WineType | "unknown" | null) => (t && t !== "unknown" ? WINE_TYPE_LABELS[t] : "unbekannt");
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const DAILY_SYSTEM = `Du bist Antoine, der persönliche Sommelier einer privaten Weinsammlung in der Schweiz. Du schreibst jeden Morgen einen kurzen, persönlichen Text für die Startseite der App.

Stil:
- Ich-Form, du, Schweizer Schreibweise (ss statt ß), warm und natürlich, nie technisch, keine Floskeln, keine Aufzählungen, keine Überschriften, höchstens ein Emoji.
- 4–8 Sätze in einem Absatz.
- Keine Begrüssung und keine Tageszeit: Der Text entsteht frühmorgens und steht den ganzen Tag da; die App setzt die Begrüssung mit dem Namen selbst davor. Also kein „Guten Morgen“, „Guten Tag“, „Guten Abend“, „Hallo“, „Grüezi“ und keine Anrede am Anfang – beginne direkt mit dem Inhalt. Keine Tageszeit-Bezüge wie „heute Morgen“, „heute Nachmittag“, „heute Abend“, „heute Nacht“. Wochentag und Jahreszeit sind erlaubt.
- Trinkvorschläge neutral formulieren, z. B. „für einen der nächsten Abende“ oder „wenn du Lust hast“, nicht „heute Abend“.

Inhalt:
- Nimm Bezug auf Wochentag oder Jahreszeit und auf den Keller: was über dem Höhepunkt ist oder jetzt getrunken werden sollte, was zuletzt dazukam, was diesen Monat getrunken wurde, lange offene Flaschen, Likörweine und Liköre, die offen bald über der Zeit sind („offen gut bis …“, „bald trinken“, „über der Zeit“), offene Vorschläge zum Prüfen – wähle aus, was heute passt, nicht alles.
- Mach 1–3 konkrete Trinkvorschläge, passend zu den Vorlieben der Person (ihre Bewertungen, Stil hoch bewerteter Weine) und zur Jahreszeit.

Ehrlichkeit:
- Sag nur, was die Daten unten hergeben. Erfinde nichts: keine Preise, Bewertungen, Aromen, Speisen oder Eigenschaften, die nicht in den Daten stehen. Steht bei einem Wein kein Stil, beschreib ihn nicht.
- Weine nennst du ausschliesslich als Platzhalter {{W1}}, {{W2}} … aus der Liste „Weine im Keller“ – nie den Namen ausschreiben, nie ein Kürzel, das nicht in der Liste steht. Die App zeigt daraus den Namen mit Jahrgang. Vorschläge nur aus dieser Liste.

Abwechslung:
- Du bekommst deine Texte der letzten Tage. Wiederhole weder Formulierungen noch Satzanfänge noch die dort vorgeschlagenen Weine.`;

/** Kompakte Zusammenfassung (Text) – was Claude über den Keller weiss. */
export function dailyPrompt(input: PromptInput): string {
  const p = zurichParts(input.now);
  const byKey = new Map(input.units.map((u) => [unitKey(u.wineId, u.year), u]));
  const refOf = new Map(input.refs.map((r) => [unitKey(r.wine_id, r.vintage_year), r.ref]));
  const ratingOf = new Map(input.ratings.map((r) => [unitKey(r.wineId, r.year), r]));
  const openOf = new Map(input.open.map((o) => [unitKey(o.wineId, o.year), o.days]));
  const keepOf = new Map(input.open.map((o) => [unitKey(o.wineId, o.year), o.keep ?? null]));
  const lines: string[] = [];
  lines.push(`Person: ${input.person}`);
  lines.push(`Heute: ${weekdayName(p.weekday)}, ${p.day}. ${MONTHS[p.month - 1]} ${p.year}, ${season(p.month)}`);
  lines.push(`Keller: ${input.totals.bottles} ungeöffnete Flaschen, ${input.totals.wines} Weine, ${input.totals.open} offen`);

  lines.push("", "Weine im Keller (Kürzel: Name Jahrgang · Typ · Produzent · Flaschen · Trinkreife · weitere Angaben):");
  for (const r of input.refs) {
    const u = byKey.get(unitKey(r.wine_id, r.vintage_year));
    if (!u) continue;
    const bits = [typeName(u.type), u.producer, u.sealed ? `${u.sealed} Fl. ungeöffnet` : null, DRINK_STATUS_LABELS[u.status]];
    const days = openOf.get(unitKey(u.wineId, u.year));
    const keep = keepOf.get(unitKey(u.wineId, u.year));
    if (u.open) bits.push(`offen${days != null ? ` seit ${days} Tagen` : ""}${keep ? ` (${keep})` : ""}`);
    if (u.lastPurchase) bits.push(`gekauft ${u.lastPurchase}`);
    const rating = ratingOf.get(unitKey(u.wineId, u.year));
    if (rating) bits.push(`${input.person}: ${rating.rating} von 5`);
    if (rating?.styleSummary) bits.push(`Stil: ${rating.styleSummary}`);
    lines.push(`${r.ref}: ${r.name} · ${bits.filter(Boolean).join(" · ")}`);
  }

  const recent = input.recent.slice(0, 5).map((r) => `${r.name ?? "?"}${r.year ? ` ${r.year}` : ""} (${r.at.slice(0, 10)}${r.wineId && refOf.get(unitKey(r.wineId, r.year)) ? `, ${refOf.get(unitKey(r.wineId, r.year))}` : ""})`);
  if (recent.length) lines.push("", `Zuletzt eingebucht: ${recent.join("; ")}`);

  const m = input.drunkMonth;
  lines.push("", m.total ? `Getrunken diesen Monat: ${m.total} Fl. (${m.byType.map((t) => `${t.bottles} ${typeName(t.type)}`).join(", ")}): ${[...new Set(m.wines.map((w) => `${w.name}${w.year ? ` ${w.year}` : ""}`))].slice(0, 8).join("; ")}` : "Getrunken diesen Monat: noch nichts");
  lines.push(`Getrunken dieses Jahr: ${input.drunkYear} Fl.`);
  if (input.tastedThisMonth) lines.push(`Verkostet diesen Monat (unterwegs): ${input.tastedThisMonth}`);
  if (input.pendingSuggestions) lines.push(`Offene Vorschläge zum Prüfen (Seite Recherche): ${input.pendingSuggestions}`);

  const liked = [...input.ratings].filter((r) => r.rating >= 4).sort((a, b) => b.rating - a.rating).slice(0, 8);
  if (liked.length) {
    lines.push("", `Hoch bewertet von ${input.person}:`);
    for (const r of liked) lines.push(`- ${r.name}${r.year ? ` ${r.year}` : ""}: ${r.rating} von 5${r.styleSummary ? ` · Stil: ${r.styleSummary}` : ""}`);
  } else lines.push("", `Bewertungen von ${input.person}: noch keine hohen`);

  if (input.previous.length) {
    lines.push("", "Deine Texte der letzten Tage (nicht wiederholen – andere Formulierungen, andere Weine):");
    for (const n of input.previous) lines.push(`${n.date}: ${n.text}`);
  }
  return lines.join("\n");
}
