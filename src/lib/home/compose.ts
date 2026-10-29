// Startseite (rein): aus den geladenen Daten die Teile für Kacheln, Ersatztext und Prompt.

import { keepLine, keepStatus } from "@/lib/fortified/keep";
import { sameZurichMonth, zurichDay, zurichParts } from "./dates";
import type { FallbackInput } from "./fallback";
import { buildRefs, plainNote, type WineRef } from "./note";
import { recentNotes, type NoteRow, type PromptInput } from "./prompt";
import { drunkByType, openBottles, recentPurchases, stockTotals, stockUnits, unitKey, type HomeInput } from "./summary";

export type NoteContext = { fallback: FallbackInput; prompt: Omit<PromptInput, "person" | "previous" | "refs">; refs: WineRef[] };

/** Gemeinsame Grundlage für Ersatztext und Prompt. */
export function noteContext(data: HomeInput, person: string | null, now: Date | number): NoteContext {
  const p = zurichParts(now);
  // Trinkreife und Trinkvorschläge (auch im Tagestext) nur Wein – Spirituosen zählen nur im Bestand.
  // Ausnahme: offene Liköre, die bald (bzw. schon) über der Zeit sind – die darf Antoine erwähnen.
  const dueLiqueurs = data.stock
    .filter((s) => s.type === "spirit" && s.spiritOpen && s.keepDays != null)
    .filter((s) => (keepStatus(s.dateOpened ? zurichDay(s.dateOpened) : null, s.keepDays, p.date)?.status ?? "ok") !== "ok")
    .map((s) => ({ ...s, status: "open" as const }));
  const wineStock = [...data.stock.filter((s) => s.type !== "spirit"), ...dueLiqueurs];
  const units = stockUnits(wineStock, p.year);
  const totals = stockTotals(data.stock);
  // Likörweine: „offen gut bis …“ (mit „bald trinken“ bzw. „über der Zeit“).
  const open = openBottles(wineStock, p.date).map((o) => ({ wineId: o.wineId, year: o.year, days: o.days, keep: keepLine(o.keep) }));
  const recent = recentPurchases(data.purchases, 5);
  const drunk = drunkByType(data.drunk, now);
  const monthWines = data.drunk.filter((d) => sameZurichMonth(d.drunkAt, now));
  const liked = new Set(data.ratings.filter((r) => r.rating >= 4).map((r) => unitKey(r.wineId, r.year)));
  return {
    refs: buildRefs(units, liked),
    fallback: { person, now, units, open, recent, drunkThisMonth: drunk.month.total, pendingSuggestions: data.pendingSuggestions },
    prompt: {
      now,
      units,
      totals,
      drunkMonth: { ...drunk.month, wines: monthWines },
      drunkYear: drunk.year.total,
      open,
      recent,
      ratings: data.ratings,
      tastedThisMonth: data.tastedThisMonth,
      pendingSuggestions: data.pendingSuggestions,
    },
  };
}

/** Texte der letzten 7 Tage für den Prompt – mit Namen statt Platzhaltern. */
export function previousTexts(rows: (NoteRow & { wines: WineRef[] })[], today: string) {
  const byDate = new Map(rows.map((r) => [r.note_date, r.wines]));
  return recentNotes(rows, today).map((n) => ({ date: n.date, text: plainNote(n.text, byDate.get(n.date) ?? []) }));
}
