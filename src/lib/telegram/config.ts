import "server-only";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ist nicht gesetzt.`);
  return value;
}

/** Bot-Konfiguration aus den Umgebungsvariablen – erst zur Laufzeit lesen. */
export function telegramConfig() {
  // Rückfall für den Zugang (gilt als Michel); eigentlich freigeschaltet wird über
  // persons.telegram_user_id.
  const rawAllowed = process.env.TELEGRAM_ALLOWED_USER_ID;
  const allowedUserId = rawAllowed ? Number(rawAllowed) : null;
  if (allowedUserId != null && !Number.isSafeInteger(allowedUserId)) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID muss eine numerische Telegram-User-ID sein.");
  }
  return {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    webhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
    allowedUserId,
  };
}

/** Öffentliche Basis-URL der App für Links in Bot-Nachrichten. */
export function appBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && !explicit.includes("localhost")) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}
