import "server-only";

import { tg } from "./api";

// Link zum Chat mit dem Bot (t.me/<Benutzername>) – für „＋ Flaschen erfassen“ in der App.
// Benutzername aus TELEGRAM_BOT_USERNAME, sonst einmal pro Server-Instanz über getMe.

let cached: Promise<string | null> | null = null;

export function botChatUrl(): Promise<string | null> {
  const explicit = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (explicit) return Promise.resolve(`https://t.me/${explicit}`);
  cached ??= tg<{ username?: string }>("getMe")
    .then((me) => (me.username ? `https://t.me/${me.username}` : null))
    .catch((error) => {
      console.error("bot username lookup failed", error);
      cached = null;
      return null;
    });
  return cached;
}
