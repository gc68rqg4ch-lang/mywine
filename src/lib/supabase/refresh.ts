// Sitzungserneuerung (Refresh Token) an genau einer Stelle: im Proxy. Supabase rotiert das
// Refresh Token bei jeder Erneuerung; wird ein altes Token nach dem Reuse-Intervall nochmals
// benutzt, gilt das als Missbrauch („refresh_token_already_used“) und Supabase widerruft die
// ganze Sitzung. Darum:
// - Proxy: gleichzeitige Erneuerungen mit demselben Token teilen sich einen Aufruf (sharedRefreshFetch).
// - Server Components, Server Actions, Route Handler: erneuern nie selbst (noRefreshFetch) – eine
//   dort erneuerte Sitzung ginge in Server Components verloren (Cookies nicht setzbar), das alte
//   Token bliebe im Browser und würde später nochmals benutzt.
// Rein bis auf den übergebenen fetch.

/** Erneuerungs-Aufruf von auth-js: POST …/auth/v1/token?grant_type=refresh_token. */
export function isRefreshRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  return method === "POST" && /\/auth\/v1\/token\?(?:.*&)?grant_type=refresh_token(?:&|$)/.test(url);
}

const refreshTokenOf = (init?: RequestInit) => {
  try {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { refresh_token?: unknown }) : null;
    return typeof body?.refresh_token === "string" ? body.refresh_token : null;
  } catch {
    return null;
  }
};

type Stored = { status: number; statusText: string; headers: [string, string][]; body: string };

/**
 * fetch für den Proxy: Erneuerungen mit demselben Refresh Token, die gleichzeitig bzw. innert
 * windowMs laufen (mehrere Anfragen einer Seite, Prefetches), teilen sich einen Aufruf und
 * bekommen dieselbe neue Sitzung. Andere Aufrufe gehen unverändert durch.
 */
export function sharedRefreshFetch(base: typeof fetch = (...a) => fetch(...a), windowMs = 10_000): typeof fetch & { calls: Map<string, Promise<Stored>> } {
  const calls = new Map<string, Promise<Stored>>();
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = isRefreshRequest(input, init) ? refreshTokenOf(init) : null;
    if (!token) return base(input, init);
    let pending = calls.get(token);
    if (!pending) {
      pending = base(input, init).then(async (res) => ({ status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: await res.text() }));
      calls.set(token, pending);
      // Nach dem Fenster vergessen (auch bei Fehlern) – das Token ist dann ohnehin verbraucht.
      const forget = () => setTimeout(() => calls.delete(token), windowMs).unref?.();
      pending.then(forget, () => calls.delete(token));
    }
    const s = await pending;
    return new Response(s.body, { status: s.status, statusText: s.statusText, headers: s.headers });
  }) as typeof fetch & { calls: Map<string, Promise<Stored>> };
  wrapped.calls = calls;
  return wrapped;
}

/** Fehlercode der übersprungenen Erneuerung (noRefreshFetch). */
export const REFRESH_SKIPPED = "refresh_skipped";

/**
 * fetch für Server Components, Server Actions und Route Handler: Erneuerungen werden nicht
 * ausgeführt (der Proxy erneuert vor jeder Seite und jeder Server Action). onSkip meldet, dass
 * eine Erneuerung nötig gewesen wäre – dann dürfen die Auth-Cookies nicht gelöscht werden.
 */
export function noRefreshFetch(base: typeof fetch = (...a) => fetch(...a), onSkip?: () => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isRefreshRequest(input, init)) return base(input, init);
    onSkip?.();
    return new Response(JSON.stringify({ code: REFRESH_SKIPPED, error_code: REFRESH_SKIPPED, msg: "Sitzung wird nur im Proxy erneuert" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

/** Refresh Token schon benutzt bzw. widerrufen → neu anmelden (nicht nochmals erneuern). */
export function isRefreshReuseError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return ["refresh_token_already_used", "refresh_token_not_found", "session_not_found", "session_expired"].includes(error.code ?? "") || /refresh token.*(already used|not found)/i.test(error.message ?? "");
}
