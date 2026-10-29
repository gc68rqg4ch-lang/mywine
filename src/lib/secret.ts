import { timingSafeEqual } from "node:crypto";

/** Geheimnis vergleichen, ohne über die Laufzeit etwas zu verraten. */
export function secretMatches(received: string | null | undefined, expected: string | null | undefined) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Aus „x-research-worker-secret: …“ oder „Authorization: Bearer …“. */
export function workerSecretFrom(headers: Headers) {
  return headers.get("x-research-worker-secret") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}
