"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Supabase-Client im Browser (Sitzung aus den Cookies). Nur für Uploads direkt in den
 * Storage (z. B. PDFs bis 20 MB – zu gross für eine Server Action auf Vercel).
 * RLS gilt wie überall: nur Mitglieder dürfen hochladen.
 */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);
}
