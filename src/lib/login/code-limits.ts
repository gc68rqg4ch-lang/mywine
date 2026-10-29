// Grenzen des Login-Codes (rein, auch im Browser nutzbar – ohne node:crypto).

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_REQUESTS = 5;
/** „Neuen Code senden“ frühestens nach so vielen Sekunden. */
export const RESEND_SECONDS = 60;
