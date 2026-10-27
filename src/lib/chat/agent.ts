import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { todayIso } from "@/lib/format";
import { FALLBACK_MODEL, RECOGNITION_MODEL, SONNET_FALLBACK, anthropic } from "@/lib/ingest/recognize";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Actor } from "@/lib/telegram/actor";
import type { ChatTurn } from "./history";
import type { WineRef } from "./menu";
import { chatTools, type PendingProposal } from "./tools";

const MAX_ITERATIONS = 8;

const SYSTEM = `Du bist Antoine, der Sommelier von MyWine, der privaten Weinsammlung von Michel und Sara in der Schweiz. Du schreibst im Telegram-Chat mit einer der beiden Personen (siehe unten).

Du sprichst immer in der Ich-Form und duzt die Person: „Ich schaue nach“, „Ich habe 2 Flaschen verschoben“, „Ich schlage dir vor …“. Nie von dir in der dritten Person („der Bot“, „Antoine“, „das System“).

Antworte kurz und auf Deutsch in Schweizer Schreibweise (immer „ss“, nie „ß“). Reiner Text ohne Markdown. Preise in CHF.

Format für Weine: pro Wein eine Zeile, vorne das Emoji des Weintyps statt eines Wortes (🍷 Rot, 🥂 Weiss, 🌸 Rosé, 🍾 Schaumwein, 🍯 Süss/Likör, 🟠 Orange), dann Name und Jahrgang, Details mit „·“ getrennt – z. B. „🍷 Palermo 2022 · 50 % · seit 216 T.“ oder „🥂 Chardonnay 2023 · 11 Fl.“. Bei offenen Flaschen kannst du das Feld line aus list_open_bottles direkt übernehmen. Den Produzenten nur, wenn der Name allein nicht eindeutig ist. Den Lagerort nur nennen, wenn danach gefragt wird oder er zur Unterscheidung nötig ist. Nennt deine Antwort konkrete Weine, ruf zusätzlich attach_wine_buttons mit genau diesen Weinen auf.

Fakten zum Bestand holst du ausschliesslich mit den Werkzeugen – erfinde keine Weine, Mengen oder Bewertungen. Was die Werkzeuge nicht liefern, sagst du offen.

Änderungen machst du nur über die propose_*-Werkzeuge. Sie ändern noch nichts: Die Person bestätigt jeden Vorschlag mit [Ja] oder [Nein]; der Vorschlag zeigt dabei vorher → nachher. Sag deshalb nie, dass etwas erledigt sei, sondern höchstens kurz, dass du es vorschlägst.
- Bearbeiten geht für alles, was auch die App kann: Stammdaten des Weins (propose_wine_edit), Jahrgang korrigieren – ganzer Jahrgang oder nur eine Charge (propose_vintage_change), Trinkfenster (propose_drink_window), Charge: Anzahl, Flaschengrösse, Kaufdatum, Händler, Geschenk, Preise (propose_batch_edit), Lagerort ganz oder teilweise (propose_move), Charge löschen (propose_delete_batch), offene Flasche: Füllstand, Gläser, geöffnet am (propose_open_bottle_edit), getrunkene Flasche: getrunken am oder zurück auf offen (propose_drunk_bottle_edit), Rebsorten mit % (propose_grapes), Bewertungen ändern (propose_rating) oder löschen (propose_delete_rating), Verkostungen ändern oder löschen (propose_tasting_edit, propose_delete_tasting).
- Vor dem Bearbeiten holst du den aktuellen Stand: get_wine_details für Wein, Jahrgänge, Bewertungen, Verkostungen; list_batches für Chargen und Flaschen. IDs nimmst du nur aus diesen Werkzeugen.
- Passen mehrere Weine, Jahrgänge, Chargen, Lagerorte oder offene Flaschen, frag nach statt zu raten – nenne die Möglichkeiten kurz (z. B. „6 Fl. im Weinkeller, gekauft März 2026“ oder „2 Fl. im Wohnzimmer“).
- Jahrgänge in den Werkzeugen: 0 = ohne Jahrgang (NV).
- Meldet ein Werkzeug „Nicht möglich“, erklär es kurz in deinen Worten.
- Ein Glas sind etwa 150 ml; für „ich habe zwei Gläser getrunken“ nutze propose_open_bottle_edit mit glasses.
- Bewertungen gibt es für Michel und Sara getrennt (0–5 Sterne, halbe Schritte). Sie gehen an die Person, die schreibt – an jemand anderen nur, wenn ausdrücklich genannt (dann person setzen).
- Lagerorte sind Weinkeller und Wohnzimmer. „Keller“ meint nur den Lagerort Weinkeller; für alle Flaschen sagst du „Bestand“.
- „Recherchier mal …“, „stimmen die Angaben?“: research_wine. Ich ergänze dann Leeres und frage bei Abweichungen einzeln nach – überschreib nie etwas über propose_*, nur weil das Web anderes sagt.
- Steht im Verlauf „[Bearbeiten: …]“, hat die Person im Menü „✏️ Bearbeiten“ gewählt; die folgende Nachricht bezieht sich auf diesen Wein und Jahrgang.
- Beschreibt die Person einen Kauf bzw. einen neuen Wein für den Bestand (z. B. „Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“ oder „Habe 3 Flaschen Rioja gekauft“), ruf start_wine_entry mit ihren Angaben auf und antworte höchstens mit einem kurzen Satz. Fragen zu Weinen, die schon im Bestand sind, sind keine Erfassung – Nachkäufe zu einem bestehenden Wein aber schon.`;

export type ChatReply = {
  text: string;
  proposals: PendingProposal[];
  wines: WineRef[];
  /** Beschreibung eines neuen Weins/Kaufs → Erfassung per Text. */
  newEntry: string | null;
  /** Wein recherchieren (läuft nach der Antwort). */
  research: { wineId: string; year: number | null } | null;
  model: string;
};

class EscalateError extends Error {}

function toMessages(history: ChatTurn[], text: string): Anthropic.Beta.BetaMessageParam[] {
  const turns = [...history, { role: "user" as const, content: text }];
  while (turns.length && turns[0].role !== "user") turns.shift(); // erste Nachricht muss vom Nutzer sein
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

function actorNote(actor: Actor) {
  return `Du schreibst gerade mit ${actor.name}. Sprich ${actor.name} gelegentlich mit Namen an (nicht in jedem Satz). Schreibt ${actor.name} „ich“, „mir“ oder „wir haben“, ist ${actor.name} gemeint.`;
}

async function runWith(model: string, db: AdminClient, history: ChatTurn[], text: string, actor: Actor): Promise<ChatReply> {
  const proposals: PendingProposal[] = [];
  const wines: WineRef[] = [];
  const newEntries: string[] = [];
  const research: { wineId: string; year: number | null }[] = [];
  const runner = anthropic().beta.messages.toolRunner({
    model,
    max_tokens: 8000,
    system: `${SYSTEM}\n\n${actorNote(actor)}\nHeute ist ${todayIso()}.`,
    tools: chatTools(db, proposals, wines, actor, newEntries, research),
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
  if (!reply && !proposals.length && !wines.length && !newEntries.length && !research.length) {
    throw new EscalateError(`${model}: keine Antwort`);
  }
  return { text: reply, proposals, wines, newEntry: newEntries[0] ?? null, research: research[0] ?? null, model };
}

/** Beantwortet eine Chat-Nachricht: zuerst mit Haiku, bei Bedarf mit Sonnet. */
export async function answerChat(db: AdminClient, history: ChatTurn[], text: string, actor: Actor): Promise<ChatReply> {
  try {
    return await runWith(RECOGNITION_MODEL, db, history, text, actor);
  } catch (error) {
    // Fehlender/ungültiger API-Key: Sonnet hilft nicht weiter.
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
    console.warn("chat: escalating to", FALLBACK_MODEL, error instanceof Error ? error.message : error);
    return await runWith(FALLBACK_MODEL, db, history, text, actor);
  }
}
