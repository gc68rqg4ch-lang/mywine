import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";
import { telegramConfig } from "./config";

/** Wer dem Bot gerade schreibt. */
export type Actor = { telegramUserId: number; personId: string | null; name: string };

/**
 * Person zu einer Telegram-User-ID (persons.telegram_user_id). Rückfall:
 * TELEGRAM_ALLOWED_USER_ID gilt als Michel. null = nicht freigeschaltet.
 */
export async function resolveActor(db: AdminClient, telegramUserId: number): Promise<Actor | null> {
  const { data, error } = await db
    .from("persons")
    .select("id, name")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  if (error) throw error;
  if (data) return { telegramUserId, personId: data.id, name: data.name };

  if (telegramConfig().allowedUserId !== telegramUserId) return null;
  const { data: persons } = await db.from("persons").select("id, name").order("sort_order");
  const michel = persons?.find((p) => p.name === "Michel") ?? null;
  return { telegramUserId, personId: michel?.id ?? null, name: michel?.name ?? "Michel" };
}
