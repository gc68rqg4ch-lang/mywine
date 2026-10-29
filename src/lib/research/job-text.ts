// Texte zur Recherche im Hintergrund (rein, ohne DB): Fortschritt auf /recherche und die
// Telegram-Meldung von Antoine (Wortlaut in bot/texts.ts), wenn ein Lauf fertig ist bzw. am
// API-Limit anhält.

import { T } from "@/lib/bot/texts";

/** Kurzes Ergebnis eines Auftrags (research_jobs.result). */
export type JobResult = {
  status: "filled" | "nothing" | "complete" | "error";
  filled: string[];
  suggested: number;
  taste?: string;
};

export type RunCounts = { total: number; done: number; failed: number; skipped: number; queued: number; running: number; held: number };

/** „7 von 20 erledigt“ (erledigt = fertig oder fehlgeschlagen; Abgebrochenes zählt nicht mit). */
export function progressText(c: RunCounts) {
  const finished = c.done + c.failed;
  const total = c.total - c.skipped;
  return `${finished} von ${total} erledigt`;
}

export const runActive = (c: RunCounts) => c.queued + c.running > 0;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Zählt, was ein Lauf gefunden hat. */
export function runStats(results: (JobResult | null)[]) {
  const ok = results.filter((r): r is JobResult => r != null);
  return {
    profiles: ok.filter((r) => r.taste === "saved").length,
    windows: ok.reduce((s, r) => s + r.filled.filter((f) => f.startsWith("Trinkfenster")).length, 0),
    suggestions: ok.reduce((s, r) => s + r.suggested, 0),
  };
}

/** Zahlen eines fertigen Laufs: „20 Weine, 5 Profile, 7 Trinkfenster, 3 Vorschläge zum Prüfen“. */
export function runCountsText(c: RunCounts, results: (JobResult | null)[]) {
  const s = runStats(results);
  const wines = c.total - c.skipped;
  return `${plural(wines, "Wein", "Weine")}, ${plural(s.profiles, "Profil", "Profile")}, ${s.windows} Trinkfenster, ${plural(s.suggestions, "Vorschlag", "Vorschläge")} zum Prüfen`;
}

/** Sammellauf fertig: „🔎 Recherche fertig: 20 Weine, 5 Profile, 7 Trinkfenster, 3 Vorschläge zum Prüfen.“ */
export function runDoneText(c: RunCounts, results: (JobResult | null)[], random?: () => number) {
  const extra = [c.failed ? `${c.failed} nicht geklappt` : null, c.skipped ? `${c.skipped} abgebrochen` : null].filter(Boolean).join(", ");
  return T.researchRunDone(runCountsText(c, results), extra || null, random);
}

/** Was ein einzelner Wein ergeben hat (null = nichts Neues). */
export function foundText(r: JobResult) {
  const parts = [r.filled.length ? `ergänzt: ${r.filled.join(", ")}` : null, r.suggested ? `${plural(r.suggested, "Vorschlag", "Vorschläge")} zum Prüfen` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** 🔎 für einen Wein fertig: Name und was gefunden wurde. */
export function singleDoneText(name: string, result: JobResult | null, random?: () => number) {
  if (!result || result.status === "error") return T.researchSingleFailed(name);
  if (result.status === "complete") return T.researchSingleDone(name, "diesen Wein gibt es nicht mehr", random);
  return T.researchSingleDone(name, foundText(result), random);
}

/** Kontingent (API-Limit) aufgebraucht: Lauf angehalten, Rest bleibt offen. */
export function limitText(open: number, random?: () => number) {
  return T.researchPaused(plural(open, "Wein", "Weine"), random);
}
