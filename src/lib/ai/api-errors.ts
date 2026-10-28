// Fehler der Claude API einordnen – für klare Meldungen statt „etwas ist schiefgelaufen“.
// usage_limit: 400 invalid_request_error „You have reached your specified API usage limits. You
// will regain access on 2026-11-01 at 00:00 UTC.“ (Ausgabenlimit in der Claude Console – erst
// nach einer Erhöhung bzw. am genannten Tag wieder). temporary: 429 Rate-Limit bzw. 529
// überlastet – in ein paar Minuten nochmals. api: alle anderen API-Fehler.

import { formatDate } from "@/lib/format";
import { T } from "@/lib/bot/texts";

export type ApiProblem =
  | { kind: "usage_limit"; until: string | null; message: string }
  | { kind: "temporary"; message: string }
  | { kind: "api"; message: string };

/** Hinweis in der App: das Limit setzt man in der Claude Console, die App kann es nicht ändern. */
export const USAGE_LIMIT_HINT = "Limit in der Claude Console (Settings → Limits) erhöhen oder später nochmals starten.";

/** Fehlertext aus einem SDK-Fehler (auch verschachtelt) bzw. einem beliebigen Wert. */
function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const e = error as { message?: unknown; error?: unknown };
  const nested = e.error && typeof e.error === "object" ? errorText((e.error as { error?: unknown }).error ?? e.error) : "";
  return [typeof e.message === "string" ? e.message : "", nested].filter(Boolean).join(" ");
}

const isApiError = (error: unknown) =>
  !!error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number";


/** Nutzungslimit erreicht? Dann mit Datum („Wieder verfügbar am …“), sonst null. */
export function usageLimit(error: unknown): { until: string | null } | null {
  const text = errorText(error);
  if (!/usage limits?/i.test(text) || !/reached/i.test(text)) return null;
  const date = text.match(/regain access on (\d{4}-\d{2}-\d{2})/i)?.[1];
  // Datum wie überall in der App (formatDate).
  return { until: date ? formatDate(date) : null };
}

/** 429 Rate-Limit oder 529 überlastet (auch als Fehlertyp im Text): vorübergehend, kein Ausgabenlimit. */
export function temporaryProblem(error: unknown) {
  const status = isApiError(error) ? (error as { status: number }).status : null;
  if (status === 429 || status === 529) return true;
  return /rate_limit_error|overloaded_error/.test(errorText(error));
}

/** Einordnung für Meldungen; null = kein API-Fehler (z. B. Datenbank). */
export function apiProblem(error: unknown): ApiProblem | null {
  const limit = usageLimit(error);
  if (limit) {
    return {
      kind: "usage_limit",
      until: limit.until,
      message: `API-Limit erreicht${limit.until ? ` (wieder verfügbar am ${limit.until})` : ""}. ${USAGE_LIMIT_HINT}`,
    };
  }
  if (temporaryProblem(error)) {
    return { kind: "temporary", message: "Die Claude API ist gerade überlastet (vorübergehend). Bitte in ein paar Minuten nochmals versuchen." };
  }
  if (!isApiError(error)) return null;
  const status = (error as { status: number }).status;
  const detail = errorText(error).match(/"message":"([^"]+)"/)?.[1] ?? errorText(error);
  return { kind: "api", message: `Fehler der Claude API (${status}): ${detail.slice(0, 200)}` };
}

/** Für den Bot in der Ich-Form; null = kein API-Fehler. */
export function apiProblemForBot(error: unknown) {
  const problem = apiProblem(error);
  if (!problem) return null;
  // Freundlich und ohne Technik (die Einzelheiten stehen im Log bzw. in der App).
  if (problem.kind === "usage_limit") {
    const until = usageLimit(error)?.until;
    return T.apiPaused(until ?? null);
  }
  if (problem.kind === "temporary") return T.apiBusy();
  return T.apiUnavailable;
}

/** Für die Erfassung im Bot (Etikett bzw. Beschreibung): Kontingent aufgebraucht → was jetzt geht. */
export function apiLimitForIngest(error: unknown, fromText: boolean) {
  const limit = usageLimit(error);
  if (!limit) return null;
  return fromText ? T.apiLimitText(limit.until) : T.apiLimitPhoto(limit.until);
}
