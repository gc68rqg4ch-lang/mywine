import "server-only";

// Bearbeiten im Bot: Vorschlag (vorher → nachher) mit [Ja] [Nein]; die Bearbeitung liegt
// bis zur Antwort in ingest_jobs (source = telegram_edit). Ausgeführt wird über dasselbe
// Modul wie in der App – mit erneuter Prüfung des aktuellen Stands.

import { wineHref } from "@/lib/cellar/wine-page";
import type { Json } from "@/lib/database.types";
import { applyEdit } from "@/lib/edit/edit";
import { previewLines, type Edit, type EditPreview } from "@/lib/edit/types";
import type { AdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import { appendHistory } from "./history";
import { editKeyboard } from "./proposals";

export const EDIT_SOURCE = "telegram_edit";

type StoredEdit = { kind: "edit"; edit: Edit; text: string };

/** Vorschau als Bot-Nachricht: was, vorher → nachher, Hinweise, Frage. */
export function editQuestion(preview: EditPreview) {
  return `✏️ ${escapeHtml(previewLines(preview).join("\n"))}\n\nSoll ich das so ändern?`;
}

/** Legt den Vorschlag ab und schickt ihn mit [Ja] [Nein]. */
export async function sendEditProposal(db: AdminClient, chatId: number, edit: Edit, preview: EditPreview) {
  const stored: StoredEdit = { kind: "edit", edit, text: previewLines(preview).join(" · ") };
  const { data, error } = await db
    .from("ingest_jobs")
    .insert({ source: EDIT_SOURCE, telegram_chat_id: chatId, status: "needs_review", extracted: stored as unknown as Json })
    .select("id")
    .single();
  if (error) throw error;
  await sendMessage(chatId, editQuestion(preview), editKeyboard(data.id));
}

/** [Ja] / [Nein] unter einem Bearbeiten-Vorschlag (die Knöpfe sind schon entfernt). */
export async function answerEditProposal(db: AdminClient, chatId: number, jobId: string, confirm: boolean) {
  const { data: job, error } = await db
    .from("ingest_jobs")
    .update({ status: confirm ? "processing" : "discarded" })
    .eq("id", jobId)
    .eq("source", EDIT_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .select("extracted")
    .maybeSingle();
  if (error) throw error;
  const stored = job?.extracted as unknown as StoredEdit | undefined;
  if (!stored) return "Diesen Vorschlag habe ich schon erledigt.";

  if (!confirm) {
    await appendHistory(db, chatId, [{ role: "assistant", content: `[Abgelehnt, nichts geändert: ${stored.text}]` }]);
    return "Okay, ich lasse alles, wie es ist.";
  }

  const result = await applyEdit(db, stored.edit);
  await db
    .from("ingest_jobs")
    .update(result.ok ? { status: "confirmed" } : { status: "failed", error: result.error })
    .eq("id", jobId);
  const base = appBaseUrl();
  const link =
    result.ok && result.wineId && base
      ? `\n<a href="${base}${wineHref(result.wineId, result.year)}">In MyWine öffnen</a>`
      : "";
  const text = result.ok ? `Ich habe ${result.done}.` : result.error;
  await sendMessage(chatId, `${result.ok ? "✅" : "⚠️"} ${escapeHtml(text)}${link}`);
  await appendHistory(db, chatId, [
    { role: "assistant", content: `[${result.ok ? "Bestätigt und ausgeführt" : "Nicht ausgeführt"}: ${text}]` },
  ]);
  return null;
}
