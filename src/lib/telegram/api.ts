import "server-only";

import { telegramConfig } from "./config";
import type { TgInlineKeyboard, TgMessage } from "./types";

const API = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly description: string,
  ) {
    super(`Telegram ${method}: ${description}`);
  }
}

/** Ruft eine Methode der Telegram Bot API auf und liefert `result`. */
export async function tg<T = unknown>(method: string, payload: Record<string, unknown> = {}) {
  const { botToken } = telegramConfig();
  const res = await fetch(`${API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; result: T }
    | { ok: false; description?: string }
    | null;
  if (!body?.ok) {
    throw new TelegramApiError(method, body && !body.ok ? (body.description ?? "") : `HTTP ${res.status}`);
  }
  return body.result;
}

export function sendMessage(
  chatId: number,
  html: string,
  keyboard?: TgInlineKeyboard,
) {
  return tg<TgMessage>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

/** Entfernt die Buttons unter einer Nachricht (Fehler ignorieren – rein kosmetisch). */
export async function clearKeyboard(chatId: number, messageId: number) {
  await tg("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

export async function answerCallback(callbackQueryId: string, text?: string) {
  await tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text }).catch(
    () => undefined,
  );
}

/** Lädt eine Datei von Telegram herunter. */
export async function downloadFile(fileId: string) {
  const { botToken } = telegramConfig();
  const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramApiError("getFile", "keine file_path");
  const res = await fetch(`${API}/file/bot${botToken}/${file.file_path}`);
  if (!res.ok) throw new TelegramApiError("downloadFile", `HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), filePath: file.file_path };
}

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
