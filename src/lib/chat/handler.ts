import "server-only";

import { after } from "next/server";
import { apiProblemForBot } from "@/lib/ai/api-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerCallback, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import type { Actor } from "@/lib/telegram/actor";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery } from "@/lib/telegram/types";
import { startTextIngest } from "@/lib/ingest/flow";
import { T, say } from "@/lib/bot/texts";
import { askTextIntent, startTastedText } from "./tasted";
import { PENDING_TTL_MS, supersede } from "./pending";
import { answerChat } from "./agent";
import { executeProposal } from "./execute";
import { appendHistory, clearHistory, loadHistory } from "./history";
import { wineButtons } from "./menu";
import { MAIN_KEYBOARD } from "./menu-view";
import { answerEditProposal, sendEditProposal } from "./edits";
import { startBotResearch } from "./research";
import { REJECT_DATA, confirmKeyboard, decodeEditCallback, decodeProposal } from "./proposals";

const MAX_INPUT = 2000;

/** Freie Textnachricht: Antwort per Claude mit Werkzeugen, läuft nach der Webhook-Antwort. */
export async function handleChatMessage(chatId: number, text: string, actor: Actor) {
  after(() => replyToChat(chatId, text.slice(0, MAX_INPUT), actor));
}

export async function resetChat(chatId: number) {
  await clearHistory(createAdminClient(), chatId);
  await sendMessage(chatId, T.chatForgotten, MAIN_KEYBOARD);
}

async function replyToChat(chatId: number, text: string, actor: Actor) {
  const db = createAdminClient();
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  try {
    const history = await loadHistory(db, chatId);
    const reply = await answerChat(db, history, text, actor);

    // Neuer Wein per Text: Kauf → Erfassung (wie nach „Neuer Wein“), verkostet → Schnellablauf
    // „Verkostet“, unklar → erst fragen. Antwort nur kurz.
    if (reply.newEntry) {
      const entry = reply.newEntry;
      // Neues Anliegen: angefangene Rückfragen verwerfen.
      await supersede(db, chatId, "text");
      if (reply.text) await sendMessage(chatId, escapeHtml(reply.text));
      if (entry.intent === "bought") await startTextIngest(chatId, entry.description);
      else if (entry.intent === "tasted") await startTastedText(chatId, entry.description);
      else await askTextIntent(db, chatId, entry.description);
      const what = { bought: "eines gekauften Weins", tasted: "eines verkosteten Weins", unclear: "eines Weins (gekauft oder verkostet?)" }[entry.intent];
      await appendHistory(db, chatId, [
        { role: "user", content: text },
        { role: "assistant", content: `[Erfassung ${what} gestartet: ${entry.description}]` },
      ]);
      return;
    }

    // Recherche: kurze Antwort, das Ergebnis kommt in ~1 Minute als eigene Nachrichten.
    if (reply.research) {
      await sendMessage(chatId, reply.text ? escapeHtml(reply.text) : T.thinkingResearch);
      await startBotResearch(chatId, reply.research.wineId, reply.research.year, false);
      await appendHistory(db, chatId, [
        { role: "user", content: text },
        { role: "assistant", content: `[Recherche gestartet für wine_id=${reply.research.wineId}]` },
      ]);
      return;
    }

    // Nennt die Antwort Weine, kommen sie als Knöpfe darunter; sonst bleibt die Menüleiste.
    const buttons = await wineButtons(db, reply.wines).catch((error) => {
      console.error("chat wine buttons failed", error);
      return null;
    });
    if (reply.text || buttons) {
      await sendMessage(chatId, reply.text ? escapeHtml(reply.text) : T.here, buttons ?? MAIN_KEYBOARD);
    }
    for (const p of reply.proposals) {
      if ("edit" in p) await sendEditProposal(db, chatId, p.edit, p.preview, p.alternative);
      else await sendMessage(chatId, `❓ ${escapeHtml(p.text)}?`, confirmKeyboard(p.proposal));
    }

    const remembered = [reply.text, ...reply.proposals.map((p) => `[Vorschlag mit Ja/Nein-Knöpfen: ${p.text}]`)]
      .filter(Boolean)
      .join("\n");
    await appendHistory(db, chatId, [
      { role: "user", content: text },
      { role: "assistant", content: remembered || "(keine Antwort)" },
    ]);
  } catch (error) {
    console.error("chat reply failed", error);
    const api = apiProblemForBot(error);
    await sendMessage(chatId, api ? escapeHtml(api) : T.errorNothingChanged).catch(() => undefined);
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
    await answerCallback(cb.id, T.alreadyDone);
    return;
  }
  const db = createAdminClient();

  const edit = decodeEditCallback(cb.data);
  if (edit) {
    try {
      const note = await answerEditProposal(db, chatId, edit.jobId, edit.confirm, edit.alternative);
      await answerCallback(cb.id, note ?? undefined);
    } catch (error) {
      console.error("edit proposal failed", error);
      await answerCallback(cb.id);
      await sendMessage(chatId, T.errorNothingChanged);
    }
    return;
  }

  const question = cb.message?.text?.replace(/^❓\s*/, "").replace(/\?$/, "") ?? "Vorschlag";

  // Schnelle Vorschläge (Öffnen, Füllstand, Sterne) stecken im Knopf: nach 30 Minuten abgelaufen.
  if (cb.message?.date && cb.message.date * 1000 < Date.now() - PENDING_TTL_MS) {
    await answerCallback(cb.id, T.proposalExpiredToast);
    await sendMessage(chatId, T.proposalExpired(question));
    return;
  }

  if (cb.data === REJECT_DATA) {
    await answerCallback(cb.id, say("keepAsIs"));
    await appendHistory(db, chatId, [{ role: "assistant", content: `[Abgelehnt, nichts geändert: ${question}]` }]);
    return;
  }

  const proposal = decodeProposal(cb.data);
  if (!proposal) {
    await answerCallback(cb.id, T.proposalInvalid);
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
    await sendMessage(chatId, T.errorNothingChanged);
  }
}
