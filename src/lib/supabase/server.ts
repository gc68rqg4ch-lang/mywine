import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";
import { noRefreshFetch } from "./refresh";

/** Cookie-Zugriff wie next/headers cookies() (für Tests nachbildbar). */
type CookieStore = { getAll(): { name: string; value: string }[]; set(name: string, value: string, options?: object): unknown };

/**
 * Supabase-Client für Server Components, Server Actions und Route Handler.
 * Pro Request neu erzeugen – nie global teilen. Erneuert die Sitzung nie selbst (das macht nur
 * der Proxy, vor jeder Seite und Server Action); wäre eine Erneuerung nötig, bleiben die Cookies
 * unangetastet (kein halber Zustand, kein zweiter Gebrauch des Refresh Tokens).
 */
export async function createClient() {
  return serverClientFor(await cookies());
}

/** Wie createClient, mit gegebenem Cookie-Zugriff (und fetch für Tests). */
export function serverClientFor(cookieStore: CookieStore, baseFetch?: typeof fetch) {
  let skipped = false;

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    global: { fetch: noRefreshFetch(baseFetch, () => (skipped = true)) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Übersprungene Erneuerung: auth-js würde die Sitzung löschen – die Cookies bleiben.
        if (skipped) return;
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Aufruf aus einer Server Component: Cookies können dort nicht
          // gesetzt werden. Der Proxy erneuert die Session ohnehin.
        }
      },
    },
  });
}
