// Preissuche über Google Shopping Schweiz (SerpApi bzw. Serper) + Haiku-Abgleich: Kandidaten nur in CHF ohne
// Marktplätze und nur von Schweizer Händlern (Domain bzw. Tabelle merchants), Google-Suche site:.ch, Urteil yes/variant/no, Grösse, Jahrgang und Produzent hart geprüft, Preiswahl, direkte Shops
// immer dazu, Kontingent (230/250), ohne Schlüssel Rückfall. Nachgebildete SerpApi- und
// Claude-Antworten – ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CANDIDATES, shoppingCandidates, shoppingUrl } from "@/lib/research/serpapi";
import { SERPER_URL, parsePriceText, serperCandidates } from "@/lib/research/serper";
import { SERPER_SEARCH_URL, serperSearchHits } from "@/lib/research/site-search";
import { JUDGE_SYSTEM, hardCheck, judgePrompt, producerCheck, styleCheck } from "@/lib/research/price-judge";
import { T } from "@/lib/bot/texts";
import { merchantKey, merchantOf, merchantUrl, shopNameFromHtml } from "@/lib/research/merchant";
import { readFileSync, readdirSync } from "node:fs";

/** Startdaten der Tabelle merchants, direkt aus der Migration gelesen. */
const SEED = (() => {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith("_merchants.sql"))!;
  const sql = readFileSync(`${dir}/${file}`, "utf8");
  return [...sql.matchAll(/\('([^']+)', '([^']+)', '([^']+)', (true|false), '(known)'\)/g)].map((m) => ({ name_key: m[1], display_name: m[2], domain: m[3], swiss: m[4] === "true", source: m[5] }));
})();
import { researchPrice, serpQueriesAllowed, sizeUnknownFinding, type PriceWine } from "@/lib/research/price";
import { googleQueries } from "@/lib/research/price-search";
import { sizeFromText } from "@/lib/research/price-match";
import { costUsd } from "@/lib/ai/cost";

/** Händlername → Domain fürs Nachbilden: ohne Punkt als Schweizer .ch-Shop („Coop“ → coop.ch). */
const domainFor = (source: string) => {
  const d = source.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return d.includes(".") ? d : `${d}.ch`;
};
type Result = { title: string; source: string; price: string; extracted_price: number; extracted_old_price?: number; link?: string };
const r = (title: string, source: string, chf: number, extra: Partial<Result> = {}): Result => ({
  title, source, price: `CHF ${chf.toFixed(2)}`, extracted_price: chf, link: `https://www.${domainFor(source)}/p/${encodeURIComponent(title)}`, ...extra,
});

test("Kandidaten: nur CHF, ohne Marktplätze und Doppelte, alter Preis = Normalpreis, höchstens 30", () => {
  const json = {
    shopping_results: [
      r("Lazzaroni Amaretto 70cl", "drinks.ch", 29.9),
      r("Lazzaroni Amaretto 70cl", "drinks.ch", 29.9),
      r("Lazzaroni Amaretto 70cl", "eBay", 19),
      r("Lazzaroni Amaretto", "ricardo.ch", 15),
      { ...r("Lazzaroni Amaretto 70cl", "Amazon.de", 25), price: "25,00 €" },
      r("Lazzaroni Amaretto 70cl Aktion", "Coop", 24.95, { extracted_old_price: 29.95 }),
    ],
  };
  const c = shoppingCandidates(json);
  assert.deepEqual(c.map((x) => [x.source, x.price, x.regular]), [["drinks.ch", 29.9, null], ["Coop", 24.95, 29.95]]);
  const many = { shopping_results: Array.from({ length: 40 }, (_, i) => r(`Produkt ${i}`, `shop${i}.ch`, 10 + i)) };
  assert.equal(shoppingCandidates(many).length, MAX_CANDIDATES);
  const url = new URL(shoppingUrl("Noah's Mill 70cl", "KEY"));
  assert.deepEqual([url.searchParams.get("engine"), url.searchParams.get("gl"), url.searchParams.get("hl"), url.searchParams.get("google_domain"), url.searchParams.get("q")], ["google_shopping", "ch", "de", "google.ch", "Noah's Mill 70cl"]);
});

test("Harte Prüfung: Grösse und Jahrgang müssen passen, sonst höchstens variant; no bleibt no", () => {
  const b = { year: 2019, sizeMl: 750 };
  assert.deepEqual(hardCheck(b, { same_product: "yes", reason: "gleich", size_ml: 750, vintage: 2019 }), { verdict: "yes", reason: "gleich", sizeMl: 750, year: 2019 });
  assert.equal(hardCheck(b, { same_product: "yes", reason: "gleich", size_ml: 1500, vintage: 2019 }).verdict, "variant");
  assert.equal(hardCheck(b, { same_product: "yes", reason: "gleich", size_ml: 750, vintage: 2020 }).reason, "Jahrgang 2020");
  assert.equal(hardCheck(b, { same_product: "yes", reason: "gleich", size_ml: 0, vintage: 0 }).reason, "Jahrgang nicht genannt");
  assert.equal(hardCheck({ year: null, sizeMl: 700 }, { same_product: "yes", reason: "gleich", size_ml: 0, vintage: 0 }).verdict, "yes", "Grösse nicht genannt: Standard");
  assert.equal(hardCheck({ year: null, sizeMl: 700 }, { same_product: "yes", reason: "gleich", size_ml: 700, vintage: 1991 }).verdict, "variant", "NV gesucht, Angebot mit Jahrgang");
  assert.equal(hardCheck(b, { same_product: "no", reason: "andere Marke", size_ml: 750, vintage: 2019 }).verdict, "no");
  assert.equal(hardCheck(b, { same_product: "variant", reason: "Riserva", size_ml: 750, vintage: 2019 }).verdict, "variant");
  // Prompt nennt Flasche und nummerierte Kandidaten
  const p = judgePrompt({ name: "Noah's Mill", producer: "Willett Distillery", type: "spirit", category: "Bourbon", year: null, sizeMl: 700, alcohol: 57.2 }, [{ title: "Noah's Mill Bourbon 70cl", source: "drinks.ch", price: 86.9 }]);
  assert.match(p, /"name":"Noah's Mill".*"kategorie":"Bourbon".*"alkohol":57\.2/);
  assert.match(p, /0\. Noah's Mill Bourbon 70cl – drinks\.ch – CHF 86\.90/);
});

test("Kontingent: 2 Abfragen, ab 230 im Monat 1, ab 250 keine; SerpApi kostet nichts, Serper 0.001 je Abfrage", () => {
  assert.deepEqual([0, 229, 230, 249, 250, 300].map(serpQueriesAllowed), [2, 2, 1, 1, 0, 0]);
  assert.equal(costUsd("serpapi", { server_tool_use: { web_search_requests: 1 } }), 0);
  assert.equal(costUsd("serper", { server_tool_use: { web_search_requests: 1 } }), 0.001);
});

test("Serper: Preis-Text → Zahl und Währung; ohne Währung bzw. nicht CHF verworfen", () => {
  assert.deepEqual(parsePriceText("CHF 86.90"), { amount: 86.9, currency: "CHF" });
  assert.deepEqual(parsePriceText("86,90 CHF"), { amount: 86.9, currency: "CHF" });
  assert.deepEqual(parsePriceText("CHF 1'234.50"), { amount: 1234.5, currency: "CHF" });
  assert.deepEqual(parsePriceText("CHF 1’234.50"), { amount: 1234.5, currency: "CHF" });
  assert.deepEqual(parsePriceText("Fr. 34.–"), { amount: 34, currency: "CHF" });
  assert.equal(parsePriceText("86.90"), null, "ohne Währung");
  assert.equal(parsePriceText(""), null);
  assert.equal(parsePriceText("19,90 €")?.currency, "EUR");
  assert.equal(parsePriceText("$15.99")?.currency, "USD");
  const c = serperCandidates({ shopping: [
    { title: "Noah's Mill 70cl", source: "drinks.ch", price: "CHF 86.90", link: "https://www.drinks.ch/x" },
    { title: "Noah's Mill 70cl", source: "Amazon.de", price: "79,00 €", link: "https://amazon.de/x" },
    { title: "Noah's Mill", source: "ricardo.ch", price: "CHF 50.00", link: "https://www.ricardo.ch/x" },
    { title: "Noah's Mill", source: "Shop", price: "90.00", link: "https://x.ch" },
  ] });
  assert.deepEqual(c.map((x) => [x.source, x.price]), [["drinks.ch", 86.9]]);
  assert.equal(SERPER_URL, "https://google.serper.dev/shopping");
});

// --- Ablauf mit Stub: Antworten je Suchbegriff, ausgeliefert im Format des jeweiligen Anbieters

type Offer = { title: string; source: string; chf: number; old?: number; link?: string };
const o = (title: string, source: string, chf: number, old?: number): Offer => ({ title, source, chf, ...(old ? { old } : {}) });
/** Wie Serper: nur eine Google-Suchseite als Link, kein Händlerlink. */
const g = (title: string, source: string, chf: number): Offer => ({ title, source, chf, link: `https://www.google.com/search?ibp=oshop&q=${encodeURIComponent(title)}&prds=catalogid:1&gl=ch` });
/** Seiten der direkten Shop-Suchen und der Google-Suche: Adressanfang → Antwort (Zahl = Status ohne Inhalt). */
const shopPages = new Map<string, string | number>();
/** Google-Suche site:.ch: Ergebnisse je Suchbegriff (Serper organic). */
type Organic = { link: string; title: string; snippet?: string; price?: number; currency?: string };
const searchAnswers = new Map<string, Organic[]>();
const searchCalls: { provider: Provider; q: string }[] = [];
/** Angebote je Suchbegriff; „error“ = Anbieterfehler (z. B. kein Guthaben). */
const answers = new Map<string, Offer[]>();
const broken = new Set<Provider>();
type Provider = "serpapi" | "serper";
const calls: { provider: Provider; q: string }[] = [];
let judge: Record<string, { v: "yes" | "variant" | "no"; reason?: string; size?: number; vintage?: number }> = {};
let judgeCalls = 0;
let sonnetCalls = 0;
const NOTHING = { found: false, same_wine: false, product_title: "", merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "", candidate_urls: [], reason: "" };
const link = (x: Offer) => x.link ?? `https://www.${domainFor(x.source)}/p/${encodeURIComponent(x.title)}`;
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      judgeCalls++;
      const text = JSON.stringify(body.messages);
      const lines = [...text.matchAll(/\\n(\d+)\. ([^\\]+?) – /g)].map((m) => ({ index: Number(m[1]), title: m[2] }));
      const candidates = lines.map(({ index, title }) => {
        const key = Object.keys(judge).find((k) => title.includes(k));
        const j = key ? judge[key] : { v: "no" as const };
        return { index, same_product: j.v, reason: j.reason ?? (j.v === "yes" ? "gleiches Produkt" : "anderes Produkt"), size_ml: j.size ?? 0, vintage: j.vintage ?? 0 };
      });
      return { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify({ candidates }) }], usage: { input_tokens: 900, output_tokens: 300 } };
    }
    sonnetCalls++;
    return claudeTool("report_price", NOTHING);
  },
  web: (url, request) => {
    if (url.startsWith("https://serpapi.com/") && new URL(url).searchParams.get("engine") === "google") {
      const q = new URL(url).searchParams.get("q") ?? "";
      searchCalls.push({ provider: "serpapi", q });
      if (broken.has("serpapi")) return { status: 429, body: JSON.stringify({ error: "Your account has run out of searches." }), type: "application/json" };
      return { body: JSON.stringify({ organic_results: (searchAnswers.get(q) ?? []).map((h) => ({ link: h.link, title: h.title, snippet: h.snippet ?? "", ...(h.price ? { rich_snippet: { top: { detected_extensions: { price: h.price, currency: h.currency ?? "CHF" } } } } : {}) })) }), type: "application/json" };
    }
    if (url === SERPER_SEARCH_URL) {
      const req = request?.body as { q: string; gl: string; hl: string; num: number };
      assert.deepEqual([req.gl, req.hl, req.num], ["ch", "de", 20]);
      searchCalls.push({ provider: "serper", q: req.q });
      if (broken.has("serper")) return { status: 403, body: JSON.stringify({ message: "Not enough credits", statusCode: 403 }), type: "application/json" };
      return { body: JSON.stringify({ organic: searchAnswers.get(req.q) ?? [] }), type: "application/json" };
    }
    if (url.startsWith("https://serpapi.com/")) {
      const q = new URL(url).searchParams.get("q") ?? "";
      calls.push({ provider: "serpapi", q });
      if (broken.has("serpapi")) return { status: 429, body: JSON.stringify({ error: "Your account has run out of searches." }), type: "application/json" };
      const list = answers.get(q);
      if (!list) return { body: JSON.stringify({ error: "Google hasn't returned any results for this query." }), type: "application/json" };
      return { body: JSON.stringify({ shopping_results: list.map((x) => ({ title: x.title, source: x.source, price: `CHF ${x.chf.toFixed(2)}`, extracted_price: x.chf, ...(x.old ? { extracted_old_price: x.old } : {}), link: link(x) })) }), type: "application/json" };
    }
    if (url === SERPER_URL) {
      const req = request?.body as { q: string; gl: string; hl: string; location: string };
      assert.deepEqual([req.gl, req.hl, req.location, request?.method], ["ch", "de", "Switzerland", "POST"]);
      calls.push({ provider: "serper", q: req.q });
      if (broken.has("serper")) return { status: 403, body: JSON.stringify({ message: "Not enough credits", statusCode: 403 }), type: "application/json" };
      // Serper: Preis als Text in wechselnden Schreibweisen
      return { body: JSON.stringify({ shopping: (answers.get(req.q) ?? []).map((x, i) => ({ title: x.title, source: x.source, price: i % 2 ? `${x.chf.toFixed(2).replace(".", ",")} CHF` : `CHF ${x.chf.toFixed(2)}`, link: link(x), position: i + 1 })) }), type: "application/json" };
    }
    for (const [prefix, body] of shopPages) {
      if (!url.startsWith(prefix)) continue;
      return typeof body === "number" ? { status: body, body: "" } : { body, type: prefix.includes(".js") ? "application/json" : "text/html" };
    }
    return null;
  },
};
installNet(net);
const db = createAdminClient();
const keys = (p: Provider) => (p === "serpapi" ? { serpApiKey: "serpapi-key", serperApiKey: null } : { serpApiKey: null, serperApiKey: "serper-key" });

function reset() {
  answers.clear();
  broken.clear();
  shopPages.clear();
  searchAnswers.clear();
  searchCalls.length = 0;
  calls.length = 0;
  judge = {};
  judgeCalls = 0;
  sonnetCalls = 0;
  net.tables = { api_usage: [], merchants: SEED.map((m) => ({ ...m })) };
}
const qs = () => calls.map((c) => c.q);
const spirit = (name: string, producer: string | null, extra: Partial<PriceWine> = {}): PriceWine => ({ name, producer, type: "spirit", country: null, region: null, appellation: null, ...extra });

for (const provider of ["serpapi", "serper"] as const) {
  test(`${provider}: Lazzaroni Amaretto 70 cl → rund 30 (Eigenmarke no, Literflasche nur variant, Marktplatz weg)`, async () => {
    reset();
    answers.set("Lazzaroni Amaretto 70cl", [
      o("Lazzaroni Amaretto 70cl", "drinks.ch", 29.9),
      o("Amaretto Liquor 70cl", "Globus", 15.9),
      o("Lazzaroni Amaretto 1 l", "Coop", 39.9),
      o("Lazzaroni Amaretto 70cl", "eBay", 12),
      o("Lazzaroni Amaretto 70 cl Original", "casadeltequila.ch", 30),
      o("Lazzaroni Amaretto Classico 70cl", "Galaxus", 31.5),
    ]);
    judge = { "Lazzaroni Amaretto 70": { v: "yes", size: 700 }, "Lazzaroni Amaretto Classico": { v: "yes", size: 700 }, "Lazzaroni Amaretto 1 l": { v: "yes", size: 1000 }, "Amaretto Liquor": { v: "no", reason: "andere Marke" } };
    const { finding, diagnostics } = await researchPrice(spirit("Amaretto", "Paolo Lazzaroni & Figli"), null, 700, "Galaxus", { db, ...keys(provider) });
    assert.ok(finding.kind === "exact" && finding.amount === 30 && finding.merchants === 3, JSON.stringify(finding));
    assert.deepEqual(calls, [{ provider, q: "Amaretto 70cl" }, { provider, q: "Lazzaroni Amaretto 70cl" }], "ohne Marke keine Treffer: zweite Abfrage mit Marke");
    assert.equal(judgeCalls, 1);
    assert.equal(sonnetCalls, 0, "keine Claude-Websuche");
    const s = diagnostics.shopping!;
    assert.equal(s.provider, provider);
    assert.ok(!s.candidates.some((c) => c.source === "eBay"));
    assert.deepEqual(s.candidates.find((c) => c.source === "Coop"), { title: "Lazzaroni Amaretto 1 l", price: 39.9, source: "Coop", origin: "shopping", link: "https://www.coop.ch/p/Lazzaroni%20Amaretto%201%20l", domain: "coop.ch", swiss: true, via: "link", verdict: "variant", reason: "andere Grösse (100 cl)" });
    assert.equal(s.candidates.find((c) => c.source === "Globus")?.verdict, "no");
    assert.deepEqual(s.chosen, { amount: 30, merchant: "casadeltequila.ch", merchants: 3 });
    assert.equal(diagnostics.verdict, "exact:shopping");
    const rows = net.tables.api_usage;
    // 2 Shopping-Abfragen + 2 Such-Abfragen (site:.ch zuerst mit Marke, dann die andere Variante)
    assert.deepEqual(rows.filter((x) => x.model === provider).map((x) => [x.purpose, x.web_searches, x.cost_usd]), Array(4).fill(["research_price", 1, provider === "serper" ? 0.001 : 0]));
    assert.deepEqual(searchCalls.map((c) => c.q), ["Lazzaroni Amaretto 70cl site:.ch", "Amaretto 70cl site:.ch"]);
    assert.ok(rows.some((x) => x.model === "claude-haiku-5-5" && x.purpose === "research_price"));
  });

  test(`${provider}: Noah's Mill 70 cl → rund 86–95 (Ausreisser 112 weg), Abfrage ohne «Willett»`, async () => {
    reset();
    answers.set("Noah's Mill 70cl", [
      o("Noah's Mill Bourbon Whiskey 70cl", "drinks.ch", 86.9),
      o("Noah's Mill Small Batch 70cl 57.15%", "Flaschenpost", 94.95),
      o("NOAH'S MILL Kentucky Bourbon 70 cl", "casadeltequila.ch", 99),
      o("Noahs Mill Small Batch - 700ml (Willett)", "bringts.ch", 85.25),
      o("Noah's Mill Bourbon 0.7 l", "Galaxus", 112),
    ]);
    judge = { oah: { v: "yes", size: 700 }, OAH: { v: "yes", size: 700 } };
    const { finding } = await researchPrice(spirit("Noah's Mill", "Willett Distillery"), null, 700, null, { db, ...keys(provider) });
    assert.ok(finding.kind === "exact" && finding.amount >= 86 && finding.amount <= 95 && finding.merchants === 4, JSON.stringify(finding));
    assert.equal(qs()[0], "Noah's Mill 70cl");
  });

  test(`${provider}: Premium Pisco (Capel) – Reservado nur variant, Treffer ist das normale Premium`, async () => {
    reset();
    answers.set("Capel Premium Pisco 70cl", [o("Pisco Capel Reservado 70cl", "Globus", 39), o("Capel Premium Pisco 40% 70cl", "Coop", 29.95), o("Capel Pisco Premium 70cl", "mybarkeeper.ch", 34.9)]);
    judge = { Reservado: { v: "variant", reason: "Reservado statt Premium", size: 700 }, "Capel Premium Pisco": { v: "yes", size: 700 }, "Capel Pisco Premium": { v: "yes", size: 700 } };
    const { finding, diagnostics } = await researchPrice(spirit("Premium Pisco", "Capel"), null, 700, null, { db, ...keys(provider) });
    assert.ok(finding.kind === "exact" && finding.amount === 34.9 && !/Reservado/.test(finding.url), JSON.stringify(finding));
    assert.equal(diagnostics.shopping!.candidates.find((c) => /Reservado/.test(c.title))?.verdict, "variant");
  });

  test(`${provider}: Grappa di Barolo Riserva 1991 – nur andere Abfüllungen → kein stiller Treffer`, async () => {
    reset();
    answers.set("Grappa di Barolo Riserva 1991 70cl", [o("Marolo Grappa di Barolo 9 anni 70cl", "piemont-weine.ch", 69)]);
    judge = { "9 anni": { v: "variant", reason: "9 Jahre statt Riserva 1991", size: 700 } };
    const { finding } = await researchPrice(spirit("Grappa di Barolo Riserva", "Distilleria Marolo"), 1991, 700, null, { db, ...keys(provider) });
    assert.notEqual(finding.kind, "exact");
    if (finding.kind === "other") assert.match(String(finding.why), /Jahrgang|Riserva|9 Jahre/);
    assert.deepEqual(qs(), ["Grappa di Barolo Riserva 1991 70cl", "Marolo Grappa di Barolo Riserva 1991 70cl"], "wenig Treffer: zweite Abfrage mit Marke");
    assert.equal(sonnetCalls, 0);
  });

  test(`${provider}: Creanza – nichts gefunden, ohne Haiku und ohne Claude-Websuche`, async () => {
    reset();
    const { finding, diagnostics } = await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...keys(provider) });
    assert.deepEqual(finding, { kind: "none", reason: "not_found" });
    assert.deepEqual(qs(), ["Creanza 50cl", "Moreno Wildhaber Creanza 50cl"]);
    assert.equal(judgeCalls, 0);
    assert.equal(sonnetCalls, 0);
    assert.equal(diagnostics.verdict, "not_found:shopping");
    assert.deepEqual(searchCalls.map((c) => c.q), ["Moreno Wildhaber Creanza 50cl site:.ch", "Creanza 50cl site:.ch"], "keine Shop-Treffer: die andere Variante");
    assert.equal(calls.length + searchCalls.length, 4, "höchstens 4 Abfragen pro Flasche");
    assert.ok(diagnostics.direct, "direkte Shop-Suchen als Ergänzung gelaufen");
  });
}

test("Wein mit Jahrgang: Angebot ohne bzw. mit anderem Jahrgang nur variant", async () => {
  reset();
  answers.set("Pintia 2019 75cl", [o("Pintia Toro", "Mövenpick", 59), o("Pintia 2018 Toro", "Flaschenpost", 61), o("Pintia 2019 Vega Sicilia 75cl", "Gerstl", 64)]);
  judge = { "Pintia Toro": { v: "yes", size: 750 }, "Pintia 2018": { v: "yes", size: 750, vintage: 2018 }, "Pintia 2019": { v: "yes", size: 750, vintage: 2019 } };
  const { finding } = await researchPrice({ name: "Pintia", producer: "Bodegas Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null }, 2019, 750, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount === 64 && finding.year === 2019, JSON.stringify(finding));
});

test("Anbieterwahl: nur SerpApi, nur Serper, beide (SerpApi zuerst), keiner (Rückfall)", async () => {
  const creanza = spirit("Creanza", "Moreno Wildhaber");
  reset();
  await researchPrice(creanza, null, 500, null, { db, serpApiKey: "a", serperApiKey: null });
  assert.deepEqual([...new Set(calls.map((c) => c.provider))], ["serpapi"]);
  reset();
  await researchPrice(creanza, null, 500, null, { db, serpApiKey: null, serperApiKey: "b" });
  assert.deepEqual([...new Set(calls.map((c) => c.provider))], ["serper"]);
  reset();
  const both = await researchPrice(creanza, null, 500, null, { db, serpApiKey: "a", serperApiKey: "b" });
  assert.deepEqual([...new Set(calls.map((c) => c.provider))], ["serpapi"], "SerpApi zuerst, Serper nicht nötig");
  assert.equal(both.diagnostics.shopping?.provider, "serpapi");
  reset();
  await researchPrice(creanza, null, 500, null, { db, serpApiKey: null, serperApiKey: null });
  assert.equal(calls.length, 0);
  assert.equal(sonnetCalls, 1, "keiner: bisherige Preissuche");
});

test("SerpApi-Kontingent: ab 230 eine Abfrage, ab 250 Serper (bzw. ohne Serper die bisherige Suche)", async () => {
  const month = new Date().toISOString();
  const fill = (n: number) => (net.tables.api_usage = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, model: "serpapi", purpose: "research_price", web_searches: 1, created_at: month })));
  const creanza = spirit("Creanza", "Moreno Wildhaber");
  reset();
  fill(235);
  await researchPrice(creanza, null, 500, null, { db, serpApiKey: "a", serperApiKey: null });
  assert.deepEqual(calls, [{ provider: "serpapi", q: "Creanza 50cl" }], "nur eine Abfrage");
  reset();
  fill(250);
  const viaSerper = await researchPrice(creanza, null, 500, null, { db, serpApiKey: "a", serperApiKey: "b" });
  assert.deepEqual([...new Set(calls.map((c) => c.provider))], ["serper"], "SerpApi erschöpft → Serper");
  assert.equal(viaSerper.diagnostics.shopping?.provider, "serper");
  reset();
  fill(250);
  await researchPrice(creanza, null, 500, null, { db, serpApiKey: "a", serperApiKey: null });
  assert.equal(calls.length, 0);
  assert.equal(sonnetCalls, 1, "ohne Serper: bisherige Preissuche");
});

test("Fehler beim einen Anbieter → der andere; beide fehlerhaft → bisherige Suche; jede Abfrage protokolliert", async () => {
  const noah = spirit("Noah's Mill", "Willett Distillery");
  reset();
  broken.add("serpapi");
  answers.set("Noah's Mill 70cl", [o("Noah's Mill Bourbon Whiskey 70cl", "drinks.ch", 86.9)]);
  judge = { "Noah's Mill": { v: "yes", size: 700 } };
  const r1 = await researchPrice(noah, null, 700, null, { db, serpApiKey: "a", serperApiKey: "b" });
  assert.deepEqual(calls.map((c) => c.provider), ["serpapi", "serper", "serper"]);
  assert.ok(r1.finding.kind === "exact" && r1.finding.amount === 86.9);
  assert.equal(r1.diagnostics.shopping?.provider, "serper");
  assert.match(String(r1.diagnostics.shopping?.failed?.[0]?.error), /serpapi 429/);
  assert.equal(net.tables.api_usage.filter((x) => x.model === "serpapi" || x.model === "serper").length, calls.length + searchCalls.length, "jede Abfrage protokolliert");
  reset();
  broken.add("serper");
  answers.set("Noah's Mill 70cl", [o("Noah's Mill Bourbon Whiskey 70cl", "drinks.ch", 86.9)]);
  judge = { "Noah's Mill": { v: "yes", size: 700 } };
  const r2 = await researchPrice(noah, null, 700, null, { db, serpApiKey: "a", serperApiKey: "b" });
  assert.deepEqual(calls.map((c) => c.provider), ["serpapi", "serpapi"], "Serper defekt, aber SerpApi zuerst und ok");
  assert.equal(r2.diagnostics.shopping?.provider, "serpapi");
  reset();
  broken.add("serpapi");
  broken.add("serper");
  await researchPrice(noah, null, 700, null, { db, serpApiKey: "a", serperApiKey: "b" });
  assert.deepEqual(calls.map((c) => c.provider), ["serpapi", "serper"]);
  assert.equal(sonnetCalls, 1, "beide fehlerhaft: bisherige Preissuche");
});

// --- Nur Schweizer Händler, direkte Shops immer dazu (nachgebildet nach dem Testlauf vom 29.10.)

test("Händler-Domain: Google-Weiterleitung, Händlername mit .ch, bekannte Schweizer Händler, sonst nicht zugelassen", () => {
  assert.equal(merchantUrl("https://www.google.com/url?url=https://www.drinks.ch/de/noah-s-mill.html&rct=j&sa=t"), "https://www.drinks.ch/de/noah-s-mill.html");
  assert.equal(merchantUrl("https://www.googleadservices.com/pagead/aclk?sa=L&adurl=https%3A%2F%2Fwww.bringts.ch%2Fproducts%2Fnoahs-mill"), "https://www.bringts.ch/products/noahs-mill");
  assert.equal(merchantUrl("https://www.google.com/search?ibp=oshop&q=Noah%27s+Mill&prds=catalogid:1"), null, "Google-Suchseite (Serper): kein Händlerlink");
  const google = "https://www.google.com/search?ibp=oshop&q=x";
  assert.deepEqual(merchantOf("Drinks.ch", "https://www.google.ch/url?q=https://www.drinks.ch/de/x.html"), { url: "https://www.drinks.ch/de/x.html", domain: "drinks.ch", swiss: true, via: "link" });
  assert.deepEqual(merchantOf("Korkenknaller.ch", google), { url: null, domain: "korkenknaller.ch", swiss: true, via: "name" });
  assert.deepEqual(merchantOf("Korkenknaller.ch", ""), { url: null, domain: "korkenknaller.ch", swiss: true, via: "name" }, "ohne Link zugelassen");
  assert.deepEqual(merchantOf("Whisky.de", google), { url: null, domain: "whisky.de", swiss: false, via: "name" });
  assert.equal(merchantOf("by Vinello.ch", google).domain, "vinello.ch");
  assert.equal(merchantOf("Amazon.it - Seller", google).swiss, false);
  // Ohne Domain nur über die Tabelle merchants (Startdaten aus der Migration)
  const known = new Map(SEED.map((m) => [m.name_key, { domain: m.domain, swiss: m.swiss, source: m.source }]));
  assert.deepEqual(merchantOf("Casa Poli", google), { url: null, domain: null, swiss: false, via: null }, "keine Namensliste mehr im Code");
  assert.deepEqual(merchantOf("Casa Poli", google, known), { url: null, domain: "casapoli.ch", swiss: true, via: "merchants" });
  assert.equal(merchantOf("Mövenpick Wein", google, known).domain, "moevenpick-wein.com");
  assert.equal(merchantOf("Mövenpick Wein", google, known).swiss, true);
  assert.equal(merchantOf("Feldschlösschen Getränke Shop", google, known).swiss, true);
  assert.deepEqual(merchantOf("McGrocer", google, known), { url: null, domain: null, swiss: false, via: null }, "ohne Domain: nicht zugelassen");
  assert.equal(merchantOf("Drinks.ch", "https://www.whisky.de/p/x").swiss, false, "Link geht vor dem Namen");
  // Schlüssel: klein, ohne Akzente/Satzzeichen/Rechtsform; Startdaten passen dazu
  assert.equal(merchantKey("Kitsune Trading Sagl"), "kitsune trading");
  assert.equal(merchantKey("Hugi Weine AG"), "hugi weine");
  assert.equal(merchantKey("by Vinello"), "vinello");
  for (const m of SEED) assert.equal(merchantKey(m.display_name), m.name_key, m.display_name);
  assert.ok(SEED.length >= 10);
  // Kandidaten tragen Domain und swiss
  const c = serperCandidates({ shopping: [
    { title: "Noah's Mill 70cl", source: "Whisky.de", price: "CHF 84.90", link: google },
    { title: "Noah's Mill 70cl", source: "Korkenknaller.ch", price: "CHF 88.00", link: google },
  ] });
  assert.deepEqual(c.map((x) => [x.source, x.domain, x.swiss]), [["Whisky.de", "whisky.de", false], ["Korkenknaller.ch", "korkenknaller.ch", true]]);
});

test("Produzent hart: Gattungsname (Pflaumenbrand) mit anderem Produzenten → no; eigenständiger Name unberührt", () => {
  const yes = { verdict: "yes" as const, reason: "gleiches Produkt", sizeMl: 500, year: null };
  const hecht = { name: "Pflaumenbrand Liqueur", producer: "Urs Hecht" };
  assert.equal(producerCheck(hecht, { title: "Pflaumenbrand Liqueur 50cl", source: "Schubi Weine" }, yes).verdict, "no");
  assert.equal(producerCheck(hecht, { title: "Pflaumen-Liqueur 50 cl", source: "schuewo.ch" }, yes).verdict, "no");
  assert.equal(producerCheck(hecht, { title: "Urs Hecht Pflaumenbrand Liqueur 50cl", source: "regionseetal.ch" }, yes).verdict, "yes");
  assert.equal(producerCheck({ name: "Noah's Mill", producer: "Willett Distillery" }, { title: "Noah's Mill 70cl", source: "drinks.ch" }, yes).verdict, "yes");
  assert.match(judgePrompt({ name: "Pflaumenbrand Liqueur", producer: "Urs Hecht", type: "spirit", year: null, sizeMl: 500 }, []), /"gattungsname":true/);
});

const drinksNoah = "https://www.drinks.ch/de/noah-s-mill-bourbon-70cl.html";
function noahShops() {
  shopPages.set("https://www.drinks.ch/de/search", `<a href="${drinksNoah}">Noah's Mill</a>`);
  shopPages.set(drinksNoah, `<script type="application/ld+json">{"@type":"Product","name":"Noah's Mill Kentucky Straight Bourbon 70cl","offers":{"price":"86.90","priceCurrency":"CHF"}}</script>`);
  shopPages.set("https://www.bringts.ch/search/suggest.json", JSON.stringify({ resources: { results: { products: [{ title: "Noahs Mill Small Batch Bourbon", url: "/products/noahs-mill-small-batch?_pos=1" }] } } }));
  shopPages.set("https://www.bringts.ch/products/noahs-mill-small-batch.js", JSON.stringify({ title: "Noahs Mill Small Batch Bourbon - 700ml", vendor: "Willett", variants: [{ title: "Default Title", price: 8525, available: true }] }));
}

for (const provider of ["serpapi", "serper"] as const) {
  test(`${provider}: Noah's Mill – Auslandshändler raus, drinks.ch/bringts.ch direkt dazu → 86.90`, async () => {
    reset();
    noahShops();
    answers.set("Noah's Mill 70cl", [
      g("Noah's Mill Bourbon 70cl", "vinecatas", 79),
      g("Noah's Mill Kentucky Straight Bourbon 0,7l", "Whisky.de", 84.9),
      g("Noah's Mill 57,15% 70cl", "Versus Vins & Spiritueux", 95),
      g("Noah's Mill Bourbon 70cl", "Bourbon Blackpool", 72),
    ]);
    judge = { oah: { v: "yes", size: 700 } };
    const { finding, diagnostics } = await researchPrice(spirit("Noah's Mill", "Willett Distillery"), null, 700, null, { db, ...keys(provider) });
    assert.ok(finding.kind === "exact" && finding.amount === 86.9 && finding.merchants === 2, JSON.stringify(finding));
    assert.ok(finding.kind === "exact" && /drinks\.ch/.test(finding.url));
    const s = diagnostics.shopping!;
    assert.deepEqual(s.candidates.filter((c) => c.origin === "direct").map((c) => [c.domain, c.price, c.verdict]), [["drinks.ch", 86.9, "yes"], ["bringts.ch", 85.25, "yes"]]);
    assert.deepEqual(s.candidates.filter((c) => !c.swiss).map((c) => [c.source, c.verdict]), [["vinecatas", "foreign"], ["Whisky.de", "foreign"], ["Versus Vins & Spiritueux", "foreign"], ["Bourbon Blackpool", "foreign"]]);
    assert.ok(s.candidates.every((c) => typeof c.link === "string" && "domain" in c));
    assert.deepEqual(qs(), ["Noah's Mill 70cl", "Willett Noah's Mill 70cl"], "keine Schweizer Google-Treffer: zweite Abfrage mit Marke");
  });
}

test("Lazzaroni, Blanton's, Hennessy: ohne Auslandshändler keine Rückfrage «Preise uneinheitlich»", async () => {
  const cases: { wine: PriceWine; q: string; offers: Offer[]; key: string; min: number; max: number }[] = [
    {
      wine: spirit("Amaretto", "Paolo Lazzaroni & Figli"), q: "Lazzaroni Amaretto 70cl", key: "Lazzaroni", min: 29.9, max: 31,
      offers: [g("Amaretto Lazzaroni 70cl", "Macandrew's Liquors & Spirits", 18), g("Lazzaroni Amaretto 700ml", "McGrocer", 45), g("Lazzaroni Amaretto 70cl", "Drinks.ch", 29.9), g("Lazzaroni Amaretto Originale 70cl", "Casa Poli", 31)],
    },
    {
      wine: spirit("Blanton's Original", "Buffalo Trace Distillery"), q: "Blanton's Original 70cl", key: "Blanton", min: 89, max: 95,
      offers: [g("Blanton's Original Single Barrel 700ml", "McGrocer", 65), g("Blanton's Original 70cl", "Hedonism Wines", 150), g("Blanton's Original 70cl", "Master of Malt", 130), g("Blanton's Original Single Barrel", "Whisky.de", 70), g("Blanton’s Original, Buffalo Trace Distillery, 70 cl", "Korkenknaller.ch", 89), g("Blanton's Original Single Barrel 70cl", "galaxus.ch", 92), g("Blanton's Original 70cl", "Schnapsdealer.ch", 95)],
    },
    {
      wine: spirit("Hennessy VS", "Jas Hennessy & Co."), q: "Hennessy VS 70cl", key: "Hennessy", min: 39.95, max: 42.9,
      offers: [g("Hennessy Very Special Cognac 70cl", "jahrhundertweine.de", 25), g("Hennessy VS 70cl", "Amazon.it", 30), g("Hennessy VS Cognac 70cl", "coop.ch", 39.95), g("Hennessy VS 70cl", "galaxus.ch", 41), g("Hennessy V.S. 70 cl", "Manor", 42.9)],
    },
  ];
  for (const c of cases) {
    reset();
    answers.set(c.q, c.offers);
    judge = { [c.key]: { v: "yes", size: 700 } };
    const { finding, diagnostics } = await researchPrice(c.wine, null, 700, null, { db, ...keys("serper") });
    assert.ok(finding.kind === "exact" && finding.amount >= c.min && finding.amount <= c.max, `${c.key}: ${JSON.stringify(finding)}`);
    assert.ok(diagnostics.shopping!.candidates.filter((x) => x.verdict === "foreign").length >= 2, c.key);
  }
});

test("Pflaumenbrand Liqueur (Urs Hecht, 50 cl): andere Produzenten → no, auch wenn Haiku yes sagt", async () => {
  reset();
  answers.set("Urs Hecht Pflaumenbrand Liqueur 50cl", [
    g("Pflaumenbrand Liqueur 50cl", "Schubi Weine", 119),
    g("Pflaumen Liqueur 50 cl", "schuewo.ch", 52),
    g("Pflaumenbrand Liqueur Urs Hecht 50cl", "regionseetal.ch", 34),
  ]);
  judge = { Pflaumen: { v: "yes", size: 500 } };
  const { finding, diagnostics } = await researchPrice(spirit("Pflaumenbrand Liqueur", "Urs Hecht"), null, 500, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount === 34, JSON.stringify(finding));
  const s = diagnostics.shopping!;
  assert.equal(s.candidates.find((c) => c.source === "schuewo.ch")?.verdict, "no");
  assert.equal(s.candidates.find((c) => c.source === "Schubi Weine")?.verdict, "foreign");
});

// --- Google-Suche site:.ch und gelernte Händlernamen

const ld = (name: string, price: string, site?: string) =>
  `<html><head><title>${name} | ${site ?? "Shop"}</title>${site ? `<meta property="og:site_name" content="${site}">` : ""}</head><body><script type="application/ld+json">{"@type":"Product","name":"${name}","offers":{"price":"${price}","priceCurrency":"CHF"}}</script></body></html>`;

test("Suche: Treffer aus Serper (Rich Snippet nur mit Währung), Shopname aus der Seite", () => {
  const hits = serperSearchHits({ organic: [
    { link: "https://www.drinks.ch/de/x.html", title: "Noah's Mill | Drinks.ch", snippet: "Bourbon …", price: 86.9, currency: "CHF" },
    { link: "https://shop.ch/y", title: "Y", attributes: { Preis: "CHF 49.90", Verfügbarkeit: "an Lager" } },
    { link: "https://shop.ch/z", title: "Z", price: 12 },
  ] });
  assert.deepEqual(hits.map((h) => h.price), [{ amount: 86.9, currency: "CHF" }, { amount: 49.9, currency: "CHF" }, null]);
  assert.equal(shopNameFromHtml('<meta property="og:site_name" content="Hugi Weine">'), "Hugi Weine");
  assert.equal(shopNameFromHtml("<title>Noah's Mill Bourbon 70cl | Drinks.ch</title>"), "Drinks.ch");
  assert.equal(shopNameFromHtml('<script type="application/ld+json">{"@type":"Product","offers":{"seller":{"@type":"Organization","name":"Jeggli Weine"}}}</script>'), "Jeggli Weine");
  assert.equal(shopNameFromHtml("<title>Startseite</title>"), null);
});

for (const provider of ["serpapi", "serper"] as const) {
  test(`${provider}: Noah's Mill – site:.ch-Suche liefert drinks.ch und bringts.ch → gelesen → 85–87; Ausland bleibt draussen`, async () => {
    reset();
    answers.set("Noah's Mill 70cl", [g("Noah's Mill Kentucky Straight Bourbon 0,7l", "Whisky.de", 84.9), g("Noah's Mill 57,15% 70cl", "Versus Vins & Spiritueux", 95), g("Noah's Mill Bourbon 70cl", "vinecatas", 79)]);
    searchAnswers.set("Noah's Mill 70cl site:.ch", [
      { link: "https://de.wikipedia.org/wiki/Willett_Distillery", title: "Willett Distillery – Wikipedia" },
      { link: "https://www.local.ch/de/d/zuerich/whisky-bar", title: "Whisky Bar Zürich – local.ch" },
      { link: drinksNoah, title: "Noah's Mill Bourbon 70cl | Drinks.ch" },
      { link: "https://www.bringts.ch/products/noahs-mill-small-batch", title: "Noahs Mill Small Batch – bringts.ch" },
    ]);
    shopPages.set(drinksNoah, ld("Noah's Mill Kentucky Straight Bourbon 70cl", "86.90", "Drinks.ch"));
    shopPages.set("https://www.bringts.ch/products/noahs-mill-small-batch.js", JSON.stringify({ title: "Noahs Mill Small Batch Bourbon - 700ml", vendor: "Willett", variants: [{ title: "Default Title", price: 8525, available: true }] }));
    shopPages.set("https://www.bringts.ch/products/noahs-mill-small-batch", '<meta property="og:site_name" content="bringts.ch">');
    shopPages.set("https://www.local.ch/", "<html><title>Whisky Bar Zürich – local.ch</title><body>Adresse, Öffnungszeiten</body></html>");
    judge = { oah: { v: "yes", size: 700 } };
    const { finding, diagnostics } = await researchPrice(spirit("Noah's Mill", "Willett Distillery"), null, 700, null, { db, ...keys(provider) });
    assert.ok(finding.kind === "exact" && finding.amount >= 85 && finding.amount <= 87 && finding.merchants === 2, JSON.stringify(finding));
    const s = diagnostics.shopping!;
    assert.deepEqual(s.candidates.filter((c) => c.origin === "search").map((c) => [c.domain, c.price, c.via, c.verdict]), [["drinks.ch", 86.9, "link", "yes"], ["bringts.ch", 85.25, "link", "yes"]]);
    assert.deepEqual(s.candidates.filter((c) => !c.swiss).map((c) => c.verdict), ["foreign", "foreign", "foreign"]);
    assert.ok(!s.search?.pages.some((u) => /wikipedia/.test(u)), "keine .ch-Domain: nicht gelesen");
    assert.equal(diagnostics.pages.find((p) => p.url.includes("local.ch"))?.result, "no_price", "Verzeichnis: keine Produktseite");
    assert.deepEqual(searchCalls.map((c) => c.q), ["Willett Noah's Mill 70cl site:.ch", "Noah's Mill 70cl site:.ch"], "mit Marke nichts: die andere Variante");
    assert.ok(calls.length + searchCalls.length <= 4, "höchstens 4 Abfragen");
    // Shopnamen gelernt
    assert.deepEqual(net.tables.merchants.filter((m) => m.source === "page").map((m) => [m.name_key, m.domain, m.swiss]), [["drinks ch", "drinks.ch", true], ["bringts ch", "bringts.ch", true]]);
  });
}

test("Händlername lernen: «Hugi Weine» erst zugelassen, nachdem eine gelesene hugi-weine.ch-Seite den Namen gelernt hat", async () => {
  const nosiola = spirit("Grappa Nosiola", "Villa de Varda");
  const hugi = g("I Monovitigni Grappa Nosiola, Villa de Varda, 70cl", "Hugi Weine", 54);
  const hugiPage = "https://www.hugi-weine.ch/de/villa-de-varda-grappa-nosiola";
  const run = async () => {
    answers.set("Grappa Nosiola 70cl", [hugi]);
    judge = { Nosiola: { v: "yes", size: 700 } };
    const r = await researchPrice(nosiola, null, 700, null, { db, ...keys("serper") });
    return { ...r, hugi: r.diagnostics.shopping!.candidates.find((c) => c.source === "Hugi Weine" && c.origin === "shopping")! };
  };
  reset();
  const before = await run();
  assert.deepEqual([before.hugi.swiss, before.hugi.verdict, before.hugi.via], [false, "foreign", null]);
  assert.equal(before.finding.kind, "none", "nur unbekannter Händler: kein Preis");
  // Google-Suche findet die Seite von Hugi Weine → Name gelernt → derselbe Lauf lässt den Shopping-Treffer zu
  searchAnswers.set("Grappa Nosiola 70cl site:.ch", [{ link: hugiPage, title: "Grappa Nosiola Villa de Varda – Hugi Weine" }]);
  shopPages.set(hugiPage, ld("Villa de Varda I Monovitigni Grappa Nosiola 70cl", "54.00", "Hugi Weine"));
  const learned = await run();
  assert.deepEqual([learned.hugi.swiss, learned.hugi.domain, learned.hugi.via, learned.hugi.verdict], [true, "hugi-weine.ch", "page", "yes"]);
  assert.deepEqual(net.tables.merchants.find((m) => m.name_key === "hugi weine"), { ...net.tables.merchants.find((m) => m.name_key === "hugi weine"), display_name: "Hugi Weine", domain: "hugi-weine.ch", swiss: true, source: "page" });
  // Später ohne Seite: aus der Tabelle merchants
  searchAnswers.clear();
  shopPages.clear();
  const later = await run();
  assert.deepEqual([later.hugi.swiss, later.hugi.via], [true, "merchants"]);
  assert.ok(later.finding.kind === "exact" && later.finding.amount === 54);
});

test("Seite nicht lesbar (403) mit Rich-Snippet-Preis → verwendet; ohne Preis bzw. lesbare Nicht-Produktseite → verworfen; höchstens 4 Abfragen", async () => {
  reset();
  searchAnswers.set("Creanza 50cl site:.ch", [
    { link: "https://www.weinshop-x.ch/creanza-50cl", title: "Creanza 50cl – Weinshop X", price: 34.5, currency: "CHF" },
    { link: "https://www.weinshop-y.ch/creanza", title: "Creanza – Weinshop Y" },
    { link: "https://www.moneyhouse.ch/de/company/moreno-wildhaber", title: "Moreno Wildhaber – Moneyhouse", price: 99, currency: "CHF" },
  ]);
  shopPages.set("https://www.weinshop-x.ch/", 403);
  shopPages.set("https://www.weinshop-y.ch/", 403);
  shopPages.set("https://www.moneyhouse.ch/", "<html><title>Moreno Wildhaber – Moneyhouse</title><body>Handelsregister</body></html>");
  judge = { Creanza: { v: "yes", size: 500 } };
  const { finding, diagnostics } = await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount === 34.5 && finding.merchant === "weinshop-x.ch", JSON.stringify(finding));
  const pages = Object.fromEntries(diagnostics.pages.map((p) => [new URL(p.url).hostname, p.result]));
  assert.deepEqual(pages, { "www.weinshop-x.ch": "unreadable:snippet", "www.weinshop-y.ch": "unreadable", "www.moneyhouse.ch": "no_price" });
  assert.deepEqual([calls.length, searchCalls.length], [2, 2]);
  assert.deepEqual(diagnostics.shopping!.candidates.map((c) => [c.origin, c.domain]), [["search", "weinshop-x.ch"]]);
});

// --- Marke in einer der Abfragen, Grösse im Code

test("Abfragen: Shopping mit dem Namen, site:.ch mit Marke (falls nicht im Namen); zweite Abfrage die andere Variante", () => {
  assert.deepEqual(googleQueries({ name: "Very Special", producer: "Hennessy", sizeMl: 700 }), {
    shopping: ["Very Special 70cl", "Hennessy Very Special 70cl"],
    search: ["Hennessy Very Special 70cl site:.ch", "Very Special 70cl site:.ch"],
    brand: "Hennessy",
  });
  const noah = googleQueries({ name: "Noah's Mill", producer: "Willett Distillery", sizeMl: 700 });
  assert.equal(noah.shopping[0], "Noah's Mill 70cl", "eine Abfrage ohne «Willett»");
  assert.equal(noah.search[0], "Willett Noah's Mill 70cl site:.ch");
  // Marke schon im Namen: wie bisher (zweite Abfrage ohne Grösse)
  assert.deepEqual(googleQueries({ name: "Disaronno Originale", producer: "Illva Saronno", sizeMl: 700 }), {
    shopping: ["Disaronno Originale 70cl", "Disaronno Originale"],
    search: ["Disaronno Originale 70cl site:.ch", "Disaronno Originale site:.ch"],
    brand: null,
  });
  assert.deepEqual(googleQueries({ name: "Pintia", producer: null, year: 2019, sizeMl: 750 }).shopping, ["Pintia 2019 75cl", "Pintia 2019"]);
});

test("Grösse: 50 cl = 500 ml = 0,5 l; «0,7» und «70cl.» = 700 ml", () => {
  for (const t of ["Pflümli 50 cl", "Pflümli 500 ml", "Pflümli 0,5 l", "Pflümli 0.5 Liter", "Pflümli 500ml"]) assert.equal(sizeFromText(t), 500, t);
  for (const t of ["Hennessy VS 0,7", "Hennessy VS 70cl.", "Hennessy VS (0,7)", "Hennessy VS 0.7l"]) assert.equal(sizeFromText(t), 700, t);
  assert.equal(sizeFromText("Rum 40,5% Vol."), null);
  assert.equal(sizeFromText("Grappa 1,5"), 1500);
  // Abgleich: Grösse im Prompt schon in ml, harte Prüfung allein im Code
  const p = judgePrompt({ name: "Vieille Prune", producer: "Studer", type: "spirit", year: null, sizeMl: 500 }, [{ title: "Studer Vieille Prune 50 cl", source: "pepillo.ch", price: 49 }]);
  assert.match(p, /CHF 49\.00 – 500 ml/);
});

test("pepillo.ch «50 cl» bei 500 ml: gleiche Grösse, auch wenn Haiku anders meint", async () => {
  reset();
  answers.set("Vieille Prune 50cl", [g("Studer Vieille Prune 50 cl", "pepillo.ch", 49), g("Studer Vieille Prune 500 ml", "Drinks.ch", 51), g("Studer Vieille Prune 0,35 l", "galaxus.ch", 32)]);
  judge = { "Studer Vieille Prune": { v: "yes", size: 700 } };
  const { finding, diagnostics } = await researchPrice(spirit("Vieille Prune", "Studer"), null, 500, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount === 51 && finding.merchants === 2, JSON.stringify(finding));
  const v = Object.fromEntries(diagnostics.shopping!.candidates.map((c) => [c.source, c.verdict]));
  assert.deepEqual(v, { "pepillo.ch": "yes", "Drinks.ch": "yes", "galaxus.ch": "variant" });
});

test("Hennessy «Very Special»: Google-Suche mit «Hennessy Very Special 70cl», andere Marken bleiben no", async () => {
  reset();
  answers.set("Very Special 70cl", [g("Camus VS Very Special Cognac 70cl", "galaxus.ch", 39), g("Davidoff VS Very Special Cognac 40° 70cl", "bottlebutler.ch", 35), g("Baron Otard VS Very Special 70cl", "coop.ch", 36), g("3x Hennessy Very Special 70cl", "gustero.ch", 129)]);
  answers.set("Hennessy Very Special 70cl", [g("Hennessy Very Special Cognac 70cl", "coop.ch", 44.95)]);
  searchAnswers.set("Hennessy Very Special 70cl site:.ch", [{ link: "https://www.drinks.ch/de/hennessy-very-special-70cl.html", title: "Hennessy Very Special 70cl | Drinks.ch" }]);
  shopPages.set("https://www.drinks.ch/de/hennessy-very-special-70cl.html", ld("Hennessy Very Special Cognac 70cl", "45.90", "Drinks.ch"));
  judge = { "Hennessy Very Special Cognac": { v: "yes" }, "3x Hennessy": { v: "variant", reason: "Mehrfachpackung" } };
  const { finding } = await researchPrice(spirit("Very Special", "Hennessy"), null, 700, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount >= 44.95 && finding.amount <= 45.9 && finding.merchants === 2, JSON.stringify(finding));
  assert.ok([...calls, ...searchCalls].some((c) => c.q.startsWith("Hennessy Very Special 70cl")));
  assert.ok(calls.length + searchCalls.length <= 4);
});

// --- Ausführung (Liqueur/Holzfass) und unbekannte Grösse

test("Ausführung hart: Liqueur gegen Brand, Holzfass gegen ohne → variant; Amaretto Liqueur bleibt gleich", () => {
  const yes = { verdict: "yes" as const, reason: "gleich", sizeMl: 500, year: null };
  const holz = { name: "Pflaumenbrand Holzfass", cask: null };
  assert.equal(styleCheck(holz, { title: "Pflaumenbrand Liqueur Urs Hecht 50cl" }, yes).verdict, "variant");
  assert.equal(styleCheck(holz, { title: "Pflaumenbrand Urs Hecht 50cl" }, yes).verdict, "variant", "ohne Holzfass");
  assert.equal(styleCheck(holz, { title: "Pflaumenbrand Urs Hecht, im Holzfass 50 cl" }, yes).verdict, "yes");
  assert.equal(styleCheck({ name: "Williamsbrand Liqueur" }, { title: "Williamsbrand Urs Hecht 50cl" }, yes).verdict, "variant");
  assert.equal(styleCheck({ name: "Amaretto" }, { title: "Lazzaroni Amaretto Liqueur 70cl" }, yes).verdict, "yes");
  assert.match(JUDGE_SYSTEM, /Liqueur\/Likör statt Brand/);
  assert.match(JUDGE_SYSTEM, /Holzfass\/Barrique/);
});

test("Pflaumenbrand Holzfass (Urs Hecht): «… im Holzfass» 124.00 gewählt, Pflaumenbrand Liqueur nur variant", async () => {
  reset();
  answers.set("Pflaumenbrand Holzfass 50cl", [
    g("Pflaumenbrand Liqueur Urs Hecht 50cl", "schuewo.ch", 54.5),
    g("Pflaumenbrand Urs Hecht, im Holzfass 50 cl", "schuewo.ch", 124),
  ]);
  judge = { Pflaumenbrand: { v: "yes" } };
  const { finding, diagnostics } = await researchPrice(spirit("Pflaumenbrand Holzfass", "Urs Hecht"), null, 500, null, { db, ...keys("serper") });
  assert.ok(finding.kind === "exact" && finding.amount === 124, JSON.stringify(finding));
  assert.deepEqual(diagnostics.shopping!.candidates.filter((c) => c.origin === "shopping").map((c) => [c.price, c.verdict]), [[54.5, "variant"], [124, "yes"]]);
});

test("Grösse unbekannt: ohne Grösse suchen, kein hartes Kriterium, Treffer nur als Rückfrage mit Angebotsgrösse", async () => {
  reset();
  answers.set("Pflaumenbrand Holzfass", [g("Pflaumenbrand Urs Hecht, im Holzfass 50 cl", "schuewo.ch", 124)]);
  judge = { Pflaumenbrand: { v: "yes" } };
  const { finding } = await researchPrice(spirit("Pflaumenbrand Holzfass", "Urs Hecht"), null, null, null, { db, ...keys("serper") });
  assert.deepEqual(finding, { kind: "other", amount: 124, merchant: "schuewo.ch", url: finding.kind === "other" ? finding.url : "", year: null, sizeMl: 500, reason: "size_unknown", why: "Angebot für 50 cl – stimmt die Grösse" });
  assert.equal(qs()[0], "Pflaumenbrand Holzfass", "Abfrage ohne Grösse");
  assert.ok([...qs(), ...searchCalls.map((c) => c.q)].every((q) => !/\d+cl/.test(q)));
  assert.equal(T.priceSizeCheck("🥃 Pflaumenbrand Holzfass", "CHF 124.00", "50 cl", "schuewo.ch"), "🥃 Pflaumenbrand Holzfass\nGefunden: CHF 124.00 für 50 cl (schuewo.ch) – stimmt die Grösse? Übernehmen?");
  // Grösse bekannt: wie bisher direkt ein Treffer
  assert.equal(sizeUnknownFinding({ kind: "none" }).kind, "none");
});

test("Suchbegriffe: Marke schon im Namen → nicht nochmals voranstellen", () => {
  const q = googleQueries({ name: "Hennessy Very Special", producer: "Hennessy", sizeMl: 700 });
  assert.ok([...q.shopping, ...q.search].every((x) => !/Hennessy Hennessy/.test(x)), JSON.stringify(q));
  assert.equal(q.brand, null);
  const noSize = googleQueries({ name: "Galliano Vanilla", producer: "Galliano", sizeMl: null });
  assert.deepEqual(noSize, { shopping: ["Galliano Vanilla"], search: ["Galliano Vanilla site:.ch"], brand: null });
});
