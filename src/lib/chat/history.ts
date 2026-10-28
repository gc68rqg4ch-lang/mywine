import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Chat-Gedächtnis im Prompt: nur die letzten 12 Stunden, höchstens 20 Nachrichten (Nutzer +
 * Bot) pro Chat. Ältere bleiben gespeichert, gehen aber nicht mit. Der Verlauf ist nur
 * Gesprächskontext – Bestand und Status kommen immer aus den Werkzeugen.
 */
export const HISTORY_LIMIT = 20;
export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Fehlt die Tabelle (Migration noch nicht eingespielt), läuft der Chat ohne Verlauf. */
function isMissingTable(error: { code?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function loadHistory(db: AdminClient, chatId: number, now = Date.now()): Promise<ChatTurn[]> {
  const { data, error } = await db
    .from("telegram_chat_messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .gte("created_at", new Date(now - HISTORY_WINDOW_MS).toISOString())
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) {
    if (!isMissingTable(error)) console.error("load chat history failed", error);
    return [];
  }
  return (data ?? [])
    .reverse()
    .filter((m): m is ChatTurn => m.role === "user" || m.role === "assistant");
}

export async function appendHistory(db: AdminClient, chatId: number, turns: ChatTurn[]) {
  const rows = turns
    .map((t) => ({ chat_id: chatId, role: t.role, content: t.content.trim().slice(0, 8000) }))
    .filter((r) => r.content);
  if (!rows.length) return;
  const { error } = await db.from("telegram_chat_messages").insert(rows);
  if (error && !isMissingTable(error)) console.error("append chat history failed", error);
}

export async function clearHistory(db: AdminClient, chatId: number) {
  const { error } = await db.from("telegram_chat_messages").delete().eq("chat_id", chatId);
  if (error && !isMissingTable(error)) console.error("clear chat history failed", error);
}
