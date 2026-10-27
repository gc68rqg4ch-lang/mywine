// Sammellauf der Recherche: wann anhalten? Rein, damit App und Tests dieselbe Regel nutzen.

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
