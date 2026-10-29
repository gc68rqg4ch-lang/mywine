import "server-only";

import { withUsage } from "@/lib/ai/usage";
import Anthropic from "@anthropic-ai/sdk";
import { usageLimit } from "@/lib/ai/api-errors";
import { todayIso } from "@/lib/format";
import { FALLBACK_MODEL, RECOGNITION_MODEL, SONNET_FALLBACK, anthropic } from "@/lib/ingest/recognize";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Actor } from "@/lib/telegram/actor";
import type { ChatTurn } from "./history";
import type { WineRef } from "./menu";
import { CHAT_STRICT_NOTE, CHAT_SYSTEM, NON_LOOKUP_TOOLS, claimsStatus } from "@/lib/bot/chat-prompt";
import { T } from "@/lib/bot/texts";
import { chatTools, type NewEntry, type PendingProposal } from "./tools";

const MAX_ITERATIONS = 8;



export type ChatReply = {
  text: string;
  proposals: PendingProposal[];
  wines: WineRef[];
  /** Beschreibung eines neuen Weins (Kauf oder verkostet) → Erfassung per Text. */
  newEntry: NewEntry | null;
  /** Wein recherchieren (läuft nach der Antwort). */
  research: { wineId: string; year: number | null } | null;
  model: string;
};

class EscalateError extends Error {}
class UnverifiedError extends EscalateError {}

/** Wie runWith aufgerufen wird: Chat für offene Erfassungen, strict = zweiter Versuch nach einer Status-Behauptung ohne Nachschauen. */
type RunOptions = { chatId: number | null; strict: boolean };

function toMessages(history: ChatTurn[], text: string): Anthropic.Beta.BetaMessageParam[] {
  const turns = [...history, { role: "user" as const, content: text }];
  while (turns.length && turns[0].role !== "user") turns.shift(); // erste Nachricht muss vom Nutzer sein
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

function actorNote(actor: Actor) {
  return `Du schreibst gerade mit ${actor.name}. Sprich ${actor.name} gelegentlich mit Namen an (nicht in jedem Satz). Schreibt ${actor.name} „ich“, „mir“ oder „wir haben“, ist ${actor.name} gemeint.`;
}

/** Werkzeuge mit Zähler: meldet jeden Aufruf (Name) vor dem Ausführen. */
function countCalls<T extends { name: string; run: (...args: never[]) => unknown }>(tools: T[], onCall: (name: string) => void): T[] {
  return tools.map((tool) => ({
    ...tool,
    run: (...args: never[]) => {
      onCall(tool.name);
      return tool.run(...args);
    },
  }));
}

async function runWith(
  model: string,
  db: AdminClient,
  history: ChatTurn[],
  text: string,
  actor: Actor,
  options: RunOptions,
): Promise<ChatReply> {
  const proposals: PendingProposal[] = [];
  const wines: WineRef[] = [];
  const newEntries: NewEntry[] = [];
  const research: { wineId: string; year: number | null }[] = [];
  // Wahrheit nur aus der Datenbank: zählen, ob in diesem Zug nachgeschaut wurde.
  let lookups = 0;
  const tools = countCalls(chatTools(db, proposals, wines, actor, newEntries, research, options.chatId), (name) => {
    if (!NON_LOOKUP_TOOLS.has(name)) lookups++;
  });
  const runner = anthropic().beta.messages.toolRunner({
    model,
    max_tokens: 8000,
    system: `${CHAT_SYSTEM}\n\n${actorNote(actor)}\nHeute ist ${todayIso()}.${options.strict ? `\n\n${CHAT_STRICT_NOTE}` : ""}`,
    tools,
    messages: toMessages(history, text),
    max_iterations: MAX_ITERATIONS,
    output_config: { effort: "medium" },
    ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
  });
  const final = await withUsage({ purpose: "chat" }, () => runner.runUntilDone());

  // Ablehnung, abgeschnittene Antwort oder erschöpfte Runden: nochmals mit dem stärkeren Modell.
  if (final.stop_reason === "refusal" || final.stop_reason === "max_tokens" || final.stop_reason === "tool_use") {
    throw new EscalateError(`${model}: ${final.stop_reason}`);
  }
  const reply = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!reply && !proposals.length && !wines.length && !newEntries.length && !research.length) {
    throw new EscalateError(`${model}: keine Antwort`);
  }
  // Status behauptet, ohne nachzuschauen (z. B. „Der Pintia ist vorgemerkt“ aus dem Verlauf):
  // nicht senden – nochmals mit Hinweis; im zweiten Versuch eine ehrliche Kurzantwort.
  if (lookups === 0 && claimsStatus(reply)) {
    if (!options.strict) throw new UnverifiedError(`${model}: Status ohne Werkzeug`);
    console.warn("chat: status claim without lookup dropped", model);
    return { text: T.chatLookFirst, proposals: [], wines: [], newEntry: null, research: null, model };
  }
  return { text: reply, proposals, wines, newEntry: newEntries[0] ?? null, research: research[0] ?? null, model };
}

/**
 * Beantwortet eine Chat-Nachricht: zuerst mit Haiku, bei Bedarf mit Sonnet. Hat Haiku Status
 * behauptet, ohne nachzuschauen, versucht es Sonnet mit ausdrücklichem Hinweis (strict).
 */
export async function answerChat(
  db: AdminClient,
  history: ChatTurn[],
  text: string,
  actor: Actor,
  chatId: number | null = null,
): Promise<ChatReply> {
  try {
    return await runWith(RECOGNITION_MODEL, db, history, text, actor, { chatId, strict: false });
  } catch (error) {
    // Fehlender/ungültiger API-Key: Sonnet hilft nicht weiter.
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
    // Nutzungslimit gilt für alle Modelle – ein zweiter Versuch mit Sonnet bringt nichts.
    if (usageLimit(error)) throw error;
    console.warn("chat: escalating to", FALLBACK_MODEL, error instanceof Error ? error.message : error);
    return await runWith(FALLBACK_MODEL, db, history, text, actor, { chatId, strict: error instanceof UnverifiedError });
  }
}
