// Preissuche robuster: toleranter Namensvergleich (Riserva, Produzent mit Klammern, „70 cl.“ im
// Titel), Produzent-Varianten für die Suche, Preise direkt von Produktseiten (Shopify, schema.org,
// Magento) – auch bei Shops ohne .ch mit Schweizer Adresse – und das Protokoll der
// Verwerfungsgründe. Fall „Casa Grappa Acquastilla 36 mesi“ ohne Netz (Shopify-Antwort nachgebildet).
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  distinctiveWords,
  offerFromHtml,
  offerFromShopify,
  producerVariants,
  sameProduct,
  shopifyDataUrl,
  sizeFromText,
  yearFromText,
} from "@/lib/research/price-match";
import { evaluatePrice, researchPrice, type PriceRaw } from "@/lib/research/price";
import { runJob } from "@/lib/research/jobs";

const ACQUA = { name: "Acquastilla Riserva 36 Mesi", producer: "Distilleria Giovannipoli (Casa Grappa)" };
const ACQUA_URL = "https://casapoli.ch/products/casa-grappa-acquastilla-36-mesi-70-cl";
const shopify = (title: string, cents: number, compare: number | null = null) =>
  JSON.stringify({ title, vendor: "Giovanni Poli", variants: [{ title: "Default Title", price: cents, compare_at_price: compare, available: true }] });

test("Namensvergleich: Riserva, Produzent mit Klammern, „70 cl.“ im Titel → gleich; anderes Alter → nicht", () => {
  assert.deepEqual(distinctiveWords(ACQUA.name, ACQUA.producer), ["acquastilla"]);
  assert.deepEqual(sameProduct(ACQUA, "Casa Grappa Acquastilla 36 mesi 70 cl.", "Giovanni Poli"), { same: true });
  assert.deepEqual(sameProduct(ACQUA, "CASA GRAPPA ACQUASTILLA 36 MESI"), { same: true }, "Gross-/Kleinschreibung");
  assert.deepEqual(sameProduct(ACQUA, "Acqua Stilla 36 Mesi Riserva"), { same: true }, "getrennt geschrieben");
  assert.deepEqual(sameProduct(ACQUA, "Casa Grappa Acquastilla 18 mesi 70 cl."), { same: false, reason: "age_differs" });
  assert.deepEqual(sameProduct(ACQUA, "Casa Grappa Acquastilla 70 cl."), { same: false, reason: "age_differs" }, "Alter fehlt im Angebot");
  assert.deepEqual(sameProduct(ACQUA, "Casa Grappa Moscato 36 mesi"), { same: false, reason: "missing_words" });
  assert.deepEqual(sameProduct({ name: "Pintia", producer: "Vega Sicilia", year: 2019 }, "Pintia 2018 Vega Sicilia 75cl"), { same: false, reason: "year_differs" });
  assert.deepEqual(sameProduct({ name: "Pintia", producer: "Vega Sicilia", year: 2019 }, "Bodegas Pintia Toro 2019"), { same: true });
  assert.deepEqual(sameProduct({ name: "Lagavulin 16", producer: "Lagavulin" }, "Lagavulin 16 Years Islay Single Malt 70cl"), { same: true });
  assert.deepEqual(sameProduct({ name: "Lagavulin 16 Years", producer: "Lagavulin" }, "Lagavulin 8 Years"), { same: false, reason: "age_differs" });
  // Name nur aus Zusätzen: dann zählt der Produzent
  assert.deepEqual(sameProduct({ name: "Grappa Riserva", producer: "Nonino" }, "Nonino Grappa Riserva 70 cl"), { same: true });
  assert.deepEqual(sameProduct({ name: "Grappa Riserva", producer: "Nonino" }, "Berta Grappa Riserva"), { same: false, reason: "missing_words" });
  assert.deepEqual(sameProduct(ACQUA, ""), { same: false, reason: "no_title" });
});

test("Produzent-Varianten für die Suche; Grösse und Jahrgang aus dem Titel", () => {
  assert.deepEqual(producerVariants(ACQUA.producer), ["Distilleria Giovannipoli (Casa Grappa)", "Distilleria Giovannipoli", "Giovannipoli", "Casa Grappa"]);
  assert.deepEqual(producerVariants("Weingut Gantenbein AG"), ["Weingut Gantenbein AG", "Gantenbein"]);
  assert.deepEqual(producerVariants(null), []);
  assert.deepEqual(["70 cl.", "0,7 l", "700 ml", "1.5 L", "Magnum 150cl", "ohne"].map(sizeFromText), [700, 700, 700, 1500, 1500, null]);
  assert.deepEqual(["Pintia 2019", "Tawny 10 Years", "1998 – 2003"].map(yearFromText), [2019, null, null]);
  assert.equal(shopifyDataUrl(ACQUA_URL), "https://casapoli.ch/products/casa-grappa-acquastilla-36-mesi-70-cl.js");
  assert.equal(shopifyDataUrl("https://casapoli.ch/collections/grappa/products/acquastilla?variant=1"), "https://casapoli.ch/collections/grappa/products/acquastilla.js");
  assert.equal(shopifyDataUrl("https://www.moevenpick-wein.com/de/2019-pintia.html"), null);
});

test("Preise direkt aus Produktseiten: Shopify (.js/.json), schema.org, Magento", () => {
  assert.deepEqual(offerFromShopify(JSON.parse(shopify("Casa Grappa Acquastilla 36 mesi 70 cl.", 7300))), {
    title: "Casa Grappa Acquastilla 36 mesi 70 cl.", vendor: "Giovanni Poli", price: 73, regular: null, currency: "CHF", sizeMl: 700, swiss: false,
  });
  const promo = offerFromShopify(JSON.parse(shopify("X 70cl", 4900, 6600)));
  assert.deepEqual([promo?.price, promo?.regular], [49, 66]);
  assert.equal(offerFromShopify({ title: "X", variants: [{ price: "73.00" }] })?.price, 73, ".json: Franken als Text");
  const ld = `<html><head><meta property="og:title" content="Pintia 2019 75 cl"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Pintia 2019","offers":{"@type":"Offer","price":"66.00","priceCurrency":"CHF"}}</script></head><body>Weinhandel AG, CH-8001 Zürich</body></html>`;
  assert.deepEqual(offerFromHtml(ld), { title: "Pintia 2019", vendor: null, price: 66, regular: null, currency: "CHF", sizeMl: null, swiss: true });
  const eur = `<script type="application/ld+json">{"@type":"Product","name":"Pintia 2019","offers":[{"@type":"Offer","price":59,"priceCurrency":"EUR"}]}</script>`;
  assert.equal(offerFromHtml(eur)?.currency, "EUR");
  const magento = `<title>Pintia 2019</title><span data-price-amount="49" data-price-type="finalPrice"></span><span data-price-amount="66" data-price-type="oldPrice"></span> CHF`;
  assert.deepEqual([offerFromHtml(magento)?.price, offerFromHtml(magento)?.regular], [49, 66]);
  assert.equal(offerFromHtml("<p>nichts</p>"), null);
});

test("Antwort des Modells: tolerant beim Namen (Titel), Verwerfungsgründe", () => {
  const raw = (o: Partial<PriceRaw> = {}): PriceRaw => ({
    found: true, same_wine: false, product_title: "Casa Grappa Acquastilla 36 mesi 70 cl.", merchant: "Casa Poli", url: ACQUA_URL, currency: "CHF",
    price: 73, regular_price: 0, vintage: 0, size_ml: 700, quote: "CHF 73.00", candidate_urls: [], reason: "", ...o,
  });
  const want = { year: null, sizeMl: 700, type: "spirit", ...ACQUA };
  const f = evaluatePrice(raw(), want);
  assert.ok(f.kind === "exact" && f.amount === 73 && f.sizeMl === 700, "Modell zu streng – Titelvergleich entscheidet");
  assert.deepEqual(evaluatePrice(raw({ found: false }), want), { kind: "none", reason: "not_found" });
  assert.deepEqual(evaluatePrice(raw({ product_title: "Acquastilla 18 mesi" }), want), { kind: "none", reason: "not_same_wine" });
  assert.deepEqual(evaluatePrice(raw({ currency: "EUR" }), want), { kind: "none", reason: "not_chf" });
  assert.deepEqual(evaluatePrice(raw({ url: "https://www.grappa-shop.it/acquastilla" }), want), { kind: "none", reason: "not_swiss" });
  assert.deepEqual(evaluatePrice(raw({ quote: "" }), want), { kind: "none", reason: "no_quote" });
});

// --- Mit Stub: Websuche (Claude) und Produktseiten (Netz nachgebildet)

let answer: Record<string, unknown> = {};
let prompt = "";
const web = new Map<string, string>();
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    prompt = JSON.stringify(body.messages);
    return claudeTool("report_price", answer);
  },
  web: (url) => (web.has(url) ? { body: web.get(url)!, type: url.endsWith(".js") ? "application/json" : "text/html" } : null),
};
installNet(net);
const db = createAdminClient();
const SPIRIT = { name: ACQUA.name, producer: ACQUA.producer, type: "spirit", country: "Italien", region: null, appellation: null };
const NOTHING = { found: false, same_wine: false, product_title: "", merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "", candidate_urls: [], reason: "Kein Shop gefunden" };

test("Fall Acquastilla: Modell findet nur die Adresse – Shopify-Daten → exact CHF 73.00, 70 cl", async () => {
  web.clear();
  web.set(`${ACQUA_URL}.js`, shopify("Casa Grappa Acquastilla 36 mesi 70 cl.", 7300));
  answer = { ...NOTHING, candidate_urls: [ACQUA_URL], reason: "Name passt nicht genau (36 mesi ohne Riserva)" };
  const { finding, diagnostics } = await researchPrice(SPIRIT, null, 700, "Casa Poli");
  assert.deepEqual(finding, { kind: "exact", amount: 73, merchant: "Casapoli", url: ACQUA_URL, year: null, sizeMl: 700 });
  assert.equal(diagnostics.verdict, "exact:page");
  assert.deepEqual(diagnostics.pages, [{ url: ACQUA_URL, result: "exact" }]);
  assert.equal(diagnostics.raw?.reason, "Name passt nicht genau (36 mesi ohne Riserva)");
  // Suchanfragen: Händler + Name, Name, Name + Produzent-Varianten
  assert.match(prompt, /„Casa Poli Acquastilla Riserva 36 Mesi“, „Acquastilla Riserva 36 Mesi“, „Acquastilla Riserva 36 Mesi Distilleria Giovannipoli“/);
  assert.match(prompt, /Casa Grappa/);
});

test("Geprüfte Seiten mit Grund protokolliert: anderes Alter, Euro, Ausland, kein Preis", async () => {
  web.clear();
  const other = "https://casapoli.ch/products/casa-grappa-acquastilla-18-mesi";
  const eur = "https://www.grappa-shop.it/products/acquastilla-36";
  const swissCom = "https://www.vini-ticino.com/acquastilla-36.html";
  const empty = "https://www.weinshop.ch/acquastilla";
  web.set(`${other}.js`, shopify("Casa Grappa Acquastilla 18 mesi 70 cl.", 5500));
  web.set(`${eur}.js`, JSON.stringify({ title: "Acquastilla 36 mesi", variants: [{ price: 6900 }] }));
  web.set(eur, "<p>Prezzi in EUR, spedizione in Italia</p>");
  web.set(swissCom, `<script type="application/ld+json">{"@type":"Product","name":"Acquastilla 36 mesi 70cl","offers":{"price":"75.00","priceCurrency":"CHF"}}</script> Vini Ticino SA, CH-6900 Lugano`);
  answer = { ...NOTHING, candidate_urls: [other, eur, empty, swissCom] };
  const { finding, diagnostics } = await researchPrice(SPIRIT, null, 700, null);
  assert.ok(finding.kind === "exact" && finding.amount === 75, "Shop ohne .ch mit Schweizer Adresse und CHF zählt");
  assert.deepEqual(diagnostics.pages, [
    { url: other, result: "not_same_wine:age_differs" },
    { url: eur, result: "not_swiss" },
    { url: empty, result: "no_price" },
    { url: swissCom, result: "exact" },
  ]);

  web.clear();
  answer = { ...NOTHING, reason: "Nichts gefunden" };
  const none = await researchPrice(SPIRIT, null, 700, null);
  assert.deepEqual([none.finding.kind, none.diagnostics.verdict], ["none", "not_found"]);
});

test("Diagnose landet im Ergebnis des Auftrags „price“ (research_jobs.result)", async () => {
  web.clear();
  answer = { ...NOTHING, reason: "Nichts gefunden" };
  net.tables = {
    wines: [{ id: "w1", ...SPIRIT }],
    inventory_items: [{ id: "bbbbbbbb-0000-4000-8000-00000000000b", wine_id: "w1", vintage_year: null, bottle_size_ml: 700, quantity: 1, purchase_price: null, regular_price: null, is_gift: false, gift_from: null }],
    ingest_jobs: [],
  };
  const outcome = await runJob(db, { wine_id: "w1", kind: "price", params: { item_id: "bbbbbbbb-0000-4000-8000-00000000000b", mode: "both", chat_id: 111 } } as never);
  const diag = outcome.diagnostics as { verdict: string; raw: Record<string, unknown> };
  assert.equal(diag.verdict, "not_found");
  assert.deepEqual(Object.keys(diag.raw).sort(), ["currency", "found", "merchant", "price", "product_title", "reason", "regular_price", "same_wine", "size_ml", "url", "vintage"]);
  assert.ok(!("quote" in diag.raw), "keine ganzen Texte");
});
