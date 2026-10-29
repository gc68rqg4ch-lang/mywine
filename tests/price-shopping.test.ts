// Preissuche über Google Shopping Schweiz (SerpApi) + Haiku-Abgleich: Kandidaten nur in CHF ohne
// Marktplätze, Urteil yes/variant/no, Grösse und Jahrgang hart geprüft, Preiswahl, direkte Shops
// nur als Ergänzung, Kontingent (230/250), ohne Schlüssel Rückfall. Nachgebildete SerpApi- und
// Claude-Antworten – ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CANDIDATES, shoppingCandidates, shoppingUrl } from "@/lib/research/serpapi";
import { hardCheck, judgePrompt } from "@/lib/research/price-judge";
import { researchPrice, serpQueriesAllowed, type PriceWine } from "@/lib/research/price";
import { costUsd } from "@/lib/ai/cost";

type Result = { title: string; source: string; price: string; extracted_price: number; extracted_old_price?: number; link?: string };
const r = (title: string, source: string, chf: number, extra: Partial<Result> = {}): Result => ({
  title, source, price: `CHF ${chf.toFixed(2)}`, extracted_price: chf, link: `https://www.${source.toLowerCase().replace(/[^a-z0-9.]/g, "")}/p/${encodeURIComponent(title)}`, ...extra,
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
  const p = judgePrompt({ name: "Noah's Mill", producer: "Willett Distillery", type: "spirit", category: "Bourbon", year: null, sizeMl: 700, alcohol: 57.2 }, [{ title: "Noah's Mill Bourbon 70cl", source: "drinks.ch", price: 86.9, regular: null, url: "" }]);
  assert.match(p, /"name":"Noah's Mill".*"kategorie":"Bourbon".*"alkohol":57\.2/);
  assert.match(p, /0\. Noah's Mill Bourbon 70cl – drinks\.ch – CHF 86\.90/);
});

test("Kontingent: 2 Abfragen, ab 230 im Monat 1, ab 250 keine; SerpApi kostet nichts, zählt aber als Suche", () => {
  assert.deepEqual([0, 229, 230, 249, 250, 300].map(serpQueriesAllowed), [2, 2, 1, 1, 0, 0]);
  assert.equal(costUsd("serpapi", { server_tool_use: { web_search_requests: 1 } }), 0);
});

// --- Ablauf mit Stub

/** Antworten je Suchbegriff (q) bzw. Fehler. */
const serp = new Map<string, unknown>();
const serpCalls: string[] = [];
/** Haiku-Urteil je Titel (Teiltext). */
let judge: Record<string, { v: "yes" | "variant" | "no"; reason?: string; size?: number; vintage?: number }> = {};
let judgeCalls = 0;
let sonnetCalls = 0;
const NOTHING = { found: false, same_wine: false, product_title: "", merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "", candidate_urls: [], reason: "" };
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
  web: (url) => {
    if (!url.startsWith("https://serpapi.com/")) return null;
    const q = new URL(url).searchParams.get("q") ?? "";
    serpCalls.push(q);
    const answer = serp.get(q);
    if (answer === "quota") return { status: 429, body: JSON.stringify({ error: "Your account has run out of searches." }), type: "application/json" };
    return { body: JSON.stringify(answer ?? { error: "Google hasn't returned any results for this query." }), type: "application/json" };
  },
};
installNet(net);
const db = createAdminClient();
const KEY = { serpApiKey: "test-key" };

function reset() {
  serp.clear();
  serpCalls.length = 0;
  judge = {};
  judgeCalls = 0;
  sonnetCalls = 0;
  net.tables = { api_usage: [] };
}
const spirit = (name: string, producer: string | null, extra: Partial<PriceWine> = {}): PriceWine => ({ name, producer, type: "spirit", country: null, region: null, appellation: null, ...extra });

test("Lazzaroni Amaretto 70 cl → 29.90 (Eigenmarke no, Literflasche nur variant, Marktplatz und Euro weg)", async () => {
  reset();
  serp.set("Lazzaroni Amaretto 70cl", {
    shopping_results: [
      r("Lazzaroni Amaretto 70cl", "drinks.ch", 29.9),
      r("Amaretto Liquor 70cl", "Globus", 15.9),
      r("Lazzaroni Amaretto 1 l", "Coop", 39.9),
      r("Lazzaroni Amaretto 70cl", "eBay", 12),
      r("Lazzaroni Amaretto 70 cl Original", "casadeltequila.ch", 30),
      r("Lazzaroni Amaretto Classico 70cl", "Galaxus", 31.5),
    ],
  });
  judge = { "Lazzaroni Amaretto 70": { v: "yes", size: 700 }, "Lazzaroni Amaretto Classico": { v: "yes", size: 700 }, "Lazzaroni Amaretto 1 l": { v: "yes", size: 1000 }, "Amaretto Liquor": { v: "no", reason: "andere Marke" } };
  const { finding, diagnostics } = await researchPrice(spirit("Amaretto", "Paolo Lazzaroni & Figli"), null, 700, "Galaxus", { db, ...KEY });
  assert.ok(finding.kind === "exact", JSON.stringify(finding));
  assert.ok(finding.kind === "exact" && finding.amount === 30 && finding.merchants === 3, "29.90/30.00/31.50 → mittlerer");
  assert.deepEqual(serpCalls, ["Lazzaroni Amaretto 70cl"], "5 Treffer: keine zweite Abfrage");
  assert.equal(judgeCalls, 1);
  assert.equal(sonnetCalls, 0, "keine Claude-Websuche");
  const s = diagnostics.shopping!;
  assert.deepEqual(s.queries, ["Lazzaroni Amaretto 70cl"]);
  assert.ok(!s.candidates.some((c) => c.source === "eBay"));
  assert.deepEqual(s.candidates.find((c) => c.source === "Coop"), { title: "Lazzaroni Amaretto 1 l", price: 39.9, source: "Coop", verdict: "variant", reason: "andere Grösse (100 cl)" });
  assert.equal(s.candidates.find((c) => c.source === "Globus")?.verdict, "no");
  assert.deepEqual(s.chosen, { amount: 30, merchant: "casadeltequila.ch", merchants: 3 });
  assert.equal(diagnostics.verdict, "exact:shopping");
  // Protokoll: SerpApi-Abfrage (kostenlos, 1 Suche) und Haiku
  const rows = net.tables.api_usage;
  assert.deepEqual(rows.filter((x) => x.model === "serpapi").map((x) => [x.purpose, x.web_searches, x.cost_usd]), [["research_price", 1, 0]]);
  assert.ok(rows.some((x) => x.model === "claude-haiku-5-5" && x.purpose === "research_price"));
});

test("Noah's Mill 70 cl → rund 86–95 (Ausreisser 112 weg), Abfrage ohne «Willett»", async () => {
  reset();
  serp.set("Noah's Mill 70cl", {
    shopping_results: [
      r("Noah's Mill Bourbon Whiskey 70cl", "drinks.ch", 86.9),
      r("Noah's Mill Small Batch 70cl 57.15%", "Flaschenpost", 94.95),
      r("NOAH'S MILL Kentucky Bourbon 70 cl", "casadeltequila.ch", 99),
      r("Noahs Mill Small Batch - 700ml (Willett)", "bringts.ch", 85.25),
      r("Noah's Mill Bourbon 0.7 l", "Galaxus", 112),
    ],
  });
  judge = { "oah": { v: "yes", size: 700 }, "OAH": { v: "yes", size: 700 } };
  const { finding } = await researchPrice(spirit("Noah's Mill", "Willett Distillery"), null, 700, null, { db, ...KEY });
  assert.ok(finding.kind === "exact" && finding.amount >= 86 && finding.amount <= 95, JSON.stringify(finding));
  assert.ok(finding.kind === "exact" && finding.merchants === 4);
  assert.equal(serpCalls[0], "Noah's Mill 70cl");
});

test("Premium Pisco (Capel): Reservado ist nur variant – Treffer ist das normale Premium", async () => {
  reset();
  serp.set("Capel Premium Pisco 70cl", {
    shopping_results: [r("Pisco Capel Reservado 70cl", "Globus", 39), r("Capel Premium Pisco 40% 70cl", "Coop", 29.95), r("Capel Pisco Premium 70cl", "mybarkeeper.ch", 34.9)],
  });
  judge = { Reservado: { v: "variant", reason: "Reservado statt Premium", size: 700 }, "Capel Premium Pisco": { v: "yes", size: 700 }, "Capel Pisco Premium": { v: "yes", size: 700 } };
  const { finding, diagnostics } = await researchPrice(spirit("Premium Pisco", "Capel"), null, 700, null, { db, ...KEY });
  assert.ok(finding.kind === "exact" && finding.amount === 34.9 && finding.url !== "" && !/Reservado/.test(finding.url), JSON.stringify(finding));
  assert.equal(diagnostics.shopping!.candidates.find((c) => /Reservado/.test(c.title))?.verdict, "variant");
});

test("Grappa di Barolo Riserva 1991: nur andere Abfüllungen → Rückfrage mit Grund (kein stiller Treffer)", async () => {
  reset();
  serp.set("Grappa di Barolo Riserva 1991 70cl", { shopping_results: [r("Marolo Grappa di Barolo 9 anni 70cl", "piemont-weine.ch", 69)] });
  judge = { "9 anni": { v: "variant", reason: "9 Jahre statt Riserva 1991", size: 700 } };
  const { finding } = await researchPrice(spirit("Grappa di Barolo Riserva", "Distilleria Marolo"), 1991, 700, null, { db, ...KEY });
  assert.notEqual(finding.kind, "exact");
  if (finding.kind === "other") assert.match(String(finding.why), /Jahrgang|Riserva|9 Jahre/);
  assert.deepEqual(serpCalls, ["Grappa di Barolo Riserva 1991 70cl", "Grappa di Barolo Riserva 1991"], "wenig Treffer: zweite Abfrage ohne Grösse");
  assert.equal(sonnetCalls, 0);
});

test("Creanza: Google findet nichts → nicht gefunden, ohne Haiku und ohne Claude-Websuche", async () => {
  reset();
  const { finding, diagnostics } = await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...KEY });
  assert.deepEqual(finding, { kind: "none", reason: "not_found" });
  assert.deepEqual(serpCalls, ["Creanza 50cl", "Creanza"]);
  assert.equal(judgeCalls, 0);
  assert.equal(sonnetCalls, 0);
  assert.equal(diagnostics.verdict, "not_found:shopping");
  assert.ok(diagnostics.direct, "direkte Shop-Suchen als Ergänzung gelaufen");
});

test("Wein mit Jahrgang: Angebot ohne bzw. mit anderem Jahrgang nur variant", async () => {
  reset();
  serp.set("Pintia 2019 75cl", { shopping_results: [r("Pintia Toro", "Mövenpick", 59), r("Pintia 2018 Toro", "Flaschenpost", 61), r("Pintia 2019 Vega Sicilia 75cl", "Gerstl", 64)] });
  judge = { "Pintia Toro": { v: "yes", size: 750 }, "Pintia 2018": { v: "yes", size: 750, vintage: 2018 }, "Pintia 2019": { v: "yes", size: 750, vintage: 2019 } };
  const { finding } = await researchPrice({ name: "Pintia", producer: "Bodegas Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null }, 2019, 750, null, { db, ...KEY });
  assert.ok(finding.kind === "exact" && finding.amount === 64 && finding.year === 2019, JSON.stringify(finding));
});

test("Kontingent: ab 230 nur eine Abfrage, ab 250 und ohne Schlüssel bisherige Suche; Fehler der ersten Abfrage → Rückfall", async () => {
  const month = new Date().toISOString();
  const fill = (n: number) => (net.tables.api_usage = Array.from({ length: n }, (_, i) => ({ id: `u${i}`, model: "serpapi", purpose: "research_price", web_searches: 1, created_at: month })));
  reset();
  fill(235);
  await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...KEY });
  assert.deepEqual(serpCalls, ["Creanza 50cl"], "nur eine Abfrage");

  reset();
  fill(250);
  await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...KEY });
  assert.equal(serpCalls.length, 0, "keine Abfrage mehr");
  assert.equal(sonnetCalls, 1, "Rückfall: bisherige Preissuche");

  reset();
  await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, serpApiKey: null });
  assert.equal(serpCalls.length, 0);
  assert.equal(sonnetCalls, 1, "ohne Schlüssel: bisherige Preissuche");

  reset();
  serp.set("Creanza 50cl", "quota");
  await researchPrice(spirit("Creanza", "Moreno Wildhaber"), null, 500, null, { db, ...KEY });
  assert.deepEqual(serpCalls, ["Creanza 50cl"]);
  assert.equal(sonnetCalls, 1, "SerpApi-Fehler: bisherige Preissuche");
  assert.equal(net.tables.api_usage.filter((x) => x.model === "serpapi").length, 1, "auch die gescheiterte Abfrage zählt");
});
