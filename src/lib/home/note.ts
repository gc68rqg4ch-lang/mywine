// Antoines Text auf der Startseite (rein): Weine stehen im Text als Platzhalter {{W1}}, {{W2}} …
// Die Zuordnung (ref → Wein + Jahrgang) wird mit dem Text gespeichert; beim Anzeigen werden
// Platzhalter zu Links „Name Jahrgang“ auf die Weinseite. Unbekannte Platzhalter fallen weg,
// Weine, die nicht mehr im Bestand sind, erscheinen als reiner Text (beides wird gemeldet).

import { wineHref } from "@/lib/cellar/wine-page";
import { unitKey, type StockUnit } from "./summary";

export type WineRef = { ref: string; wine_id: string; vintage_year: number | null; name: string };

export type NoteSegment = { kind: "text"; text: string } | { kind: "wine"; ref: string; label: string; href: string | null };

const PLACEHOLDER = /\{\{\s*(W\d{1,3})\s*\}\}/g;

export const wineLabel = (name: string, year: number | null) => (year == null ? name : `${name} ${year}`);

/** Platzhalter im Text (in Reihenfolge, ohne Doppelte). */
export const placeholdersIn = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];

/**
 * Kandidaten für Antoine: Weine mit ungeöffneten oder offenen Flaschen – zuerst über dem
 * Höhepunkt, jetzt trinken, offene (älteste zuerst), zuletzt gekauft, von der Person gut bewertet;
 * höchstens max. Jeder bekommt ein Kürzel W1 … für den Text.
 */
export function buildRefs(units: StockUnit[], liked: Set<string> = new Set(), max = 30): WineRef[] {
  const score = (u: StockUnit) =>
    (u.status === "overdue" ? 50 : u.status === "now" ? 40 : 0) + (u.open ? 30 : 0) + (liked.has(unitKey(u.wineId, u.year)) || liked.has(u.wineId) ? 20 : 0) + (u.lastPurchase ? 10 : 0);
  return [...units]
    .sort((a, b) => score(b) - score(a) || (b.lastPurchase ?? "").localeCompare(a.lastPurchase ?? "") || a.name.localeCompare(b.name, "de-CH"))
    .slice(0, max)
    .map((u, i) => ({ ref: `W${i + 1}`, wine_id: u.wineId, vintage_year: u.year, name: wineLabel(u.name, u.year) }));
}

/**
 * Text → Abschnitte. inStock: Schlüssel (unitKey) der Weine, die gerade im Bestand sind.
 * errors: was beim Anzeigen fehlte (fürs Log).
 */
export function renderNote(text: string, refs: WineRef[], inStock: Set<string>, from = "start"): { segments: NoteSegment[]; errors: string[] } {
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const segments: NoteSegment[] = [];
  const errors: string[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = segments.at(-1);
    if (prev?.kind === "text") prev.text += t;
    else segments.push({ kind: "text", text: t });
  };
  for (const m of text.matchAll(PLACEHOLDER)) {
    push(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const ref = byRef.get(m[1]);
    if (!ref) {
      errors.push(`unbekannt: ${m[1]}`);
      continue;
    }
    const stocked = inStock.has(unitKey(ref.wine_id, ref.vintage_year));
    if (!stocked) errors.push(`nicht vorrätig: ${m[1]}`);
    segments.push({ kind: "wine", ref: m[1], label: ref.name, href: stocked ? wineHref(ref.wine_id, ref.vintage_year, { von: from }) : null });
  }
  push(text.slice(last));
  // Weggefallene Platzhalter hinterlassen doppelte Leerzeichen bzw. Leerzeichen vor Satzzeichen.
  for (const s of segments) if (s.kind === "text") s.text = s.text.replace(/ {2,}/g, " ").replace(/ ([,.;:!?])/g, "$1");
  return { segments, errors };
}

/** Text ohne Platzhalter (Namen statt Links) – z. B. die Texte der letzten Tage für Claude. */
export function plainNote(text: string, refs: WineRef[]) {
  const all = new Set(refs.map((r) => unitKey(r.wine_id, r.vintage_year)));
  return renderNote(text, refs, all)
    .segments.map((s) => (s.kind === "text" ? s.text : s.label))
    .join("");
}
