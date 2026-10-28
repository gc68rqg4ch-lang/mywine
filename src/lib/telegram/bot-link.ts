import "server-only";

// Link zum Chat mit dem Bot – für „＋ Flaschen erfassen“ in der App.
// Benutzername aus TELEGRAM_BOT_USERNAME, sonst Antoine (@antoine_winebot).

const DEFAULT_BOT_USERNAME = "antoine_winebot";

export function botChatUrl() {
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || DEFAULT_BOT_USERNAME;
  return `https://t.me/${username}`;
}
