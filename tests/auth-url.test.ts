// Abgelaufener Login-Link: Fehler-Teil von Supabase Auth aus der Adresse entfernen (Hash und
// Query), übrige Teile bleiben; Hinweis nur auf der Login-Seite. Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EXPIRED_LINK_TEXT, cleanAuthErrorUrl } from "@/lib/auth-url";

const BAD = "https://mywine-seven.vercel.app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=";

test("Hash mit Fehler: entfernt (samt sb=), Fehlercode gemeldet", () => {
  assert.deepEqual(cleanAuthErrorUrl(BAD), { url: "/", error: "otp_expired" });
  assert.deepEqual(cleanAuthErrorUrl("https://x.app/offen?gruppe=land#error=access_denied&sb="), { url: "/offen?gruppe=land", error: "access_denied" });
  assert.deepEqual(cleanAuthErrorUrl("https://x.app/#error_description=kaputt&weiter=1"), { url: "/#weiter=1", error: "error" }, "andere Hash-Teile bleiben");
});

test("Query mit Fehler: entfernt, normale Parameter wie q bleiben", () => {
  assert.deepEqual(cleanAuthErrorUrl("https://x.app/?q=pintia&error=access_denied&error_code=otp_expired&error_description=x"), { url: "/?q=pintia", error: "otp_expired" });
  assert.deepEqual(cleanAuthErrorUrl("https://x.app/verkostet?error=server_error&gruppe=land"), { url: "/verkostet?gruppe=land", error: "server_error" });
});

test("Ohne Fehler: unverändert (auch normale Hashes wie Anker)", () => {
  for (const href of ["https://x.app/", "https://x.app/?q=cuvee&gruppe=land", "https://x.app/wein/1#notes", "https://x.app/?sb=1"]) {
    const u = new URL(href);
    assert.deepEqual(cleanAuthErrorUrl(href), { url: `${u.pathname}${u.search}${u.hash}`, error: null }, href);
  }
});

test("Auf allen Seiten (Layout) per replaceState, Hinweis nur auf der Login-Seite", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.match(layout, /<AuthUrlCleanup \/>/);
  const component = readFileSync("src/components/auth-url-cleanup.tsx", "utf8");
  assert.match(component, /window\.history\.replaceState\(window\.history\.state, "", url\)/);
  assert.ok(!/location\.(reload|href\s*=)/.test(component), "ohne Neuladen");
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  assert.match(login, /<ExpiredLinkNotice \/>/);
  assert.match(login, /if \(data\?\.claims\?\.sub\) redirect\(next\);/, "angemeldet: weiter, kein Hinweis");
  assert.equal(EXPIRED_LINK_TEXT, "Der Login-Link ist abgelaufen – bitte neuen Link anfordern.");
});
