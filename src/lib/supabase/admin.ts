import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabaseUrl } from "./env";

/**
 * Supabase-Client mit dem Secret Key – umgeht RLS. Nur serverseitig verwenden
 * (Telegram-Bot; in der App nur zum Löschen von Fotodateien nach Prüfung der
 * Mitgliedschaft), nie an den Browser geben.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("SUPABASE_SECRET_KEY ist nicht gesetzt.");

  return createClient<Database>(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
