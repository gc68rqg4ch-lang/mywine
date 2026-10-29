// Sitzungserneuerung nur im Proxy: gleichzeitige Anfragen mit abgelaufenem Access Token → eine
// Erneuerung; Server Components/Actions/Route Handler erneuern nie (Cookies bleiben); Refresh
// Token schon benutzt → einmal sauber zum Login (mit Rücksprung), Auth-Cookies gelöscht. Dazu die
// E-Mail ohne unsichtbare Zeichen. Nachgebildete Auth-API – ohne Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/proxy";
import { serverClientFor } from "@/lib/supabase/server";
import { isRefreshReuseError, isRefreshRequest, sharedRefreshFetch } from "@/lib/supabase/refresh";
import { CODE_HINT_TEXT, CODE_SENT_TEXT, cleanEmail } from "@/lib/login/code";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", email: "mk@example.ch", exp, iat: exp - 3600, aud: "authenticated", role: "authenticated", session_id: "s1" })}.c2ln`;
const now = () => Math.floor(Date.now() / 1000);
const USER = { id: "u1", email: "mk@example.ch", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const COOKIE = "sb-stub-auth-token";
/** Abgelaufene Sitzung im Cookie (Format von @supabase/ssr: „base64-“ + JSON). */
const expiredCookie = () => `base64-${b64({ access_token: jwt(now() - 60), refresh_token: "r1", expires_at: now() - 60, expires_in: 3600, token_type: "bearer", user: USER })}`;

type Stub = { refreshes: number; fetch: typeof fetch };
function authApi(refresh: "ok" | "already_used", delayMs = 30): Stub {
  const stub: Stub = { refreshes: 0, fetch: undefined as unknown as typeof fetch };
  stub.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (isRefreshRequest(input, init)) {
      stub.refreshes++;
      await new Promise((r) => setTimeout(r, delayMs));
      if (refresh === "already_used") {
        return new Response(JSON.stringify({ code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return Response.json({ access_token: jwt(now() + 3600), refresh_token: "r2", expires_in: 3600, expires_at: now() + 3600, token_type: "bearer", user: USER });
    }
    if (url.includes("/auth/v1/user")) return Response.json(USER);
    throw new Error(`unerwartet: ${url}`);
  }) as typeof fetch;
  return stub;
}
const request = (path: string) => new NextRequest(`https://mywine.example${path}`, { headers: { cookie: `${COOKIE}=${expiredCookie()}` } });

test("Proxy: drei gleichzeitige Anfragen mit abgelaufenem Token → eine Erneuerung, alle angemeldet mit neuer Sitzung", async () => {
  const api = authApi("ok");
  const shared = sharedRefreshFetch(api.fetch);
  const responses = await Promise.all(["/", "/bestand", "/offen"].map((p) => updateSession(request(p), { fetch: shared })));
  assert.equal(api.refreshes, 1, "nur eine Erneuerung");
  for (const r of responses) {
    assert.equal(r.status, 200, "kein Redirect");
    const set = r.cookies.get(COOKIE)?.value ?? "";
    assert.match(Buffer.from(set.replace(/^base64-/, ""), "base64url").toString(), /"refresh_token":"r2"/);
  }
});

test("Ein Client, mehrere parallele getClaims → eine Erneuerung", async () => {
  const api = authApi("ok");
  let jar = [{ name: COOKIE, value: expiredCookie() }];
  const client = createServerClient("https://stub.supabase.co", "stub", {
    global: { fetch: sharedRefreshFetch(api.fetch) },
    cookies: { getAll: () => jar, setAll: (c) => { jar = c.map(({ name, value }) => ({ name, value })); } },
  });
  const results = await Promise.all([client.auth.getClaims(), client.auth.getClaims(), client.auth.getClaims()]);
  assert.ok(results.every((r) => r.data?.claims?.sub === "u1"));
  assert.equal(api.refreshes, 1);
});

test("Server Components/Actions/Route Handler erneuern nie selbst – die Cookies bleiben unangetastet", async () => {
  const api = authApi("ok");
  const jar = new Map([[COOKIE, expiredCookie()]]);
  const writes: string[] = [];
  const client = serverClientFor({ getAll: () => [...jar].map(([name, value]) => ({ name, value })), set: (name) => writes.push(name) }, api.fetch);
  const { data, error } = await client.auth.getClaims();
  assert.equal(api.refreshes, 0, "keine Erneuerung ausserhalb des Proxys");
  assert.ok(!data?.claims && error, "abgelaufen: nicht angemeldet (der Proxy hätte erneuert)");
  assert.deepEqual(writes, [], "Cookies nicht gelöscht");
});

test("Refresh Token schon benutzt → nicht nochmals erneuern, einmal zum Login mit Rücksprung, Auth-Cookies gelöscht", async () => {
  const api = authApi("already_used");
  const res = await updateSession(request("/bestand?gruppe=land"), { fetch: sharedRefreshFetch(api.fetch) });
  assert.equal(api.refreshes, 1, "genau ein Versuch");
  assert.equal(res.status, 307);
  const to = new URL(res.headers.get("location")!);
  assert.deepEqual([to.pathname, to.searchParams.get("next")], ["/login", "/bestand?gruppe=land"]);
  const cleared = res.cookies.getAll().filter((c) => c.name.startsWith("sb-stub-auth-token"));
  assert.ok(cleared.length && cleared.every((c) => c.value === ""), "Auth-Cookies gelöscht");
  assert.ok(isRefreshReuseError({ code: "refresh_token_already_used" }));
  assert.ok(isRefreshReuseError({ message: "Invalid Refresh Token: Already Used" }));
  assert.ok(!isRefreshReuseError({ code: "over_request_rate_limit" }));
  // Login-Seite selbst: kein Redirect (keine Schleife)
  const login = await updateSession(request("/login"), { fetch: sharedRefreshFetch(authApi("already_used").fetch) });
  assert.equal(login.status, 200);
});

test("Login: E-Mail mit unsichtbaren Zeichen wird erkannt; Hinweis nach „Code anfordern“", () => {
  assert.equal(cleanEmail("​mk@example.ch‍"), "mk@example.ch");
  assert.equal(cleanEmail(" MK@Example.CH﻿ "), "mk@example.ch");
  assert.equal(cleanEmail("m­k@exa⁠mple.ch"), "mk@example.ch");
  assert.equal(cleanEmail("‪mk@example.ch‬"), "mk@example.ch");
  assert.equal(CODE_SENT_TEXT, "Falls die Adresse bekannt ist, hat Antoine dir einen Code per Telegram geschickt.", "Meldung unverändert");
  assert.equal(CODE_HINT_TEXT, "Kommt in 1 Minute kein Code von Antoine, prüfe die E-Mail-Adresse (am besten von Hand tippen).");
});
