// Kurze strukturierte Antworten (Tagestext, Preis-Abgleich): Claude Haiku 5.5 denkt ohne Angabe
// adaptiv mit (Standard, effort „medium“). Die Denk-Tokens zählen gegen max_tokens und werden als
// Ausgabe berechnet – bei wachsender Eingabe bis an die Grenze, dann bricht das JSON mitten im
// Text ab. Für diese Aufrufe darum ohne Denken (bei Haiku 5.5 bis effort „high“ erlaubt) und bei
// einem Abbruch einmal neu versuchen. Rein.

/** Ohne Denken – nur für Haiku 5.5 (Sonnet 5.5 und Opus 5.5 lehnen „disabled“ mit 400 ab). */
export const NO_THINKING = { thinking: { type: "disabled" as const } };

/** Antwort abgeschnitten (stop_reason max_tokens). */
export class TruncatedOutput extends Error {
  constructor(model: string) {
    super(`${model}: Antwort abgeschnitten (max_tokens)`);
    this.name = "TruncatedOutput";
  }
}

/**
 * Abbruch der Ausgabe: max_tokens oder unvollständiges JSON („Failed to parse structured output:
 * … Unterminated string“). Nicht: API-Limit, Netz- oder andere API-Fehler.
 */
export function isTruncation(error: unknown) {
  if (error instanceof TruncatedOutput) return true;
  const message = error instanceof Error ? error.message : "";
  return /Failed to parse structured output|Unterminated string|Unexpected end of JSON|max_tokens/i.test(message);
}

/** Einmal neu versuchen, wenn die Antwort abgeschnitten war; alle anderen Fehler gehen durch. */
export async function retryOnTruncation<T>(run: () => Promise<T>, label: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTruncation(error)) throw error;
    console.warn(`${label}: Antwort abgeschnitten – zweiter Versuch`, error instanceof Error ? error.message : error);
    return run();
  }
}
