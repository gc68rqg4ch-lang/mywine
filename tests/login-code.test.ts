// Login mit 6-stelligem Code von Antoine (Telegram): Code-Erzeugung, Hash/Prüfung, Ablauf nach
// 10 Min., höchstens 5 Versuche, einmalig, neuer Code ersetzt alten, Rate-Limit, gleiche Antwort
// bei unbekannter E-Mail, Telegram-Text, Sitzung ohne Mail, fehlendes Secret → Knopf aus, Proxy.
// Supabase (inkl. Auth-Admin) und Telegram per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { CODE_SENT_TEXT, MAX_ATTEMPTS, RESEND_SECONDS, checkCode, generateCode, hashCode, loginCodeSecret, normalizeCode, rateLimited, type CodeRow } from "@/lib/login/code";
import { findMember, requestLoginCode, startSession, verifyLoginCode } from "@/lib/login/service";
import { T } from "@/lib/bot/texts";
import { config } from "@/proxy";

const SECRET = "test-secret-mit-genug-zeichen";
const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const users: Record<string, { id: string; email: string }> = { [U]: { id: U, email: "Michel@Example.ch" }, [OTHER]: { id: OTHER, email: "anna@example.ch" } };
const authCalls: string[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: () => ({}),
  web: (url) => {
    const u = new URL(url);
    authCalls.push(`${u.pathname}`);
    const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([\w-]+)$/);
    if (m) return users[m[1]] ? { body: JSON.stringify(users[m[1]]), type: "application/json" } : { status: 404, body: JSON.stringify({ msg: "User not found" }), type: "application/json" };
    if (u.pathname === "/auth/v1/admin/generate_link") return { body: JSON.stringify({ ...users[U], action_link: "https://x", hashed_token: "hash-123", verification_type: "magiclink", properties: { hashed_token: "hash-123" } }), type: "application/json" };
    if (u.pathname === "/auth/v1/verify") return { body: JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "bearer", user: users[U] }), type: "application/json" };
    return null;
  },
};
installNet(net);
const db = createAdminClient();
const sent: { chat: number; html: string }[] = [];
const send = async (chat: number, html: string) => void sent.push({ chat, html });

function reset() {
  net.tables = {
    persons: [
      { id: "p1", name: "Michel", user_id: U, telegram_user_id: 111 },
      // Mitglied ohne Telegram-ID: bekommt keinen Code
      { id: "p2", name: "Anna", user_id: OTHER, telegram_user_id: null },
    ],
    app_members: [{ user_id: U }, { user_id: OTHER }],
    login_codes: [],
  };
  sent.length = 0;
  authCalls.length = 0;
}
/** Insert setzt in der Nachbildung keine Standardwerte – wie die DB. */
const defaults = () => net.tables.login_codes.forEach((r, i) => Object.assign(r, { id: r.id ?? `c${i}`, attempts: r.attempts ?? 0, used_at: r.used_at ?? null, invalidated_at: r.invalidated_at ?? null }));
const T0 = Date.parse("2026-10-29T10:00:00Z");
const request = async (email: string, now = T0, code?: string) => {
  const r = await requestLoginCode(db, email, { secret: SECRET, now, send, code });
  defaults();
  return r;
};

test("Code: 6 Ziffern (auch mit führenden Nullen), Eingabe säubern", () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), /^\d{6}$/);
  assert.equal(generateCode(() => 42), "000042");
  assert.equal(normalizeCode(" 123 456 "), "123456");
  assert.equal(normalizeCode("12345"), null);
  assert.equal(normalizeCode("12a456"), null);
  assert.equal(RESEND_SECONDS, 60);
});

test("Hash/Prüfung: an Benutzer und Secret gebunden, nur Hash gespeichert", () => {
  const h = hashCode(SECRET, U, "123456");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, hashCode(SECRET, OTHER, "123456"), "an den Benutzer gebunden");
  assert.notEqual(h, hashCode("anderes-secret-xxxxxxxx", U, "123456"));
  const row: CodeRow = { id: "c", user_id: U, code_hash: h, expires_at: new Date(T0 + 600_000).toISOString(), attempts: 0, used_at: null, invalidated_at: null };
  const check = (code: string, extra: Partial<CodeRow> = {}, now = T0) => checkCode({ ...row, ...extra }, { userId: U, code, secret: SECRET, now });
  assert.equal(check("123456"), "ok");
  assert.equal(check("654321"), "wrong");
  assert.equal(check("123456", {}, T0 + 600_000), "expired", "nach 10 Minuten abgelaufen");
  assert.equal(check("123456", { attempts: MAX_ATTEMPTS }), "locked");
  assert.equal(check("123456", { used_at: "x" }), "none", "einmalig");
  assert.equal(check("123456", { invalidated_at: "x" }), "none");
  assert.equal(checkCode(null, { userId: U, code: "123456", secret: SECRET, now: T0 }), "none");
});

test("Anfordern: Telegram an die verknüpfte Person, in der DB nur der Hash; Mail-Adresse Gross/Klein egal", async () => {
  reset();
  assert.equal(await request("  michel@example.ch ", T0, "042137"), "sent");
  assert.deepEqual(sent.map((s) => s.chat), [111]);
  assert.match(sent[0].html, /<code>042137<\/code>/);
  const row = net.tables.login_codes[0];
  assert.equal(row.user_id, U);
  assert.equal(row.code_hash, hashCode(SECRET, U, "042137"));
  assert.ok(!JSON.stringify(row).includes("042137"), "Code nie im Klartext gespeichert");
  assert.equal(row.expires_at, new Date(T0 + 10 * 60_000).toISOString());
  assert.equal(net.telegram.length, 0, "nicht über den Bot-Verlauf (eigene Sendefunktion)");
  assert.ok(!("telegram_chat_messages" in net.tables), "nicht im Gesprächsgedächtnis");
});

test("Unbekannte E-Mail bzw. Mitglied ohne Telegram: kein Code, gleiche Antwort an die Seite", async () => {
  reset();
  assert.equal(await request("fremd@example.ch"), "unknown");
  assert.equal(await request("anna@example.ch"), "unknown", "ohne Telegram-ID");
  assert.equal(sent.length, 0);
  assert.equal(net.tables.login_codes.length, 0);
  assert.equal(await findMember(db, "michel@example.ch").then((m) => m?.telegramId), 111);
  const action = readFileSync("src/app/login/actions.ts", "utf8");
  assert.match(action, /return \{ ok: true, message: CODE_SENT_TEXT \};/, "bekannt, unbekannt und zu oft: gleiche Antwort");
  assert.equal(CODE_SENT_TEXT, "Falls die Adresse bekannt ist, hat Antoine dir einen Code per Telegram geschickt.");
});

test("Prüfen: richtig → einmalig; falsch zählt; nach 5 Fehlversuchen ungültig; abgelaufen", async () => {
  reset();
  await request("michel@example.ch", T0, "111111");
  const wrong = await verifyLoginCode(db, "michel@example.ch", "222222", { secret: SECRET, now: T0 + 1000 });
  assert.deepEqual(wrong, { ok: false, error: "Der Code stimmt nicht – noch 4 Versuche." });
  assert.equal(net.tables.login_codes[0].attempts, 1);
  const right = await verifyLoginCode(db, "michel@example.ch", "111111", { secret: SECRET, now: T0 + 2000 });
  assert.ok(right.ok && right.member.userId === U);
  const again = await verifyLoginCode(db, "michel@example.ch", "111111", { secret: SECRET, now: T0 + 3000 });
  assert.equal(again.ok, false, "einmalig verwendbar");
  // 5 Fehlversuche → ungültig, auch der richtige Code danach
  reset();
  await request("michel@example.ch", T0, "333333");
  const messages: string[] = [];
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const r = await verifyLoginCode(db, "michel@example.ch", "000000", { secret: SECRET, now: T0 + i });
    if (!r.ok) messages.push(r.error);
  }
  assert.equal(messages.at(-2), "Der Code stimmt nicht – noch 1 Versuch.");
  assert.match(messages.at(-1)!, /nicht mehr gültig/);
  assert.equal((await verifyLoginCode(db, "michel@example.ch", "333333", { secret: SECRET, now: T0 + 10 })).ok, false);
  // Abgelaufen nach 10 Minuten
  reset();
  await request("michel@example.ch", T0, "444444");
  const late = await verifyLoginCode(db, "michel@example.ch", "444444", { secret: SECRET, now: T0 + 10 * 60_000 + 1 });
  assert.deepEqual(late, { ok: false, error: "Der Code ist abgelaufen – bitte einen neuen Code senden." });
  // Unbekannte E-Mail: gleiche allgemeine Meldung
  assert.deepEqual(await verifyLoginCode(db, "fremd@example.ch", "444444", { secret: SECRET, now: T0 }), { ok: false, error: "Der Code ist nicht mehr gültig – bitte einen neuen Code senden." });
});

test("Neuer Code macht den alten ungültig", async () => {
  reset();
  await request("michel@example.ch", T0, "555555");
  await request("michel@example.ch", T0 + 61_000, "666666");
  assert.equal(net.tables.login_codes[0].invalidated_at, new Date(T0 + 61_000).toISOString());
  assert.equal((await verifyLoginCode(db, "michel@example.ch", "555555", { secret: SECRET, now: T0 + 62_000 })).ok, false, "alter Code gilt nicht mehr");
  assert.equal((await verifyLoginCode(db, "michel@example.ch", "666666", { secret: SECRET, now: T0 + 63_000 })).ok, true);
});

test("Rate-Limit: höchstens 5 Anforderungen pro Person in 15 Minuten", async () => {
  assert.equal(rateLimited([], T0), false);
  const four = [1, 2, 3, 4].map((m) => new Date(T0 - m * 60_000).toISOString());
  assert.equal(rateLimited(four, T0), false);
  assert.equal(rateLimited([...four, new Date(T0 - 5 * 60_000).toISOString()], T0), true);
  assert.equal(rateLimited([...four, new Date(T0 - 16 * 60_000).toISOString()], T0), false, "älter als 15 Minuten zählt nicht");
  reset();
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await request("michel@example.ch", T0 + i * 60_000));
  assert.deepEqual(results, ["sent", "sent", "sent", "sent", "sent", "limited"]);
  assert.equal(sent.length, 5);
});

test("Sitzung ohne Mail: generateLink (magiclink) → verifyOtp mit token_hash", async () => {
  reset();
  assert.equal(await startSession(db, db, "Michel@Example.ch"), true);
  assert.deepEqual(authCalls, ["/auth/v1/admin/generate_link", "/auth/v1/verify"]);
});

test("Telegram-Text von Antoine: Code, 10 Minuten, Hinweis zum Ignorieren", () => {
  const text = T.loginCode("042137", () => 0);
  assert.equal(text, "🔑 Dein Code für die Anmeldung in der App: <b><code>042137</code></b>\nEr gilt 10 Minuten. Hast du das nicht angefordert? Dann ignoriere die Nachricht.");
  assert.ok(!text.includes("ß"));
});

test("Ohne Secret: Knopf „Code per Telegram“ aus, Mail-Link bleibt", () => {
  assert.equal(loginCodeSecret({}), null);
  assert.equal(loginCodeSecret({ LOGIN_CODE_SECRET: "kurz" }), null, "zu kurz");
  assert.equal(loginCodeSecret({ LOGIN_CODE_SECRET: SECRET }), SECRET);
  const page = readFileSync("src/app/login/page.tsx", "utf8");
  assert.match(page, /const codeEnabled = loginCodeSecret\(\) != null;/);
  const form = readFileSync("src/app/login/login-form.tsx", "utf8");
  assert.match(form, /\{codeEnabled && \(\s*<button[^>]*onClick=\{requestCode\}/);
  assert.match(form, /"Link per E-Mail"/);
  assert.match(form, /inputMode="numeric"[\s\S]*autoComplete="one-time-code"/);
});

test("Proxy: Login-Seite ohne Anmeldung, alles andere geschützt; Logs ohne Code und E-Mail", () => {
  const proxy = readFileSync("src/lib/supabase/proxy.ts", "utf8");
  assert.match(proxy, /const PUBLIC_PATHS = \[[^\]]*"\/login"/);
  assert.ok(new RegExp(`^${config.matcher[0]}$`).test("/login"), "läuft durch den Proxy (öffentlich)");
  const service = readFileSync("src/lib/login/service.ts", "utf8");
  for (const line of service.split("\n").filter((l) => /console\.(log|warn|error)/.test(l))) {
    assert.ok(!/\bemail\b|\bcode\b(?!\s*:)/.test(line.replace(/"[^"]*"/g, "")), `Log ohne Code/E-Mail: ${line.trim()}`);
  }
});
