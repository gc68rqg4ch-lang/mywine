// Startseite mit Antoine: alte Adressen („/?…“ → „/bestand?…“), Platzhalter → Links,
// Ersatztext (Tageszeit, Person, Einzahl/Mehrzahl, nichts ohne Daten), die letzten 7 Tage als
// Eingabe, Zählungen „getrunken“ und Ausgaben an Monats-/Jahresgrenzen (Europe/Zurich), Secret der
// Route, API-Limit → Ersatztext ohne neuen Versuch. Supabase, Telegram und Claude per fetch-Stub.
// Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claudeError, claudeText, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { legacyListTarget } from "@/lib/home/redirect";
import { buildRefs, placeholdersIn, plainNote, renderNote, type WineRef } from "@/lib/home/note";
import { fallbackNote, type FallbackInput } from "@/lib/home/fallback";
import { recentNotes, dailyPrompt, DailyNoteSchema } from "@/lib/home/prompt";
import { previousTexts, noteContext } from "@/lib/home/compose";
import { greetingSlot, greetingText, stripGreeting } from "@/lib/home/greeting";
import { zurichParts } from "@/lib/home/dates";
import { DAILY_SYSTEM } from "@/lib/home/prompt";
import { drunkByType, spending, stockUnits, unitKey, type DrunkItem, type Purchase, type StockItem } from "@/lib/home/summary";
import { generateAllDailyNotes, generateDailyNote, USAGE_LIMIT_ERROR } from "@/lib/home/daily";
import { DAILY_SECRET_HEADER, workerSecretFrom } from "@/lib/secret";
import { findOrphanFiles } from "@/lib/media/orphans";
import { countUnionParams, MAX_UNION_PARAMS } from "@/lib/ai/schema-limits";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

const PINTIA = "11111111-1111-4111-8111-111111111111";
const ALION = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const SARA = "96c222d0-3a8c-4d5f-9564-f5654769ecd6";
const LIMIT = "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
// Donnerstag, 29. Oktober 2026, 07:30 in Zürich (06:30 UTC, Winterzeit ab 25. Oktober).
const NOW = Date.parse("2026-10-29T06:30:00Z");

const item = (over: Partial<StockItem>): StockItem => ({
  itemId: "i1", wineId: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", year: 2019, status: "sealed", quantity: 1,
  paid: 50, regular: 60, dateOpened: null, purchasedAt: null, drinkFrom: 2022, drinkUntil: 2030, ...over,
});

test("alte Adressen: /?… mit Listen-Parametern → /bestand?…, ohne bleibt die Startseite", () => {
  assert.equal(legacyListTarget({}), null);
  assert.equal(legacyListTarget({ zoomdebug: "1" }), null);
  assert.equal(legacyListTarget({ q: "pintia" }), "/bestand?q=pintia");
  assert.equal(
    legacyListTarget({ gruppe: "trinkreife", auf: ["ready", "now"], typ: "white", land: "Spanien" }),
    "/bestand?gruppe=trinkreife&auf=ready&auf=now&typ=white&land=Spanien",
  );
  // Andere Parameter kommen mit (dieselben Parameter).
  assert.equal(legacyListTarget({ reife: "overdue", x: "1" }), "/bestand?reife=overdue&x=1");
  assert.equal(legacyListTarget({ q: "Côte & Rhône" }), "/bestand?q=C%C3%B4te+%26+Rh%C3%B4ne");
  // Die Startseite leitet weiter; „MyWine“ führt zur Startseite, „Bestand“ ist der erste Reiter.
  const page = readFileSync("src/app/(cellar)/page.tsx", "utf8");
  assert.match(page, /legacyListTarget\(await searchParams\)/);
  assert.match(page, /if \(target\) redirect\(target\)/);
  assert.match(readFileSync("src/app/(cellar)/layout.tsx", "utf8"), /<Link href="\/" className="brand">/);
  const nav = readFileSync("src/components/nav-links.tsx", "utf8");
  assert.match(nav, /const links = \[\s*\{ href: "\/bestand", label: "Bestand"/);
  assert.match(readFileSync("src/app/(cellar)/bestand/page.tsx", "utf8"), /basePath="\/bestand"/);
});

test("Platzhalter → Links: gültig, unbekannt (fällt weg), nicht vorrätig (reiner Text)", () => {
  const refs: WineRef[] = [
    { ref: "W1", wine_id: PINTIA, vintage_year: 2019, name: "Pintia 2019" },
    { ref: "W2", wine_id: GONE, vintage_year: null, name: "Fay" },
  ];
  const inStock = new Set([unitKey(PINTIA, 2019)]);
  const { segments, errors } = renderNote("Öffne doch {{W1}} heute. {{W9}} wäre auch schön. {{ W2 }} ist leider weg.", refs, inStock);
  assert.deepEqual(segments, [
    { kind: "text", text: "Öffne doch " },
    { kind: "wine", ref: "W1", label: "Pintia 2019", href: `/wein/${PINTIA}?jahrgang=2019&von=start` },
    { kind: "text", text: " heute. wäre auch schön. " },
    { kind: "wine", ref: "W2", label: "Fay", href: null },
    { kind: "text", text: " ist leider weg." },
  ]);
  assert.deepEqual(errors, ["unbekannt: W9", "nicht vorrätig: W2"]);
  // Unbekannt vor einem Satzzeichen: kein Leerzeichen davor.
  assert.equal(renderNote("Probier {{W7}}.", refs, inStock).segments[0].kind === "text" && (renderNote("Probier {{W7}}.", refs, inStock).segments[0] as { text: string }).text, "Probier.");
  assert.deepEqual(placeholdersIn("{{W1}} und {{W2}} und {{W1}}"), ["W1", "W2"]);
  assert.equal(plainNote("Gestern {{W1}}, dann {{W2}}.", refs), "Gestern Pintia 2019, dann Fay.");
});

test("Kandidaten für Antoine: nur Weine mit ungeöffneten oder offenen Flaschen, Dringendes zuerst", () => {
  const units = stockUnits(
    [
      item({ itemId: "a", wineId: ALION, name: "Alion", year: 2018, drinkFrom: 2020, drinkUntil: 2024 }),
      item({ itemId: "b" }),
      item({ itemId: "c", wineId: GONE, name: "Fay", year: 2020, status: "open", dateOpened: "2026-10-20" }),
    ],
    2026,
  );
  const refs = buildRefs(units);
  assert.deepEqual(refs.map((r) => r.name), ["Alion 2018", "Fay 2020", "Pintia 2019"]);
  assert.deepEqual(refs.map((r) => r.ref), ["W1", "W2", "W3"]);
});

const base = (over: Partial<FallbackInput> = {}): FallbackInput => ({
  person: "Michel", now: NOW, units: [], open: [], recent: [], drunkThisMonth: 0, pendingSuggestions: 0, ...over,
});

test("Ersatztext: ohne Begrüssung und Tageszeit, Einzahl/Mehrzahl, keine Aussage ohne Daten", () => {
  // Ohne Daten: nur leerer Keller und Abschluss – keine Zahlen, kein Höhepunkt, keine Weine.
  const empty = fallbackNote(base());
  assert.doesNotMatch(empty.text, /\d|Höhepunkt|getrunken|Vorschl|offen|\{\{/);
  assert.deepEqual(empty.refs, []);
  // Keine eigene Begrüssung (die setzt die App davor) – morgens wie abends, mit und ohne Person.
  for (const now of [NOW, Date.parse("2026-10-29T19:00:00Z"), Date.parse("2026-10-29T23:30:00Z")]) {
    for (const person of ["Michel", null]) {
      const t = fallbackNote(base({ now, person })).text;
      assert.doesNotMatch(t, /Guten|Hallo|Grüezi|Morgen|Mittag|Nachmittag|Abend|Nacht|Michel|undefined|null/, t);
      assert.equal(stripGreeting(t), t);
    }
  }
  // Einzahl: eine Flasche, ein Wein, eine über dem Höhepunkt, eine getrunken, ein Vorschlag.
  const one = fallbackNote(
    base({
      units: stockUnits([item({ drinkFrom: 2018, drinkUntil: 2024 })], 2026),
      drunkThisMonth: 1,
      pendingSuggestions: 1,
    }),
  );
  assert.match(one.text, /1 Flasche\b/);
  assert.match(one.text, /einem Wein|ein Wein/);
  assert.doesNotMatch(one.text, /1 Flaschen|1 Weinen|1 Vorschläge/);
  assert.match(one.text, /\{\{W1\}\}/);
  assert.match(one.text, /(ist schon 1 Flasche|wurde 1 Flasche)/);
  assert.match(one.text, /(einen Vorschlag|ein Vorschlag)/);
  assert.deepEqual(one.refs, [{ ref: "W1", wine_id: PINTIA, vintage_year: 2019, name: "Pintia 2019" }]);
  // Links im Ersatztext wie bei Claude.
  const links = renderNote(one.text, one.refs, new Set([unitKey(PINTIA, 2019)])).segments.filter((s) => s.kind === "wine");
  assert.equal(links.length, 1);

  // Mehrzahl: 3 Flaschen über dem Höhepunkt, 4 getrunken, 2 Vorschläge, eine seit 5 Tagen offene.
  const many = fallbackNote(
    base({
      units: stockUnits(
        [
          item({ quantity: 3, drinkFrom: 2018, drinkUntil: 2024 }),
          item({ itemId: "x", wineId: ALION, name: "Alion", year: 2018, status: "open", dateOpened: "2026-10-24" }),
        ],
        2026,
      ),
      open: [{ wineId: ALION, year: 2018, days: 5 }],
      drunkThisMonth: 4,
      pendingSuggestions: 2,
    }),
  );
  assert.match(many.text, /3 Flaschen/);
  assert.match(many.text, /4 Flaschen/);
  assert.match(many.text, /2 Vorschläge/);
  assert.match(many.text, /5 Tagen/);
  assert.equal(many.refs.length, 2);
  // Gleicher Tag + Person → derselbe Text (Neuladen); kein ß.
  assert.equal(fallbackNote(base({ drunkThisMonth: 4 })).text, fallbackNote(base({ drunkThisMonth: 4 })).text);
  for (const t of [empty.text, one.text, many.text]) assert.doesNotMatch(t, /ß/);
});

test("die letzten 7 Tage als Eingabe: nur fertige Texte vor heute, neuste zuerst", () => {
  const rows = [
    { note_date: "2026-10-29", status: "done", text: "heute", wines: [] },
    { note_date: "2026-10-28", status: "done", text: "Gestern {{W1}}.", wines: [{ ref: "W1", wine_id: PINTIA, vintage_year: 2019, name: "Pintia 2019" }] },
    { note_date: "2026-10-25", status: "failed", text: null, wines: [] },
    { note_date: "2026-10-22", status: "done", text: "vor 7 Tagen", wines: [] },
    { note_date: "2026-10-21", status: "done", text: "vor 8 Tagen", wines: [] },
    { note_date: "2026-10-24", status: "done", text: "vor 5 Tagen", wines: [] },
  ];
  assert.deepEqual(recentNotes(rows, "2026-10-29").map((r) => r.text), ["Gestern {{W1}}.", "vor 5 Tagen", "vor 7 Tagen"]);
  // Für Claude mit Namen statt Platzhaltern (die Kürzel gelten nur für einen Tag).
  assert.deepEqual(previousTexts(rows, "2026-10-29")[0], { date: "2026-10-28", text: "Gestern Pintia 2019." });
});

test("getrunken diesen Monat / dieses Jahr nach Typ – Grenzen in Europe/Zurich", () => {
  const d = (drunkAt: string, type: DrunkItem["type"], quantity = 1): DrunkItem => ({ wineId: PINTIA, name: "Pintia", type, year: 2019, quantity, drunkAt });
  const drunk = [
    d("2026-09-30T22:30:00Z", "red"), // 1. Oktober 00:30 in Zürich → Oktober
    d("2026-09-30T21:30:00Z", "white"), // 30. September 23:30 → nicht im Oktober, aber im Jahr
    d("2026-10-29", "red", 2),
    d("2026-10-05T12:00:00Z", "sparkling"),
    d("2025-12-31T23:30:00Z", "rose"), // 1. Januar 2026 00:30 → dieses Jahr
    d("2025-12-31T22:30:00Z", "red"), // 31. Dezember 2025 23:30 → Vorjahr
    d("2026-10-10", null),
  ];
  const c = drunkByType(drunk, NOW);
  assert.equal(c.month.total, 5);
  assert.deepEqual(c.month.byType, [{ type: "red", bottles: 3 }, { type: "sparkling", bottles: 1 }, { type: "unknown", bottles: 1 }]);
  assert.equal(c.year.total, 7);
  assert.deepEqual(c.year.byType.map((t) => t.type), ["red", "white", "rose", "sparkling", "unknown"]);
  // Monatsgrenze am 1. November 00:30 Zürich: der Oktober zählt nicht mehr.
  assert.equal(drunkByType(drunk, Date.parse("2026-10-31T23:30:00Z")).month.total, 0);
});

test("Ausgaben dieses Jahr und Vorjahr, Geschenke separat", () => {
  const p = (at: string, quantity: number, price: number | null, gift = false): Purchase => ({ at, wineId: PINTIA, name: "Pintia", year: 2019, quantity, price, gift });
  const purchases = [
    p("2026-03-01T10:00:00Z", 6, 40),
    p("2026-10-20T10:00:00Z", 2, 55.5),
    p("2026-05-01T10:00:00Z", 3, null, true),
    p("2025-12-31T23:30:00Z", 1, 100), // 1. Januar 2026 in Zürich
    p("2025-06-01T10:00:00Z", 12, 20),
    p("2025-07-01T10:00:00Z", 1, 80, true),
    p("2024-12-01T10:00:00Z", 1, 999),
  ];
  const s = spending(purchases, 2026);
  assert.deepEqual(s.thisYear, { chf: 6 * 40 + 2 * 55.5 + 100, bottles: 9, gifts: 3 });
  assert.deepEqual(s.lastYear, { chf: 240, bottles: 12, gifts: 1 });
});

test("Antwort-Schema bleibt in den Grenzen der Claude API", () => {
  const schema = (betaZodOutputFormat(DailyNoteSchema) as { schema: unknown }).schema;
  assert.ok(countUnionParams(schema) <= MAX_UNION_PARAMS);
  assert.equal(countUnionParams(schema), 0);
});

// --- Mit Stub: Erzeugen, API-Limit, Route

let claude: (body: Record<string, unknown>) => Record<string, unknown> = () => claudeText({ text: "Guten Morgen, Michel. Heute würde ich {{W1}} öffnen." });
const calls: Record<string, unknown>[] = [];
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: (body) => (calls.push(body), claude(body)), storage: new Map() };
installNet(net);
const db = createAdminClient();

function reset() {
  calls.length = 0;
  net.storage = new Map();
  net.tables = {
    persons: [
      { id: MICHEL, name: "Michel", sort_order: 0, user_id: "u1", telegram_user_id: 111 },
      { id: SARA, name: "Sara", sort_order: 1, user_id: "u2", telegram_user_id: 222 },
      { id: "p3", name: "Gast", sort_order: 2, user_id: null },
    ],
    cellar_overview: [
      { inventory_item_id: "i1", wine_id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", vintage_year: 2019, status: "sealed", quantity: 2, stock_value: 100, stock_value_regular: 120, date_opened: null, purchased_at: "2026-10-20", drink_from_year: 2018, drink_until_year: 2024 },
    ],
    inventory_items: [{ id: "d1", wine_id: ALION, vintage_year: 2018, quantity: 1, status: "drunk", drunk_at: "2026-10-10" }],
    wines: [{ id: PINTIA, name: "Pintia", type: "red" }, { id: ALION, name: "Alion", type: "red" }],
    inventory_events: [{ id: "e1", event_type: "purchased", occurred_at: "2026-10-20T10:00:00Z", wine_id: PINTIA, vintage_year: 2019, quantity: 2, price: 50, item_id: "i1" }],
    wine_encounters: [],
    wine_ratings: [{ id: "r1", person_id: MICHEL, wine_id: ALION, vintage_year: 2018, rating: 4.5, rated_at: "2026-10-10" }],
    wine_taste_profiles: [{ id: "t1", wine_id: ALION, vintage_year: 2018, style_summary: "kraftvoll, dunkle Frucht" }],
    research_suggestions: [],
    daily_notes: [],
  };
}

test("Tagestext erzeugen: Daten kompakt, letzte Tage mitgegeben, nur genannte Weine gespeichert", async () => {
  reset();
  net.tables.daily_notes.push({ id: "old", person_id: MICHEL, note_date: "2026-10-28", status: "done", text: "Gestern war {{W1}} dran.", wines: [{ ref: "W1", wine_id: ALION, vintage_year: 2018, name: "Alion 2018" }], created_at: "2026-10-28T04:00:00Z" });
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW), "done");
  const row = net.tables.daily_notes.find((r) => r.note_date === "2026-10-29")!;
  assert.equal(row.status, "done");
  assert.equal(row.text, "Guten Morgen, Michel. Heute würde ich {{W1}} öffnen.");
  assert.deepEqual(row.wines, [{ ref: "W1", wine_id: PINTIA, vintage_year: 2019, name: "Pintia 2019" }]);
  assert.equal(row.model, "claude-haiku-5-5");
  const prompt = JSON.stringify(calls[0]);
  assert.match(prompt, /Donnerstag, 29\. Oktober 2026/);
  assert.match(prompt, /W1: Pintia 2019 · Rot · Vega Sicilia · 2 Fl\. ungeöffnet · Über dem Höhepunkt · gekauft 2026-10-20/);
  assert.match(prompt, /Gestern war Alion 2018 dran\./);
  assert.match(prompt, /Alion 2018: 4\.5 von 5 · Stil: kraftvoll, dunkle Frucht/);
  // Zweiter Aufruf am selben Tag: nichts mehr.
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW), "skipped");
  assert.equal(calls.length, 1);
});

test("API-Limit: Ersatztext, kein neuer Versuch bis zum nächsten Tag, die anderen nicht mehr fragen", async () => {
  reset();
  claude = () => claudeError(400, LIMIT) as never;
  const results = await generateAllDailyNotes(db, NOW);
  assert.deepEqual(results, { Michel: "limit", Sara: "limit" });
  assert.equal(calls.length, 1, "nach dem Limit niemand mehr fragen");
  assert.deepEqual(net.tables.daily_notes.map((r) => [r.status, r.error]), [["failed", USAGE_LIMIT_ERROR], ["failed", USAGE_LIMIT_ERROR]]);
  // Cron und Startseite am selben Tag: kein neuer Versuch.
  assert.deepEqual(await generateAllDailyNotes(db, NOW + 3600_000), { Michel: "skipped", Sara: "skipped" });
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW + 7200_000), "skipped");
  assert.equal(calls.length, 1);
  // Am nächsten Tag wieder.
  claude = () => claudeText({ text: "Neuer Tag, {{W1}}." });
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW + 86_400_000), "done");
  // Die Startseite zeigt beim Limit den Ersatztext: aus denselben Daten, mit Links.
  const ctx = noteContext({ stock: [item({ quantity: 2, drinkFrom: 2018, drinkUntil: 2024 })], drunk: [], purchases: [], tastedThisMonth: 0, ratings: [], pendingSuggestions: 0 }, "Michel", NOW);
  const fb = fallbackNote(ctx.fallback);
  assert.doesNotMatch(fb.text, /Michel|Guten/);
  assert.equal(renderNote(fb.text, fb.refs, new Set([unitKey(PINTIA, 2019)])).segments.filter((s) => s.kind === "wine" && s.href).length, 1);
  claude = () => claudeText({ text: "Guten Morgen, Michel. Heute würde ich {{W1}} öffnen." });
});

test("anderer Fehler: failed; der Cron versucht es nochmals, die Startseite nicht", async () => {
  reset();
  claude = () => claudeError(500, "boom") as never;
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW), "failed");
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW), "skipped");
  claude = () => claudeText({ text: "Zweiter Versuch mit {{W1}}." });
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW, { retryFailed: true }), "done");
  assert.equal(net.tables.daily_notes[0].text, "Zweiter Versuch mit {{W1}}.");
});

test("ohne Migration (Tabelle fehlt): nichts erzeugen, die Seite zeigt den Ersatztext", async () => {
  reset();
  net.fail = (_m, table) => (table === "daily_notes" ? { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.daily_notes' in the schema cache" } } : null);
  assert.equal(await generateDailyNote(db, { id: MICHEL, name: "Michel" }, NOW), "unavailable");
  assert.equal(calls.length, 0);
  net.fail = undefined;
});

test("Route /api/home/daily: Secret im Header, sonst 401/503", async () => {
  assert.equal(workerSecretFrom(new Headers({ [DAILY_SECRET_HEADER]: "s1" }), DAILY_SECRET_HEADER), "s1");
  assert.equal(workerSecretFrom(new Headers({ "x-research-worker-secret": "s1" }), DAILY_SECRET_HEADER), null);
  assert.equal(workerSecretFrom(new Headers({ authorization: "Bearer s2" }), DAILY_SECRET_HEADER), "s2");
  const { POST } = await import("@/app/api/home/daily/route");
  const call = (headers: Record<string, string>) => POST(new Request("https://mywine.example/api/home/daily", { method: "POST", headers }) as never);
  delete process.env.DAILY_NOTES_SECRET;
  assert.equal((await call({ [DAILY_SECRET_HEADER]: "x" })).status, 503);
  process.env.DAILY_NOTES_SECRET = "richtig";
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ [DAILY_SECRET_HEADER]: "falsch" })).status, 401);
  assert.equal((await call({ "x-research-worker-secret": "richtig" })).status, 401);
  reset();
  const res = await call({ [DAILY_SECRET_HEADER]: "richtig" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.notes, { Michel: "done", Sara: "done" });
  assert.equal(net.tables.daily_notes.length, 2);
  // Öffentlich erreichbar (ohne Login), wie der Recherche-Worker.
  assert.match(readFileSync("src/lib/supabase/proxy.ts", "utf8"), /"\/api\/home\/daily"/);
  delete process.env.DAILY_NOTES_SECRET;
});

test("Prompt: Weine nur als Kürzel, Ehrlichkeit und Abwechslung verlangt", () => {
  const ctx = noteContext({ stock: [item({})], drunk: [], purchases: [], tastedThisMonth: 0, ratings: [], pendingSuggestions: 0 }, "Sara", NOW);
  const text = dailyPrompt({ ...ctx.prompt, person: "Sara", refs: ctx.refs, previous: [] });
  assert.match(text, /Person: Sara/);
  assert.match(text, /W1: Pintia 2019/);
  assert.doesNotMatch(text, /Texte der letzten Tage/);
  const system = readFileSync("src/lib/home/prompt.ts", "utf8");
  assert.match(system, /Erfinde nichts/);
  assert.match(system, /Wiederhole weder Formulierungen/);
});

test("Antoines Foto liegt unter app-assets/ und gilt nie als verwaist", async () => {
  reset();
  net.tables.wine_media = [];
  net.tables.ingest_jobs = [];
  net.tables.inventory_items = [];
  net.storage!.set("wine-photos/app-assets/antoine-1.jpg", { bytes: new Uint8Array([1]), type: "image/jpeg", createdAt: "2020-01-01T00:00:00Z" });
  net.storage!.set("wine-photos/lost.jpg", { bytes: new Uint8Array([1]), type: "image/jpeg", createdAt: "2020-01-01T00:00:00Z" });
  const orphans = await findOrphanFiles(db, { now: NOW });
  assert.deepEqual(orphans.map((o) => o.path), ["lost.jpg"]);
});

test("Kopf der Startseite: ohne Überschrift „ANTOINE“, Screenreader erfahren trotzdem, wer spricht", () => {
  const src = readFileSync("src/components/home/antoine-note.tsx", "utf8");
  assert.doesNotMatch(src, /antoine-name|>Antoine</);
  assert.match(src, /<section className="antoine" aria-label="Antoine">/);
  assert.match(src, /alt="Antoine"/);
  assert.match(src, /antoine-placeholder" role="img" aria-label="Antoine"/);
  assert.doesNotMatch(readFileSync("src/app/globals.css", "utf8"), /\.antoine-name/);
});

test("Kopf der Startseite: Text fliesst um das runde Foto, Karte mindestens so hoch wie das Foto", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const head = css.slice(css.indexOf(".antoine {"), css.indexOf(".antoine-text {"));
  assert.match(head, /\.antoine \{[^}]*--antoine-size: 116px;[^}]*display: flow-root;/);
  assert.match(head, /min-width: 700px\) \{\s*\.antoine \{\s*--antoine-size: 150px;/);
  assert.match(head, /min-width: 1000px\) \{\s*\.antoine \{\s*--antoine-size: 176px;/);
  assert.match(head, /\.antoine-photo \{[^}]*float: left;[^}]*object-fit: cover;[^}]*shape-outside: circle\(50%\)[^}]*shape-margin: 18px;/);
  // Der Text darf unter dem Foto weiterlaufen: kein Flex mehr, die Textspalte ist kein eigener Block.
  assert.doesNotMatch(head, /display: flex;\s*align-items: flex-start/);
  assert.doesNotMatch(css, /\.antoine-body \{/);
});

test("Begrüssung nach der Uhrzeit in Europe/Zurich, mit Vorname – Grenzen", () => {
  // 29. Oktober 2026: Winterzeit (UTC+1). Zürich-Zeit → UTC minus 1 Stunde.
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return Date.UTC(2026, 9, 29, h - 1, m);
  };
  const cases: [string, string, RegExp][] = [
    ["04:59", "late", /^Hallo, Michel[.!]?/],
    ["05:00", "morning", /^(Schönen guten|Guten) Morgen, Michel/],
    ["10:59", "morning", /Guten Morgen, Michel|guten Morgen, Michel/],
    ["11:00", "day", /^Guten Tag, Michel/],
    ["16:59", "day", /^Guten Tag, Michel/],
    ["17:00", "evening", /^(Schönen guten|Guten) Abend, Michel/],
    ["21:59", "evening", /[Gg]uten Abend, Michel/],
    ["22:00", "late", /^Hallo, Michel/],
    ["00:30", "late", /^Hallo, Michel/],
  ];
  for (const [time, slot, text] of cases) {
    assert.equal(greetingSlot(zurichParts(at(time)).hour), slot, time);
    assert.match(greetingText("Michel", at(time)), text, time);
  }
  // Sommerzeit (UTC+2): 05:00 in Zürich = 03:00 UTC.
  assert.equal(greetingSlot(zurichParts(Date.UTC(2026, 6, 1, 3, 0)).hour), "morning");
  assert.equal(greetingSlot(zurichParts(Date.UTC(2026, 6, 1, 2, 59)).hour), "late");
  // Ohne Person: ohne Namen; gleiche Variante für denselben Tag (Server und Browser).
  assert.equal(greetingText(null, at("18:00")), "Guten Abend.");
  assert.equal(greetingText("Sara", at("08:00")), greetingText("Sara", at("10:30")));
  // Keine Nacht-Begrüssung.
  for (let h = 0; h < 24; h++) assert.doesNotMatch(greetingText("Michel", Date.UTC(2026, 9, 29, h, 0)), /Nacht/);
});

test("gespeicherte Texte: führende Begrüssung entfernen, sonst nichts", () => {
  assert.equal(stripGreeting("Guten Morgen Michel, die Pintia wartet."), "Die Pintia wartet.");
  assert.equal(stripGreeting("Guten Morgen, Michel. Der Herbst ist da."), "Der Herbst ist da.");
  assert.equal(stripGreeting("Schönen guten Abend, Sara! Im Keller {{W1}}."), "Im Keller {{W1}}.");
  assert.equal(stripGreeting("Hallo Sara – der Herbst ist da."), "Der Herbst ist da.");
  assert.equal(stripGreeting("Grüezi Michel! Im Keller liegen 4 Flaschen."), "Im Keller liegen 4 Flaschen.");
  assert.equal(stripGreeting("Hoi Sara, schau mal."), "Schau mal.");
  assert.equal(stripGreeting("Guten Tag! Im Keller."), "Im Keller.");
  // Kein Gruss am Anfang bzw. kein Name: bleibt.
  assert.equal(stripGreeting("Morgen, am Freitag, wäre {{W1}} schön."), "Morgen, am Freitag, wäre {{W1}} schön.");
  assert.equal(stripGreeting("Guten Morgen die Pintia, ist gut."), "Guten Morgen die Pintia, ist gut.");
  assert.equal(stripGreeting("Im Keller liegen 4 Flaschen. Guten Abend!"), "Im Keller liegen 4 Flaschen. Guten Abend!");
  // Beim Anzeigen (Startseite) angewendet, die Begrüssung kommt aus der App.
  const page = readFileSync("src/app/(cellar)/page.tsx", "utf8");
  assert.match(page, /renderNote\(stripGreeting\(note\.text\)/);
  assert.match(page, /greeting=\{greetingText\(/);
  assert.match(readFileSync("src/components/home/greeting.tsx", "utf8"), /greetingText\(person, Date\.now\(\)\)/);
});

test("Prompt: keine Begrüssung, keine Tageszeit, neutrale Trinkvorschläge", () => {
  assert.match(DAILY_SYSTEM, /Keine Begrüssung und keine Tageszeit/);
  assert.match(DAILY_SYSTEM, /kein „Guten Morgen“, „Guten Tag“, „Guten Abend“/);
  assert.match(DAILY_SYSTEM, /beginne direkt mit dem Inhalt/);
  assert.match(DAILY_SYSTEM, /„heute Morgen“, „heute Nachmittag“, „heute Abend“/);
  assert.match(DAILY_SYSTEM, /für einen der nächsten Abende/);
  assert.doesNotMatch(DAILY_SYSTEM, /Bezug auf Tageszeit|begrüsse/);
  // Die Eingabe nennt keine Tageszeit mehr (nur Wochentag, Datum, Jahreszeit).
  const ctx = noteContext({ stock: [item({})], drunk: [], purchases: [], tastedThisMonth: 0, ratings: [], pendingSuggestions: 0 }, "Sara", NOW);
  const text = dailyPrompt({ ...ctx.prompt, person: "Sara", refs: ctx.refs, previous: [] });
  assert.match(text, /^Heute: Donnerstag, 29\. Oktober 2026, Herbst$/m);
  assert.doesNotMatch(text, /Morgen|Mittag|Nachmittag|Abend|Nacht/);
});
