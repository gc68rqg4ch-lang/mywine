import "server-only";

import { T } from "@/lib/bot/texts";
// „🔎 Nachrecherchieren“ im Bot: recherchiert einen Wein (gleiche Funktion wie die App),
// meldet, was ergänzt wurde, und fragt bei Abweichungen pro Punkt in der Ich-Form nach:
// „Ich habe beim Alkohol 14.5 % gefunden, bei dir steht 15 %. Übernehmen?“ [Ja] [Nein].
// Knöpfe: rs:<vorschlag>:y|n

import { after } from "next/server";
import { apiProblemForBot } from "@/lib/ai/api-errors";
import { wineHref } from "@/lib/cellar/wine-page";
import { wineName } from "@/lib/format";
import type { SuggestionField } from "@/lib/research/compare";
import { decideSuggestion, loadPendingSuggestions, type Suggestion } from "@/lib/research/suggestions";
import { researchAndFillWine } from "@/lib/research/wine";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerCallback, editMessage, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import type { Actor } from "@/lib/telegram/actor";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgInlineKeyboard } from "@/lib/telegram/types";

const e = escapeHtml;

/** „beim Alkohol“, „bei der Region“ … */
const AT: Record<SuggestionField, string> = {
  producer: "beim Produzenten",
  country: "beim Land",
  region: "bei der Region",
  appellation: "bei der Appellation",
  type: "beim Typ",
  alcohol_content: "beim Alkohol",
  drink_from_year: "beim Trinkfenster (ab)",
  drink_until_year: "beim Trinkfenster (bis)",
  grapes: "bei den Rebsorten",
};

export function suggestionQuestion(s: Pick<Suggestion, "field" | "vintageYear" | "current" | "suggested" | "sourceNote">) {
  const year = s.vintageYear != null && s.field !== "producer" ? ` ${s.vintageYear}` : "";
  return `🔎 Ich habe ${AT[s.field]}${year} <b>${e(s.suggested)}</b> gefunden, bei dir steht ${e(s.current)}.${s.sourceNote ? ` <i>(${e(s.sourceNote)})</i>` : ""} Übernehmen?`;
}

const keyboard = (id: string): TgInlineKeyboard => ({
  inline_keyboard: [
    [
      { text: "Ja", callback_data: `rs:${id}:y` },
      { text: "Nein", callback_data: `rs:${id}:n` },
    ],
  ],
});

export const isResearchCallback = (data: string | undefined) => /^rs:[0-9a-f-]{36}:[yn]$/.test(data ?? "");

/** Startet die Recherche; die Antwort kommt nach der Webhook-Antwort (dauert ~1 Minute). */
export async function startBotResearch(chatId: number, wineId: string, year: number | null, announce = true) {
  const db = createAdminClient();
  const { data: wine } = await db.from("wines").select("name, producer").eq("id", wineId).maybeSingle();
  if (!wine) {
    await sendMessage(chatId, T.researchWineGone);
    return;
  }
  if (announce) {
    await sendMessage(chatId, T.researchStart(wineName(wine)));
  }
  after(() => runBotResearch(chatId, wineId, year, wineName(wine)));
}

export async function runBotResearch(chatId: number, wineId: string, year: number | null, title: string) {
  const db = createAdminClient();
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  try {
    const outcome = await researchAndFillWine(db, wineId, "all");
    const suggestions = await loadPendingSuggestions(db, { wineId });
    const base = appBaseUrl();
    const link = base ? `\n<a href="${base}${wineHref(wineId, year)}">In der App öffnen</a>` : "";
    const lines = [
      outcome.filled.length
        ? `✅ Ich habe bei ${e(title)} ergänzt: ${e(outcome.filled.join(" · "))}.`
        : `Bei ${e(title)} fehlte nichts, das ich hätte ergänzen können.`,
      suggestions.length
        ? `Bei ${suggestions.length === 1 ? "einem Punkt" : `${suggestions.length} Punkten`} weicht die Recherche von deinen Angaben ab – ich frage einzeln nach.`
        : outcome.status === "nothing"
          ? "Deine Angaben stimmen mit der Recherche überein."
          : null,
    ].filter(Boolean);
    await sendMessage(chatId, `${lines.join("\n")}${link}`);
    for (const s of suggestions) await sendMessage(chatId, suggestionQuestion(s), keyboard(s.id));
  } catch (error) {
    console.error("bot research failed", wineId, error);
    const text = apiProblemForBot(error) ?? T.researchError;
    await sendMessage(chatId, escapeHtml(text)).catch(() => undefined);
  }
}

/** [Ja] / [Nein] unter einer Abweichung. */
export async function handleResearchCallback(cb: TgCallbackQuery, actor: Actor) {
  const [, id, answer] = (cb.data ?? "").split(":");
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (chatId == null || messageId == null) return answerCallback(cb.id);
  const db = createAdminClient();
  const accept = answer === "y";
  try {
    const result = await decideSuggestion(db, id, accept, actor.personId);
    await answerCallback(cb.id, result.ok ? (accept ? "Übernommen" : "Behalten") : result.error);
    const question = cb.message?.text ? e(cb.message.text.replace(/\s*Übernehmen\?$/, "")) : "";
    const outcome = result.ok
      ? accept
        ? `✅ Ich habe es übernommen. ${e(result.message)}`
        : T.researchKept
      : `⚠️ ${e(result.error)}`;
    await editMessage(chatId, messageId, `${question}\n${outcome}`);
  } catch (error) {
    console.error("research callback failed", error);
    await answerCallback(cb.id, T.errorNothingChanged);
  }
}
