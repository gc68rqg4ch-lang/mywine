import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { todayIso } from "@/lib/format";
import { FALLBACK_MODEL, RECOGNITION_MODEL, SONNET_FALLBACK, anthropic } from "@/lib/ingest/recognize";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ChatTurn } from "./history";
import { chatTools, type PendingProposal } from "./tools";

const MAX_ITERATIONS = 8;

const SYSTEM = `Du bist der Assistent von MyWine, dem privaten Weinkeller von Michel und Sara in der Schweiz. Du schreibst im Telegram-Chat mit Michel.

Antworte kurz und auf Deutsch in Schweizer Schreibweise (immer „ss“, nie „ß“). Reiner Text ohne Markdown, höchstens einfache Aufzählungen mit „•“. Preise in CHF.

Fakten zum Keller holst du ausschliesslich mit den Werkzeugen – erfinde keine Weine, Mengen oder Bewertungen. Was die Werkzeuge nicht liefern, sagst du offen.

Änderungen (Füllstand, Flasche öffnen, ausgetrunken, Bewertung) machst du nur über die propose_*-Werkzeuge. Sie ändern noch nichts: Michel bestätigt jeden Vorschlag mit [Ja] oder [Nein]. Sag deshalb nie, dass etwas erledigt sei, sondern höchstens, dass du es vorschlägst.
- Passen mehrere Weine, Jahrgänge, Lagerorte oder offene Flaschen, frag nach statt zu raten.
- Ein Glas sind etwa 150 ml; für „ich habe zwei Gläser getrunken“ nutze propose_fill_level mit glasses.
- Bewertungen gibt es für Michel und Sara getrennt (0–5 Sterne, halbe Schritte). Ohne Namen meint „ich“ Michel.
- Lagerorte sind Räume wie Weinkeller oder Wohnzimmer.`;

export type ChatReply = { text: string; proposals: PendingProposal[]; model: string };

class EscalateError extends Error {}

function toMessages(history: ChatTurn[], text: string): Anthropic.Beta.BetaMessageParam[] {
  const turns = [...history, { role: "user" as const, content: text }];
  while (turns.length && turns[0].role !== "user") turns.shift(); // erste Nachricht muss vom Nutzer sein
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

async function runWith(model: string, db: AdminClient, history: ChatTurn[], text: string): Promise<ChatReply> {
  const proposals: PendingProposal[] = [];
  const runner = anthropic().beta.messages.toolRunner({
    model,
    max_tokens: 8000,
    system: `${SYSTEM}\n\nHeute ist ${todayIso()}.`,
    tools: chatTools(db, proposals),
    messages: toMessages(history, text),
    max_iterations: MAX_ITERATIONS,
    output_config: { effort: "medium" },
    ...(model === FALLBACK_MODEL ? SONNET_FALLBACK : {}),
  });
  const final = await runner.runUntilDone();

  // Ablehnung, abgeschnittene Antwort oder erschöpfte Runden: nochmals mit dem stärkeren Modell.
  if (final.stop_reason === "refusal" || final.stop_reason === "max_tokens" || final.stop_reason === "tool_use") {
    throw new EscalateError(`${model}: ${final.stop_reason}`);
  }
  const reply = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!reply && !proposals.length) throw new EscalateError(`${model}: keine Antwort`);
  return { text: reply, proposals, model };
}

/** Beantwortet eine Chat-Nachricht: zuerst mit Haiku, bei Bedarf mit Sonnet. */
export async function answerChat(db: AdminClient, history: ChatTurn[], text: string): Promise<ChatReply> {
  try {
    return await runWith(RECOGNITION_MODEL, db, history, text);
  } catch (error) {
    // Fehlender/ungültiger API-Key: Sonnet hilft nicht weiter.
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
    console.warn("chat: escalating to", FALLBACK_MODEL, error instanceof Error ? error.message : error);
    return await runWith(FALLBACK_MODEL, db, history, text);
  }
}
