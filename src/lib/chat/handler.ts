import "server-only";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerCallback, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery } from "@/lib/telegram/types";
import { answerChat } from "./agent";
import { executeProposal } from "./execute";
import { appendHistory, clearHistory, loadHistory } from "./history";
import { wineButtons } from "./menu";
import { MAIN_KEYBOARD } from "./menu-view";
import { REJECT_DATA, confirmKeyboard, decodeProposal } from "./proposals";

const MAX_INPUT = 2000;

/** Freie Textnachricht: Antwort per Claude mit Werkzeugen, läuft nach der Webhook-Antwort. */
export async function handleChatMessage(chatId: number, text: string) {
  after(() => replyToChat(chatId, text.slice(0, MAX_INPUT)));
}

export async function resetChat(chatId: number) {
  await clearHistory(createAdminClient(), chatId);
  await sendMessage(chatId, "Okay, ich habe unseren Gesprächsverlauf vergessen.", MAIN_KEYBOARD);
}

async function replyToChat(chatId: number, text: string) {
  const db = createAdminClient();
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  try {
    const history = await loadHistory(db, chatId);
    const reply = await answerChat(db, history, text);

    // Nennt die Antwort Weine, kommen sie als Knöpfe darunter; sonst bleibt die Menüleiste.
    const buttons = await wineButtons(db, reply.wines).catch((error) => {
      console.error("chat wine buttons failed", error);
      return null;
    });
    if (reply.text || buttons) {
      await sendMessage(chatId, escapeHtml(reply.text || "Hier:"), buttons ?? MAIN_KEYBOARD);
    }
    for (const p of reply.proposals) {
      await sendMessage(chatId, `❓ ${escapeHtml(p.text)}?`, confirmKeyboard(p.proposal));
    }

    const remembered = [reply.text, ...reply.proposals.map((p) => `[Vorschlag mit Ja/Nein-Buttons: ${p.text}]`)]
      .filter(Boolean)
      .join("\n");
    await appendHistory(db, chatId, [
      { role: "user", content: text },
      { role: "assistant", content: remembered || "(keine Antwort)" },
    ]);
  } catch (error) {
    console.error("chat reply failed", error);
    await sendMessage(chatId, "❌ Da ist etwas schiefgelaufen. Bitte versuch es nochmals.").catch(() => undefined);
  }
}

/** [Ja] / [Nein] unter einem Vorschlag. */
export async function handleChatCallback(cb: TgCallbackQuery) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (chatId == null || messageId == null) {
    await answerCallback(cb.id);
    return;
  }
  // Buttons entfernen und damit den Vorschlag beanspruchen: Bei einem zweiten Klick
  // meldet Telegram „message is not modified“ – so läuft nichts doppelt (z. B. Öffnen).
  const claimed = await tg("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).then(
    () => true,
    () => false,
  );
  if (!claimed) {
    await answerCallback(cb.id, "Schon erledigt.");
    return;
  }
  const db = createAdminClient();
  const question = cb.message?.text?.replace(/^❓\s*/, "").replace(/\?$/, "") ?? "Vorschlag";

  if (cb.data === REJECT_DATA) {
    await answerCallback(cb.id, "Nichts geändert.");
    await appendHistory(db, chatId, [{ role: "assistant", content: `[Abgelehnt, nichts geändert: ${question}]` }]);
    return;
  }

  const proposal = decodeProposal(cb.data);
  if (!proposal) {
    await answerCallback(cb.id, "Dieser Vorschlag ist ungültig.");
    return;
  }
  await answerCallback(cb.id);
  try {
    const result = await executeProposal(db, proposal);
    const base = appBaseUrl();
    const link = result.ok && result.itemId && base ? `\n<a href="${base}/flasche/${result.itemId}">In MyWine öffnen</a>` : "";
    await sendMessage(chatId, `${result.ok ? "✅" : "⚠️"} ${escapeHtml(result.text)}${link}`);
    await appendHistory(db, chatId, [
      { role: "assistant", content: `[${result.ok ? "Bestätigt und ausgeführt" : "Nicht ausgeführt"}: ${result.text}]` },
    ]);
  } catch (error) {
    console.error("chat proposal failed", error);
    await sendMessage(chatId, "❌ Das hat nicht geklappt – nichts geändert. Bitte versuch es nochmals.");
  }
}
