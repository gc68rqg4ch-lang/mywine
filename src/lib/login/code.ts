// Login-Code von Antoine (rein, ohne DB): 6 Ziffern, kryptografisch zufällig; gespeichert nur als
// HMAC-SHA256 (Server-Secret, an den Benutzer gebunden). Gültig 10 Minuten, höchstens 5 Versuche,
// einmalig verwendbar; ein neuer Code macht den alten ungültig; höchstens 5 Anforderungen pro
// Person in 15 Minuten.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { MAX_ATTEMPTS, MAX_REQUESTS, RATE_WINDOW_MS } from "./code-limits";

export { CODE_TTL_MS, MAX_ATTEMPTS, MAX_REQUESTS, RATE_WINDOW_MS, RESEND_SECONDS } from "./code-limits";

/** Name der Umgebungsvariable für den Hash. */
export const SECRET_ENV = "LOGIN_CODE_SECRET";

/** Ohne Secret kein Code-Login (Knopf aus, der Mail-Link geht weiter). */
export const loginCodeSecret = (env: Record<string, string | undefined> = process.env) => {
  const s = env[SECRET_ENV]?.trim();
  return s && s.length >= 16 ? s : null;
};

/** 6 Ziffern, gleichverteilt (crypto.randomInt). */
export const generateCode = (random: (max: number) => number = (max) => randomInt(max)) => String(random(1_000_000)).padStart(6, "0");

/** Eingabe säubern: Leerzeichen/Bindestriche weg; nur genau 6 Ziffern gelten. */
export const normalizeCode = (input: string) => {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
};

export const hashCode = (secret: string, userId: string, code: string) => createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");

export type CodeRow = { id: string; user_id: string; code_hash: string; expires_at: string; attempts: number; used_at: string | null; invalidated_at: string | null };

export type CheckResult = "ok" | "wrong" | "expired" | "locked" | "none";

/** Code gegen den neusten gültigen Eintrag prüfen. */
export function checkCode(row: CodeRow | null, input: { userId: string; code: string; secret: string; now: number }): CheckResult {
  if (!row || row.used_at || row.invalidated_at || row.user_id !== input.userId) return "none";
  if (Date.parse(row.expires_at) <= input.now) return "expired";
  if (row.attempts >= MAX_ATTEMPTS) return "locked";
  const a = Buffer.from(hashCode(input.secret, input.userId, input.code), "hex");
  const b = Buffer.from(row.code_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "wrong";
}

/** Höchstens 5 Anforderungen in 15 Minuten (Zeitpunkte der bisherigen Codes). */
export const rateLimited = (createdAt: string[], now: number) => createdAt.filter((t) => now - Date.parse(t) < RATE_WINDOW_MS).length >= MAX_REQUESTS;

/** Antwort an die Seite – immer gleich, ob die Adresse bekannt ist oder nicht. */
export const CODE_SENT_TEXT = "Falls die Adresse bekannt ist, hat Antoine dir einen Code per Telegram geschickt.";

/** Meldungen bei der Eingabe des Codes. */
export function checkMessage(result: Exclude<CheckResult, "ok">, attemptsLeft: number) {
  if (result === "wrong" && attemptsLeft > 0) return `Der Code stimmt nicht – noch ${attemptsLeft} ${attemptsLeft === 1 ? "Versuch" : "Versuche"}.`;
  if (result === "expired") return "Der Code ist abgelaufen – bitte einen neuen Code senden.";
  return "Der Code ist nicht mehr gültig – bitte einen neuen Code senden.";
}
