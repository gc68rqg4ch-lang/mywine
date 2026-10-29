import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";
import { isRefreshReuseError, sharedRefreshFetch } from "./refresh";

// /api/telegram: Webhook ohne Cookies (prüft selbst das Secret); die Setup-Route
// prüft die Session selbst.
// /api/research/worker prüft sein Secret selbst (Aufruf durch pg_cron, ohne Anmeldung).
const PUBLIC_PATHS = ["/login", "/auth", "/api/telegram", "/api/research/worker", "/api/home/daily"];

/** Für alle Anfragen dieser Instanz: gleichzeitige Erneuerungen mit demselben Token teilen sich einen Aufruf. */
const sharedFetch = sharedRefreshFetch();

/**
 * Erneuert die Supabase-Session – als einzige Stelle (Server Components, Actions und Route
 * Handler lesen nur, siehe server.ts) – und leitet nicht angemeldete Besucher auf /login um
 * (mit Rücksprung-Adresse). Refresh Token schon benutzt bzw. widerrufen: nicht nochmals
 * erneuern, Auth-Cookies löschen und einmal sauber zum Login.
 */
export async function updateSession(request: NextRequest, options: { fetch?: typeof fetch } = {}) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    global: { fetch: options.fetch ?? sharedFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Zwischen Client-Erzeugung und getClaims() keinen weiteren Code ausführen,
  // sonst kann die Session-Erneuerung verloren gehen.
  const { data, error } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims?.sub);
  const reused = isRefreshReuseError(error);
  if (reused) console.warn("session refresh rejected", error?.code ?? error?.message);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isLoggedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const back = `${pathname}${request.nextUrl.search}`;
    if (back !== "/") url.searchParams.set("next", back);
    const redirect = NextResponse.redirect(url);
    // Erneuerte bzw. gelöschte Auth-Cookies auch beim Redirect mitschicken.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
