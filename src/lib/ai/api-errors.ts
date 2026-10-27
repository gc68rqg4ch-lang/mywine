// Fehler der Claude API einordnen – für klare Meldungen statt „etwas ist schiefgelaufen“.
// Besonders das Nutzungslimit: 400 invalid_request_error „You have reached your specified
// API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.“

import { formatDate } from "@/lib/format";

export type ApiProblem =
  | { kind: "usage_limit"; until: string | null; message: string }
  | { kind: "api"; message: string };

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

/** Einordnung für Meldungen; null = kein API-Fehler (z. B. Datenbank). */
export function apiProblem(error: unknown): ApiProblem | null {
  const limit = usageLimit(error);
  if (limit) {
    return {
      kind: "usage_limit",
      until: limit.until,
      message: `Das monatliche API-Limit ist erreicht. ${limit.until ? `Wieder verfügbar am ${limit.until}.` : "Das Datum stand nicht in der Meldung."}`,
    };
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
  return problem.kind === "usage_limit"
    ? `⛔ Ich komme gerade nicht an Claude: ${problem.message}`
    : `❌ Ich komme gerade nicht an Claude. ${problem.message}`;
}
