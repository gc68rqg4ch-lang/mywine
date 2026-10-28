// Kurze Meldung nach „Nachrecherchieren“ im Kopf der Weinseite (rein, ohne DB):
// „3 Angaben ergänzt“, „1 Abweichung zum Prüfen“, „Nichts Neues gefunden“.

import type { ResearchOutcome } from "./wine";

export type ResearchSummary = { ok: string } | { error: string };

export function researchSummary(outcome: Pick<ResearchOutcome, "status" | "filled" | "suggested" | "error">): ResearchSummary {
  switch (outcome.status) {
    case "filled":
    case "nothing": {
      const n = outcome.filled.length;
      const parts = [
        n ? `${n} ${n === 1 ? "Angabe" : "Angaben"} ergänzt` : null,
        outcome.suggested ? `${outcome.suggested} ${outcome.suggested === 1 ? "Abweichung" : "Abweichungen"} zum Prüfen` : null,
      ].filter(Boolean);
      return { ok: parts.length ? parts.join(" · ") : "Nichts Neues gefunden" };
    }
    case "complete":
      return { error: "Diesen Wein gibt es nicht mehr." };
    default:
      if (outcome.error?.kind === "usage_limit") return { error: outcome.error.message };
      if (outcome.error?.kind === "api") return { error: `${outcome.error.message} Bitte später nochmals versuchen.` };
      return { error: "Die Recherche ist fehlgeschlagen. Bitte später nochmals versuchen." };
  }
}
