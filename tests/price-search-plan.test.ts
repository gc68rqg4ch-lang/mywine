// Preissuche grundlegend verbessert: Marke aus dem Produzenten, feste Suchbegriffe, Websuche mit
// Standort Schweiz, direkte Shop-Suchen, eigene Prüfung aller Schweizer Adressen aus den
// Suchergebnissen (auch wenn das Modell nichts meldet), bester Treffer bei mehreren Händlern,
// erweiterte Diagnose und Testlauf (dry_run) – alles ohne Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DIRECT_SHOPS,
  brandFromProducer,
  directShopsFor,
  genericName,
  htmlSearchHits,
  pickBest,
  priceQueries,
  productTerm,
  rankHits,
  searchLog,
  searchTitles,
  shopifySuggestHits,
  swissResultUrls,
  type Found,
} from "@/lib/research/price-search";
import { priceNote, priceNoteHint, researchPrice, PRICE_MAX_SEARCHES } from "@/lib/research/price";
import { researchTools, SWISS_LOCATION } from "@/lib/ingest/recognize";
import { runJob } from "@/lib/research/jobs";

test("Marke aus dem Produzenten: Rechtsform, Familienzusatz und Betriebswörter weg", () => {
  assert.equal(brandFromProducer("Paolo Lazzaroni & Figli"), "Lazzaroni");
  assert.equal(brandFromProducer("Paolo Lazzaroni & Figli S.p.A."), "Lazzaroni");
  assert.equal(brandFromProducer("Illva Saronno S.p.A."), "Illva Saronno");
  assert.equal(brandFromProducer("Distilleria Giovannipoli (Casa Grappa)"), "Casa Grappa");
  assert.equal(brandFromProducer("Cantina Terlan"), "Terlan");
  assert.equal(brandFromProducer("Weingut Gantenbein"), "Gantenbein");
  assert.equal(brandFromProducer("Bodegas Vega Sicilia S.A."), "Vega Sicilia");
  assert.equal(brandFromProducer("Distilleria Marolo"), "Marolo");
  assert.equal(brandFromProducer("Capel"), "Capel");
  assert.equal(brandFromProducer("Moreno Wildhaber"), "Moreno Wildhaber");
  assert.equal(brandFromProducer(null), null);
  assert.equal(brandFromProducer(""), null);
});

test("Gattungsnamen und kurze Namen immer mit Marke; Marke im Namen (Disaronno) → Name allein", () => {
  assert.equal(genericName("Amaretto"), true);
  assert.equal(genericName("Premium Pisco"), true);
  assert.equal(genericName("Grappa Riserva"), true);
  assert.equal(genericName("Chardonnay"), true);
  assert.equal(genericName("Gin"), true);
  assert.equal(genericName("Creanza"), false);
  assert.equal(genericName("Disaronno"), false);
  assert.equal(productTerm({ name: "Amaretto", producer: "Paolo Lazzaroni & Figli" }), "Lazzaroni Amaretto");
  assert.equal(productTerm({ name: "Disaronno", producer: "Illva Saronno" }), "Disaronno", "Name ist selbst die Marke");
  assert.equal(productTerm({ name: "Disaronno Originale", producer: "Illva Saronno S.p.A." }), "Disaronno Originale");
  assert.equal(productTerm({ name: "Premium Pisco", producer: "Capel" }), "Capel Premium Pisco");
  assert.equal(productTerm({ name: "Creanza", producer: "Moreno Wildhaber" }), "Moreno Wildhaber Creanza");
  assert.equal(productTerm({ name: "Lagavulin 16", producer: "Lagavulin Distillery" }), "Lagavulin 16");
  assert.equal(productTerm({ name: "Amaretto", producer: null }), "Amaretto");
});

test("Feste Suchbegriffe: Marke + Name + Grösse, kaufen CHF, site:.ch, Händler nur mit dem ganzen Produkt, Jahrgang", () => {
  assert.deepEqual(priceQueries({ name: "Amaretto", producer: "Paolo Lazzaroni & Figli", sizeMl: 700, vendor: "Galaxus" }), [
    "Lazzaroni Amaretto 70cl",
    "Lazzaroni Amaretto kaufen CHF",
    "Lazzaroni Amaretto site:.ch",
    "Galaxus Lazzaroni Amaretto",
  ]);
  const disaronno = priceQueries({ name: "Disaronno", producer: "Illva Saronno", sizeMl: 700, vendor: "Coop" });
  assert.deepEqual(disaronno, ["Disaronno 70cl", "Disaronno kaufen CHF", "Disaronno site:.ch", "Coop Disaronno"]);
  assert.ok(!disaronno.some((q) => /Originale/.test(q) && /Coop/.test(q)), "kein „Coop Originale“");
  assert.deepEqual(priceQueries({ name: "Pintia", producer: "Bodegas Vega Sicilia", year: 2019, sizeMl: 750 }), [
    "Vega Sicilia Pintia 2019 75cl",
    "Vega Sicilia Pintia 2019 kaufen CHF",
    "Vega Sicilia Pintia 2019 site:.ch",
  ]);
  // Eigenständiger Name aus mehreren Wörtern: zuletzt auch ohne Marke
  assert.equal(priceQueries({ name: "Americano al Ciapón", producer: "Distilleria Beccaris", sizeMl: 700 }).at(-1), "Americano al Ciapón 70cl");
});

test("Websuche mit Standort Schweiz (Zürich) für alle Recherchen; Preissuche bis 10 Suchen", () => {
  const tools = researchTools({ toolName: "x", toolDescription: "x", inputSchema: { type: "object" }, maxSearches: PRICE_MAX_SEARCHES });
  const search = tools.find((t) => "type" in t && t.type === "web_search_20260209") as { max_uses?: number; user_location?: unknown };
  assert.equal(search.max_uses, 10);
  assert.deepEqual(search.user_location, { type: "approximate", country: "CH", city: "Zürich", region: "Zürich", timezone: "Europe/Zurich" });
  assert.equal(SWISS_LOCATION.country, "CH");
});

test("Shop-Suchen: Shopify-Vorschläge und HTML-Trefferlisten auswerten, passende Treffer zuerst", () => {
  const suggest = { resources: { results: { products: [
    { title: "Disaronno Likör, 1 Liter", url: "/products/disaronno-likor-1-liter?_pos=1&_psq=amaretto" },
    { title: "Gozio Amaretto 70cl", url: "/products/gozio-amaretto-70cl?_pos=2" },
    { title: "Lazzaroni Amaretto 70 cl", url: "/products/lazzaroni-amaretto?_pos=3" },
  ] } } };
  const hits = shopifySuggestHits(suggest, "https://finespirits.ch");
  assert.equal(hits[0].url, "https://finespirits.ch/products/disaronno-likor-1-liter");
  const lazzaroni = { name: "Amaretto", producer: "Paolo Lazzaroni & Figli" };
  assert.deepEqual(rankHits(hits, lazzaroni).map((h) => h.url), ["https://finespirits.ch/products/lazzaroni-amaretto"], "Gattungsname: nur mit Marke");
  assert.deepEqual(rankHits(hits, { name: "Disaronno", producer: "Illva Saronno" }).map((h) => h.url), ["https://finespirits.ch/products/disaronno-likor-1-liter"]);

  const drinks = DIRECT_SHOPS.find((s) => s.id === "drinks.ch")!;
  const html = `<a href="https://www.drinks.ch/de/whisky.html">Whisky</a><a href="https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html">x</a><a href="https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html">y</a>`;
  const drinkHits = htmlSearchHits(html, drinks);
  assert.equal(drinkHits.length, 2);
  assert.deepEqual(rankHits(drinkHits, lazzaroni).map((h) => h.url), ["https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html"]);
  assert.equal(drinks.search("Lazzaroni Amaretto"), "https://www.drinks.ch/de/search?q=Lazzaroni+Amaretto");

  const fp = DIRECT_SHOPS.find((s) => s.id === "flaschenpost.ch")!;
  const fpHits = htmlSearchHits(`<a href="/barolo-docg_azienda-vinicole-ceretto?_size=750&amp;_vintage=2022">`, fp);
  assert.deepEqual(fpHits, [{ url: "https://www.flaschenpost.ch/barolo-docg_azienda-vinicole-ceretto?_size=750&_vintage=2022", label: "barolo docg azienda vinicole ceretto 75cl 2022" }]);
  assert.ok(!directShopsFor("spirit").some((s) => s.id === "flaschenpost.ch"), "Flaschenpost nur für Wein");
  assert.ok(directShopsFor("red").some((s) => s.id === "flaschenpost.ch"));
});

/** Suchergebnisse wie von der API (server_tool_use + web_search_tool_result). */
const searchBlocks = (searches: { query: string; results: { url: string; title: string }[] | { error_code: string } }[]) =>
  searches.flatMap((s, i) => [
    { type: "server_tool_use", id: `srv${i}`, name: "web_search", input: { query: s.query } },
    {
      type: "web_search_tool_result",
      tool_use_id: `srv${i}`,
      content: Array.isArray(s.results)
        ? s.results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "x", page_age: null }))
        : { type: "web_search_tool_result_error", error_code: s.results.error_code },
    },
  ]);

test("Suchergebnisse: Suchbegriffe in Reihenfolge, Adressen je Suche, Fehler; Schweizer Shop-Adressen gesammelt", () => {
  const blocks = searchBlocks([
    { query: "Lazzaroni Amaretto 70cl", results: [
      { url: "https://www.amazon.de/lazzaroni-amaretto", title: "Lazzaroni Amaretto – Amazon" },
      { url: "https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html", title: "Lazzaroni Amaretto 70cl | Drinks.ch" },
      { url: "https://www.galaxus.ch/de/s1/product/gozio-amaretto-70cl-123", title: "Gozio Amaretto 70 cl" },
      { url: "https://www.drinks.ch/de/search?q=amaretto", title: "Suche" },
    ] },
    { query: "Lazzaroni Amaretto kaufen CHF", results: { error_code: "max_uses_exceeded" } },
  ]);
  const log = searchLog(blocks);
  assert.deepEqual(log.map((s) => s.query), ["Lazzaroni Amaretto 70cl", "Lazzaroni Amaretto kaufen CHF"]);
  assert.equal(log[0].urls.length, 4);
  assert.equal(log[1].error, "max_uses_exceeded");
  const urls = swissResultUrls(log, searchTitles(blocks), { name: "Amaretto", producer: "Paolo Lazzaroni & Figli" });
  assert.deepEqual(urls, ["https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html", "https://www.galaxus.ch/de/s1/product/gozio-amaretto-70cl-123"], "passender Titel zuerst; kein Ausland, keine Suchseite");
});

test("Bester Treffer: exakt vor „other“; Preise beieinander → häufigster bzw. mittlerer, bei zwei der höhere; Ausreisser weg", () => {
  const f = (amount: number, host: string, kind: Found["kind"] = "exact"): Found => ({ kind, amount, merchant: host, url: `https://www.${host}/x`, year: null, sizeMl: 700 });
  assert.deepEqual(pickBest([f(20, "a.ch", "other"), f(30, "b.ch")]), { ...f(30, "b.ch"), merchants: 1 });
  assert.equal(pickBest([f(26, "a.ch"), f(28.5, "b.ch"), f(30, "c.ch")])?.amount, 28.5, "Median");
  const group = pickBest([f(22.9, "a.ch"), f(22.9, "b.ch"), f(23.5, "c.ch"), f(24, "d.ch")]);
  assert.deepEqual([group?.kind, group?.amount, group?.merchants], ["exact", 22.9, 4], "22.90-Bereich (häufigster)");
  assert.deepEqual([pickBest([f(29.9, "a.ch"), f(31.5, "b.ch")])?.amount, pickBest([f(29.9, "a.ch"), f(31.5, "b.ch")])?.merchants], [31.5, 2], "zwei ähnliche: der höhere");
  assert.equal(pickBest([f(25, "a.ch"), f(27, "a.ch")])?.merchants, 1, "je Händler ein Angebot");
  // Ausreisser: Mehrheit liegt beieinander → Ausreisser fällt weg
  const outlier = pickBest([f(15.9, "globus.ch"), f(29.9, "drinks.ch"), f(30, "casadeltequila.ch")]);
  assert.deepEqual([outlier?.kind, outlier?.amount, outlier?.merchants], ["exact", 30, 2]);
  // 29.90 vs 15.90: kein stiller Treffer, Rückfrage mit beiden Preisen
  const spread = pickBest([f(29.9, "drinks.ch"), f(15.9, "globus.ch")])!;
  assert.equal(spread.kind, "other");
  assert.equal(spread.reason, "price_spread");
  assert.equal(spread.amount, 29.9);
  assert.match(spread.why!.replace(/\u00a0/g, " "), /Preise uneinheitlich, auch CHF 15\.90 \(globus\.ch\)/);
  // Modell-Treffer nie vor einem geprüften exakten
  assert.equal(pickBest([{ ...f(20.45, "coop.ch"), source: "model" }, f(22.9, "drinks.ch")])?.url, "https://www.drinks.ch/x");
  assert.equal(pickBest([{ ...f(29.95, "coop.ch"), source: "model" }])?.source, "model");
  assert.equal(pickBest([]), null);
  const note = priceNote({ merchant: "Drinks", year: null, sizeMl: 700, url: "https://www.drinks.ch/x", merchants: 3 });
  assert.match(note, /^Drinks · ohne Jahrgang · 70 cl · 3 Händler · \d{2}\.\d{2}\.\d{4} · https/);
  assert.match(priceNoteHint(note)!, /^Preis recherchiert: Drinks \(3 Händler\), \d{2}\.\d{2}\.\d{4}$/);
});

// --- Mit Stub: Modell meldet nichts, Suchergebnisse enthalten aber Schweizer Shops

const LAZ = { name: "Amaretto", producer: "Paolo Lazzaroni & Figli", type: "spirit", country: "Italien", region: null, appellation: null };
const DRINKS = "https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html";
const OTHER = "https://www.weinkeller-x.ch/lazzaroni-amaretto";
const NOTHING = { found: false, same_wine: false, product_title: "", merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "", candidate_urls: [], reason: "Suchlimit erreicht" };
const product = (name: string, price: string) => `<script type="application/ld+json">{"@type":"Product","name":"${name}","brand":{"name":"Lazzaroni"},"offers":{"price":"${price}","priceCurrency":"CHF"}}</script>`;

let blocks: unknown[] = [];
let claudeCalls = 0;
let lastBody: Record<string, unknown> = {};
const web = new Map<string, string>();
const fetched: string[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    claudeCalls++;
    lastBody = body;
    return {
      id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
      content: [...blocks, { type: "tool_use", id: "tu", name: "report_price", input: NOTHING }], usage: { input_tokens: 1, output_tokens: 1 },
    };
  },
  web: (url) => {
    fetched.push(url);
    return web.has(url) ? { body: web.get(url)!, type: url.includes(".json") ? "application/json" : "text/html" } : null;
  },
};
installNet(net);
const db = createAdminClient();

test("Eigene Prüfung ohne Modell-Zusage: .ch-Adressen aus den Suchergebnissen werden gelesen, obwohl found false", async () => {
  web.clear();
  fetched.length = 0;
  claudeCalls = 0;
  web.set(DRINKS, product("Lazzaroni Amaretto 70cl", "29.90"));
  web.set(OTHER, product("Lazzaroni Amaretto 70 cl", "31.50"));
  blocks = searchBlocks([
    { query: "Lazzaroni Amaretto 70cl", results: [{ url: "https://www.lazzaroni.it/amaretto", title: "Lazzaroni" }, { url: DRINKS, title: "Lazzaroni Amaretto 70cl" }] },
    { query: "Lazzaroni Amaretto kaufen CHF", results: [{ url: OTHER, title: "Lazzaroni Amaretto" }] },
  ]);
  const { finding, diagnostics } = await researchPrice(LAZ, null, 700, "Galaxus");
  assert.equal(claudeCalls, 1);
  assert.equal(finding.kind, "exact");
  assert.ok(finding.kind === "exact" && finding.amount === 31.5 && finding.merchants === 2, "zwei ähnliche Preise: der höhere");
  assert.deepEqual(diagnostics.queries, ["Lazzaroni Amaretto 70cl", "Lazzaroni Amaretto kaufen CHF"]);
  assert.equal(diagnostics.searches, 2);
  assert.deepEqual(diagnostics.search_results?.[0].urls, ["https://www.lazzaroni.it/amaretto", DRINKS]);
  assert.deepEqual(diagnostics.planned?.slice(0, 2), ["Lazzaroni Amaretto 70cl", "Lazzaroni Amaretto kaufen CHF"]);
  assert.equal(diagnostics.merchants, 2);
  assert.ok(diagnostics.pages.some((p) => p.url === DRINKS && p.result === "exact"));
  assert.ok(!fetched.includes("https://www.lazzaroni.it/amaretto"), "ausländische Seite nicht gelesen");
  // Alle direkten Shop-Suchen gelaufen (hier ohne Antwort: Fehler), Flaschenpost nicht für Spirituosen
  assert.deepEqual(diagnostics.direct?.map((d) => d.shop), directShopsFor("spirit").map((s) => s.id));
  assert.ok(diagnostics.direct?.every((d) => d.result === "error"));
  // Prompt mit festen Suchbegriffen; Händler nur als Hinweis
  const prompt = JSON.stringify(lastBody.messages);
  assert.match(prompt, /„Lazzaroni Amaretto 70cl“, „Lazzaroni Amaretto kaufen CHF“, „Lazzaroni Amaretto site:.ch“, „Galaxus Lazzaroni Amaretto“/);
  assert.match(prompt, /nur ein Hinweis/);
  const tools = lastBody.tools as { type?: string; max_uses?: number; user_location?: { country?: string } }[];
  const search = tools.find((t) => t.type === "web_search_20260209")!;
  assert.deepEqual([search.max_uses, search.user_location?.country], [10, "CH"]);
});

test("Direkte Shop-Suche findet den Preis; mit zwei exakten Händlern entfällt die Websuche", async () => {
  web.clear();
  claudeCalls = 0;
  blocks = [];
  web.set("https://www.drinks.ch/de/search?q=Lazzaroni+Amaretto", `<a href="https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html">Lazzaroni Amaretto 70cl</a>`);
  web.set(DRINKS, product("Lazzaroni Amaretto 70cl", "29.90"));
  web.set(
    "https://finespirits.ch/search/suggest.json?q=Lazzaroni+Amaretto&resources%5Btype%5D=product&resources%5Blimit%5D=10",
    JSON.stringify({ resources: { results: { products: [{ title: "Lazzaroni Amaretto 70cl", url: "/products/lazzaroni-amaretto-70cl?_pos=1" }] } } }),
  );
  web.set("https://finespirits.ch/products/lazzaroni-amaretto-70cl.js", JSON.stringify({ title: "Lazzaroni Amaretto 70cl", vendor: "Fine Spirits", variants: [{ title: "Default Title", price: 2990, available: true }] }));
  web.set("https://casapoli.ch/search/suggest.json?q=Lazzaroni+Amaretto&resources%5Btype%5D=product&resources%5Blimit%5D=10", JSON.stringify({ resources: { results: { products: [] } } }));
  const { finding, diagnostics } = await researchPrice(LAZ, null, 700, null);
  assert.equal(claudeCalls, 0, "keine Websuche nötig");
  assert.ok(finding.kind === "exact" && finding.amount === 29.9 && finding.merchants === 2);
  const direct = Object.fromEntries((diagnostics.direct ?? []).map((d) => [d.shop, d.result]));
  assert.deepEqual([direct["drinks.ch"], direct["finespirits.ch"], direct["casapoli.ch"], direct["napawine.ch"]], ["ok", "ok", "no_hit", "error"]);
  assert.equal(diagnostics.verdict, "exact:page");
});

test("Testlauf (dry_run): sucht, speichert nichts, sendet nichts – Ergebnis nur in result", async () => {
  web.clear();
  web.set(DRINKS, product("Lazzaroni Amaretto 70cl", "29.90"));
  blocks = searchBlocks([{ query: "Lazzaroni Amaretto 70cl", results: [{ url: DRINKS, title: "Lazzaroni Amaretto 70cl" }] }]);
  const ITEM = "cccccccc-0000-4000-8000-00000000000c";
  net.telegram = [];
  net.tables = {
    wines: [{ id: "w1", ...LAZ }],
    inventory_items: [{ id: ITEM, wine_id: "w1", vintage_year: null, bottle_size_ml: 700, quantity: 1, purchase_price: null, regular_price: null, is_gift: false, gift_from: null }],
    ingest_jobs: [],
  };
  const before = JSON.stringify(net.tables.inventory_items);
  const outcome = await runJob(db, { wine_id: "w1", kind: "price", params: { item_id: ITEM, mode: "both", dry_run: true } } as never);
  assert.equal(outcome.status, "nothing");
  assert.equal(JSON.stringify(net.tables.inventory_items), before, "Charge unverändert");
  assert.equal(net.telegram.length, 0, "nichts an Telegram");
  assert.equal(net.tables.ingest_jobs.length, 0, "keine Rückfrage");
  const diag = outcome.diagnostics as { finding: { kind: string; amount: number }; queries: string[] };
  assert.deepEqual([diag.finding.kind, diag.finding.amount], ["exact", 29.9]);
  assert.deepEqual(diag.queries, ["Lazzaroni Amaretto 70cl"]);

  // Ohne dry_run: gespeichert und gemeldet
  const saved = await runJob(db, { wine_id: "w1", kind: "price", params: { item_id: ITEM, mode: "both", chat_id: 111 } } as never);
  assert.equal(saved.status, "filled");
  assert.equal(net.tables.inventory_items[0].purchase_price, 29.9);
  assert.equal(net.telegram.filter((t) => t.method === "sendMessage").length, 1);
});

test("Shop-Treffer: Original vor Variante und anderer Grösse; Grappa ist kein Barolo-Wein", () => {
  const drinks = DIRECT_SHOPS.find((s) => s.id === "drinks.ch")!;
  const html = ["amaretto-disaronno-50cl", "disaronno-velvet-likoer-70cl", "amaretto-disaronno-70cl", "amaretto-disaronno-5cl"].map((s) => `<a href="/de/${s}.html">`).join("");
  assert.deepEqual(rankHits(htmlSearchHits(html, drinks), { name: "Disaronno", producer: "Illva Saronno", sizeMl: 700 }).map((h) => h.url), ["https://www.drinks.ch/de/amaretto-disaronno-70cl.html"]);
  const grappa = [{ url: "https://casapoli.ch/products/grappa-di-barolo", label: "Grappa di Barolo 70 cl." }, { url: "https://x.ch/p/barolo-ceretto-2021", label: "Barolo DOCG Ceretto 2021" }];
  assert.deepEqual(rankHits(grappa, { name: "Barolo", producer: "Ceretto", year: 2021, sizeMl: 750, type: "red" }).map((h) => h.url), ["https://x.ch/p/barolo-ceretto-2021"]);
});
