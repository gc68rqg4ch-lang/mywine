import { timingSafeEqual } from "node:crypto";

/** Geheimnis vergleichen, ohne über die Laufzeit etwas zu verraten. */
export function secretMatches(received: string | null | undefined, expected: string | null | undefined) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Aus „x-research-worker-secret: …“ (bzw. einem anderen Header) oder „Authorization: Bearer …“. */
export function workerSecretFrom(headers: Headers, header = "x-research-worker-secret") {
  return headers.get(header) ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

/** Header der Route /api/home/daily (Antoines Tagestexte). */
export const DAILY_SECRET_HEADER = "x-daily-notes-secret";
