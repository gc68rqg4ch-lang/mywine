// Notizen zum Wein (wines.notes) für die Suche in den Listen: nur laden, wenn gesucht wird.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** wine_id → Notizen (nur Weine mit Notizen). */
export async function loadWineNotes(db: SupabaseClient<Database>, wineIds: string[]) {
  const ids = [...new Set(wineIds)];
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await db.from("wines").select("id, notes").in("id", ids).not("notes", "is", null);
  if (error) {
    console.error("loading wine notes failed", error);
    return new Map<string, string>();
  }
  return new Map((data ?? []).flatMap((w) => (w.notes ? [[w.id, w.notes] as const] : [])));
}
