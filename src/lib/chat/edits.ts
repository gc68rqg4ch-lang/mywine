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

const isDelete = (edit: Edit) => edit.kind === "deleteBottles" || edit.kind === "deleteBatch" || edit.kind === "deleteWine";

/** Vorschau als Bot-Nachricht: was, vorher → nachher, Hinweise, Frage (beim Löschen deutlich). */
export function editQuestion(preview: EditPreview, edit?: Edit) {
  if (edit && isDelete(edit)) {
    return `🗑 ${escapeHtml(previewLines(preview).join("\n"))}\n\n<b>Wirklich löschen?</b>`;
  }
  return `✏️ ${escapeHtml(previewLines(preview).join("\n"))}\n\nSoll ich das so ändern?`;
}

/** Knöpfe unter einem Vorschlag; beim Löschen „Löschen“ bzw. „Ja, endgültig löschen“ / „Abbrechen“. */
export function proposalKeyboard(jobId: string, edit: Edit) {
  if (edit.kind === "deleteWine") return editKeyboard(jobId, { yes: "Ja, endgültig löschen", no: "Abbrechen" });
  if (isDelete(edit)) return editKeyboard(jobId, { yes: "🗑 Löschen", no: "Abbrechen" });
  return editKeyboard(jobId);
}

/** Legt den Vorschlag bis zur Antwort in ingest_jobs ab (nichts wird geändert); liefert die Job-ID. */
export async function storeEditProposal(db: AdminClient, chatId: number, edit: Edit, preview: EditPreview) {
  const stored: StoredEdit = { kind: "edit", edit, text: previewLines(preview).join(" · ") };
  const { data, error } = await db
    .from("ingest_jobs")
    .insert({ source: EDIT_SOURCE, telegram_chat_id: chatId, status: "needs_review", extracted: stored as unknown as Json })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Legt den Vorschlag ab und schickt ihn mit [Ja] [Nein] (beim Löschen mit deutlichen Knöpfen). */
export async function sendEditProposal(db: AdminClient, chatId: number, edit: Edit, preview: EditPreview) {
  const jobId = await storeEditProposal(db, chatId, edit, preview);
  await sendMessage(chatId, editQuestion(preview, edit), proposalKeyboard(jobId, edit));
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
