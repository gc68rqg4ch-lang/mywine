// Sammellauf der Recherche: wann anhalten? Rein, damit App und Tests dieselbe Regel nutzen.

import { USAGE_LIMIT_HINT } from "@/lib/ai/api-errors";
import type { ResearchOutcome } from "./wine";

/** Andere Fehler: nach so vielen in Folge anhalten. */
export const MAX_FAILURES_IN_A_ROW = 3;

/**
 * Nach jedem Wein: API-Limit → sofort anhalten (jeder weitere Wein scheitert gleich);
 * andere Fehler zählen, nach 3 in Folge anhalten; ein Erfolg setzt den Zähler zurück.
 */
export function afterWine(outcome: Pick<ResearchOutcome, "status" | "error">, failuresBefore: number) {
  if (outcome.error?.kind === "usage_limit") return { failures: failuresBefore + 1, halt: outcome.error.message };
  const failures = outcome.status === "error" ? failuresBefore + 1 : 0;
  const halt =
    failures >= MAX_FAILURES_IN_A_ROW
      ? `Angehalten nach ${MAX_FAILURES_IN_A_ROW} Fehlern in Folge: ${outcome.error?.message ?? "unbekannter Fehler"}`
      : null;
  return { failures, halt };
}

/** Meldung beim Stopp wegen API-Limit: „API-Limit erreicht – Lauf gestoppt. 1 von 5 erledigt.“ */
export function limitHaltMessage(done: number, total: number) {
  return `API-Limit erreicht – Lauf gestoppt. ${done} von ${total} erledigt. ${USAGE_LIMIT_HINT}`;
}

/**
 * Sammellauf: Weine strikt nacheinander (nie mehrere gleichzeitig). API-Limit → sofort stoppen,
 * keine weitere Anfrage; andere Fehler → nach 3 in Folge. stop() = „Abbrechen“ nach dem laufenden Wein.
 */
export async function runBatch<C>(
  items: C[],
  research: (item: C) => Promise<ResearchOutcome>,
  hooks: { stop?: () => boolean; onStart?: (item: C) => void; onDone?: (item: C, outcome: ResearchOutcome) => void } = {},
): Promise<{ halt: string | null; done: number; ok: number }> {
  let failures = 0;
  let done = 0;
  let ok = 0;
  for (const item of items) {
    if (hooks.stop?.()) break;
    hooks.onStart?.(item);
    let outcome: ResearchOutcome;
    try {
      outcome = await research(item);
    } catch {
      outcome = { status: "error", filled: [], suggested: 0, seconds: 0 };
    }
    done++;
    if (outcome.status !== "error") ok++;
    hooks.onDone?.(item, outcome);
    if (outcome.error?.kind === "usage_limit") {
      // Ein Log-Eintrag pro Lauf; erledigt = ohne Fehler (auch ein Wein mit Ergänztem vor dem Limit).
      console.error("api limit reached", `${ok} von ${items.length} erledigt`);
      return { halt: limitHaltMessage(ok, items.length), done, ok };
    }
    const step = afterWine(outcome, failures);
    failures = step.failures;
    if (step.halt) return { halt: step.halt, done, ok };
  }
  return { halt: null, done, ok };
}
