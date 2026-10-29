// Preissuche – Seitenprüfung: nur echte Produktseiten (genau ein Produkt, eigener Produktname),
// Gattungsnamen nur mit Marke (Globus-Fall), Preise aus WooCommerce, PrestaShop, Meta-Angaben und
// JSON-LD in @graph bzw. als Liste, ausverkauft mit Vermerk, Modellpreis nur als Rückfall.
// Nachgebildete Seiten, ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { amountInText, productPage, sameProduct } from "@/lib/research/price-match";
import { modelFinding, priceNote, researchPrice, type PriceRaw } from "@/lib/research/price";

const LAZ = { name: "Amaretto", producer: "Paolo Lazzaroni & Figli" };
const PISCO = { name: "Premium Pisco", producer: "Capel" };
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const offer = (price: string, extra: Record<string, unknown> = {}) => ({ "@type": "Offer", price, priceCurrency: "CHF", ...extra });

test("Globus-Fall: Marken-/Listenseite mit mehreren Produkten → listing; Eigenmarke-Amaretto ist nicht Lazzaroni", () => {
  // Listen- bzw. Markenseite: ItemList mit mehreren Produkten
  const brandPage = ld({ "@context": "https://schema.org", "@type": "ItemList", itemListElement: [
    { "@type": "ListItem", position: 1, item: { "@type": "Product", name: "Amaretto", brand: { name: "Globus" }, offers: offer("15.90") } },
    { "@type": "ListItem", position: 2, item: { "@type": "Product", name: "Limoncello", brand: { name: "Globus" }, offers: offer("19.90") } },
  ] });
  assert.deepEqual(productPage(brandPage), { kind: "listing", reason: "several_products" });
  // @graph mit mehreren Produkten
  assert.equal(productPage(ld({ "@graph": [{ "@type": "Product", name: "A", offers: offer("1") }, { "@type": "Product", name: "B", offers: offer("2") }] })).kind, "listing");
  // ItemList mit nur Links (ohne Produkte) → Liste
  assert.equal(productPage(ld({ "@type": "CollectionPage", name: "Liköre" })).kind, "listing");
  // Mehrere Microdata-Produkte (Kacheln)
  assert.equal(productPage('<div itemtype="https://schema.org/Product"></div><div itemtype="https://schema.org/Product"></div>').kind, "listing");
  // Mehrere Magento-Preise ohne Produktbereich (Kategorieseite)
  assert.equal(productPage('<span data-price-amount="15.9" data-price-type="finalPrice"></span><span data-price-amount="19.9" data-price-type="finalPrice"></span> CHF').kind, "listing");
  // Produkt ohne eigenen Namen → kein Treffer
  assert.deepEqual(productPage(ld({ "@type": "Product", offers: offer("15.90") })), { kind: "listing", reason: "no_product_name" });

  // Einzelne Produktseite der Eigenmarke: Name „Amaretto“, Marke Globus → nicht Lazzaroni
  const own = productPage(ld({ "@type": "Product", name: "Amaretto Liquor 70cl", brand: { name: "Globus" }, offers: offer("15.90") }));
  assert.equal(own.kind, "product");
  assert.deepEqual(sameProduct(LAZ, own.kind === "product" ? own.offer.title : "", own.kind === "product" ? own.offer.vendor : null), { same: false, reason: "missing_words" });
  assert.deepEqual(sameProduct(LAZ, "Amaretto", "ILLVA Saronno"), { same: false, reason: "missing_words" });
  assert.deepEqual(sameProduct(LAZ, "Lazzaroni Amaretto 70cl"), { same: true });
  assert.deepEqual(sameProduct(LAZ, "Amaretto 70cl", "Lazzaroni"), { same: true }, "Marke im Markenfeld genügt");
  // Andere Variante (Reservado): nicht exakt
  const reservado = sameProduct(PISCO, "Pisco Capel Premium Reservado 70cl");
  assert.ok(reservado.same === false || reservado.mismatch, "Reservado ist kein exakter Treffer");
  assert.deepEqual(sameProduct(PISCO, "Pisco Reservado 70cl", "Globus"), { same: false, reason: "missing_words" }, "ohne Marke Capel");
  assert.deepEqual(sameProduct(PISCO, "Capel Premium Pisco 40% 70cl"), { same: true });
});

test("Preise lesen: WooCommerce (auch Aktion), PrestaShop, Meta-Angaben, Microdata, JSON-LD in @graph und als Liste", () => {
  const woo = `<h1 class="product_title entry-title">Pisco Capel Premium 70cl</h1><p class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">CHF</span>&nbsp;34.90</bdi></span></p><h2 class="woocommerce-loop-product__title">Andere</h2>`;
  const w = productPage(woo);
  assert.ok(w.kind === "product");
  assert.deepEqual([w.offer.title, w.offer.price, w.offer.currency, w.offer.sizeMl], ["Pisco Capel Premium 70cl", 34.9, "CHF", 700]);
  const wooSale = `<h1 class="product_title">Pisco Capel</h1><p class="price"><del><span class="woocommerce-Price-amount">CHF&nbsp;39.00</span></del> <ins><span class="woocommerce-Price-amount">CHF&nbsp;34.90</span></ins></p><p class="stock out-of-stock">Nicht vorrätig</p>`;
  const ws = productPage(wooSale);
  assert.ok(ws.kind === "product");
  assert.deepEqual([ws.offer.price, ws.offer.regular, ws.offer.soldOut], [34.9, 39, true]);
  // beerworld.ch-Art: CHF und Betrag in eigenen Spans
  const beer = `<h1 class="product_title entry-title elementor-heading-title">Pisco Capel</h1><p class="price"><span class="chf">CHF</span><span class="pricebox"><span class="pricenet"> 36.00</span><span class='price-tva'>  inkl. MWST</span></span></p>`;
  const b = productPage(beer);
  assert.ok(b.kind === "product" && b.offer.price === 36 && b.offer.currency === "CHF");
  assert.equal(productPage(`<h1 class="product_title">A</h1><h1 class="product_title">B</h1>`).kind, "listing");

  const presta = `<script>var prestashop = {}</script><h1 class="h1" itemprop="name">Liqueur - Amaretto Lazzaroni / 70cl / 24%</h1><div class="product-prices"><span class="regular-price">CHF 32.00</span><span class="current-price-value" content="30">CHF 30.00</span></div><span id="product-availability">Auf Lager</span> CHF`;
  const p = productPage(presta);
  assert.ok(p.kind === "product");
  assert.deepEqual([p.offer.title, p.offer.price, p.offer.regular, p.offer.sizeMl, p.offer.soldOut], ["Liqueur - Amaretto Lazzaroni / 70cl / 24%", 30, 32, 700, undefined]);

  const meta = `<meta property="og:title" content="Lazzaroni Amaretto 70cl"><meta property="product:price:amount" content="29.90"><meta property="product:price:currency" content="CHF"><meta property="product:availability" content="out of stock">`;
  const m = productPage(meta);
  assert.ok(m.kind === "product");
  assert.deepEqual([m.offer.title, m.offer.price, m.offer.currency, m.offer.soldOut], ["Lazzaroni Amaretto 70cl", 29.9, "CHF", true]);
  const og = productPage(`<meta property="og:title" content="X 70cl"><meta property="og:price:amount" content="12.50"><meta property="og:price:currency" content="CHF">`);
  assert.ok(og.kind === "product" && og.offer.price === 12.5);

  const micro = `<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Disaronno Originale 70cl</h1><meta itemprop="price" content="22.90"><meta itemprop="priceCurrency" content="CHF"><link itemprop="availability" href="https://schema.org/InStock"></div>`;
  const mi = productPage(micro);
  assert.ok(mi.kind === "product" && mi.offer.title === "Disaronno Originale 70cl" && mi.offer.price === 22.9 && !mi.offer.soldOut);

  // Brotkrumen mit itemprop name vor dem Produkt (Baur au Lac, Piemont-Weine): Name aus dem Product
  const crumbs = `<ol itemscope itemtype="http://schema.org/BreadcrumbList"><li itemtype="http://schema.org/ListItem"><span itemprop="name">Startseite</span></li></ol><h1 class="t show-for-small-only">Ch&acirc;teau X 2018</h1><h1 class="t show-for-medium">Ch&acirc;teau X 2018</h1><section itemscope itemtype="http://schema.org/Product"><meta itemprop="brand" content="Ch&acirc;teau X" /><meta itemprop="name" content="Ch&acirc;teau X 2018" /><div itemprop="offers" itemscope itemtype="http://schema.org/Offer"><meta itemprop="priceCurrency" content="CHF" /><meta itemprop="price" content="398.0" /><link itemprop="availability" href="http://schema.org/InStock"></div></section>`;
  const c = productPage(crumbs);
  assert.ok(c.kind === "product");
  assert.deepEqual([c.offer.title, c.offer.vendor, c.offer.price], ["Château X 2018", "Château X", 398]);
  const nested = `<div itemScope="" itemType="https://schema.org/Product"><meta itemProp="brand" content="Paolo Marolo"/><ul itemScope="" itemType="https://schema.org/BreadcrumbList"><li itemType="https://schema.org/ListItem"><span itemProp="name">Home</span></li></ul><h1 class="product-info-title" itemProp="name">Barolo 12 Jahre</h1><meta itemProp="price" content="90"/><meta itemProp="priceCurrency" content="CHF"/></div>`;
  const n = productPage(nested);
  assert.ok(n.kind === "product");
  assert.deepEqual([n.offer.title, n.offer.vendor, n.offer.price], ["Barolo 12 Jahre", "Paolo Marolo", 90]);

  const graph = ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Shop" }, { "@type": "Product", name: "Lazzaroni Amaretto 70cl", brand: "Lazzaroni", offers: [offer("29.90", { availability: "https://schema.org/OutOfStock" })] }] });
  const g = productPage(graph);
  assert.ok(g.kind === "product");
  assert.deepEqual([g.offer.title, g.offer.vendor, g.offer.price, g.offer.soldOut], ["Lazzaroni Amaretto 70cl", "Lazzaroni", 29.9, true]);
  const list = `<script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Disaronno 70cl","offers":{"@type":"AggregateOffer","lowPrice":"22.90","priceCurrency":"CHF"}}]</script>`;
  const l = productPage(list);
  assert.ok(l.kind === "product" && l.offer.price === 22.9);

  assert.deepEqual(["CHF 34.90", "34.90 CHF", "Fr. 34.–", "CHF 1’234.50", "CHF 29,90"].map((t) => amountInText(t)?.amount), [34.9, 34.9, 34, 1234.5, 29.9]);
  assert.equal(amountInText("€ 19.90")?.currency, "EUR");
});

test("Ausverkauft: Preis gilt mit Vermerk; ohne Grösse auf der Seite kein Treffer", () => {
  const note = priceNote({ merchant: "Drinks", year: null, sizeMl: 700, url: "https://www.drinks.ch/x", soldOut: true });
  assert.match(note, /^Drinks · ohne Jahrgang · 70 cl · ausverkauft · \d\d\.\d\d\.\d{4} · https/);
  assert.match(priceNote({ merchant: "Coop", year: null, sizeMl: 700, url: "https://www.coop.ch/x", source: "model" }), / · laut Suche · /);
});

test("Modellpreis als Rückfall: nur wenn die Seite nicht lesbar war, mit Zitat und passendem Titel", () => {
  const want = { year: null, sizeMl: 700, type: "spirit", ...PISCO };
  const raw: PriceRaw = { found: true, same_wine: true, product_title: "Capel Premium Pisco 70cl", merchant: "Coop", url: "https://www.coop.ch/de/p/7042709", currency: "CHF", price: 29.95, regular_price: 0, vintage: 0, size_ml: 700, quote: "CHF 29.95", candidate_urls: [], reason: "" };
  const f = modelFinding(raw, want, [{ url: raw.url, result: "no_price" }]);
  assert.deepEqual([f?.kind, f?.amount, f?.source], ["exact", 29.95, "model"]);
  assert.deepEqual(modelFinding(raw, want, []), f, "Seite nicht geprüft: ebenso");
  assert.equal(modelFinding(raw, want, [{ url: raw.url, result: "listing:several_products" }]), null, "Listenseite → nein");
  assert.equal(modelFinding(raw, want, [{ url: raw.url, result: "not_same_wine:missing_words" }]), null);
  assert.equal(modelFinding({ ...raw, quote: "" }, want, [{ url: raw.url, result: "no_price" }]), null, "ohne Zitat");
  assert.equal(modelFinding({ ...raw, product_title: "Pisco Reservado" }, want, [{ url: raw.url, result: "no_price" }]), null, "Titel passt nicht (ohne Marke)");
  assert.equal(modelFinding({ ...raw, currency: "EUR" }, want, [{ url: raw.url, result: "no_price" }]), null);
});

// --- Ablauf mit Stub: Lazzaroni (drinks.ch 29.90) und Globus-Eigenmarke 15.90

const DRINKS = "https://www.drinks.ch/de/lazzaroni-amaretto-70cl.html";
const GLOBUS = "https://www.globus.ch/en/verglb-marken-deli-liquor-bp216286530000";
const COOP = "https://www.coop.ch/en/kiosk/spirits/pisco-capel/p/7042709";
const web = new Map<string, string>();
let answer: Record<string, unknown> = {};
let results: { url: string; title: string }[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: () => ({
    id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_sequence: null,
    content: [
      { type: "server_tool_use", id: "s0", name: "web_search", input: { query: "q" } },
      { type: "web_search_tool_result", tool_use_id: "s0", content: results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "x", page_age: null })) },
      { type: "tool_use", id: "tu", name: "report_price", input: answer },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  }),
  web: (url) => (web.has(url) ? { body: web.get(url)! } : url === COOP ? { status: 403, body: "Access denied" } : null),
};
installNet(net);
const NOTHING = { found: false, same_wine: false, product_title: "", merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "", candidate_urls: [], reason: "" };

test("Lazzaroni: Globus-Eigenmarke (15.90) zählt nicht, drinks.ch 29.90 ist der Treffer", async () => {
  web.clear();
  web.set(DRINKS, ld({ "@type": "Product", name: "Lazzaroni Amaretto 70cl", brand: { name: "Lazzaroni" }, offers: offer("29.90") }));
  web.set(GLOBUS, ld({ "@type": "Product", name: "Amaretto Liquor", brand: { name: "Globus" }, offers: offer("15.90") }));
  results = [{ url: DRINKS, title: "Lazzaroni Amaretto 70cl" }, { url: GLOBUS, title: "Amaretto Liquor | Globus" }];
  answer = NOTHING;
  const { finding, diagnostics } = await researchPrice({ ...LAZ, type: "spirit", country: null, region: null, appellation: null }, null, 700, null);
  assert.ok(finding.kind === "exact" && finding.amount === 29.9 && finding.url === DRINKS, JSON.stringify(finding));
  assert.equal(diagnostics.pages.find((p) => p.url === GLOBUS)?.result, "not_same_wine:missing_words");
});

test("Pisco Capel: Coop gesperrt (403), Modell nennt CHF 29.95 mit Zitat → Treffer „laut Suche“; Globus-Reservado nicht", async () => {
  web.clear();
  const GLOBUS_PISCO = "https://www.globus.ch/en/diff-marken-deli-grape-brandies-205222280000";
  web.set(GLOBUS_PISCO, ld({ "@type": "Product", name: "Pisco Reservado", brand: { name: "Globus" }, offers: offer("39.00", { availability: "https://schema.org/OutOfStock" }) }));
  results = [{ url: COOP, title: "Pisco Capel | coop.ch" }, { url: GLOBUS_PISCO, title: "Pisco" }];
  answer = { found: true, same_wine: true, product_title: "Capel Premium Pisco 70cl", merchant: "Coop", url: COOP, currency: "CHF", price: 29.95, regular_price: 0, vintage: 0, size_ml: 700, quote: "Pisco Capel 70cl CHF 29.95", candidate_urls: [], reason: "Coop führt Pisco Capel" };
  const { finding, diagnostics } = await researchPrice({ ...PISCO, type: "spirit", country: null, region: null, appellation: null }, null, 700, null);
  assert.ok(finding.kind === "exact" && finding.amount === 29.95 && finding.source === "model", JSON.stringify(finding));
  assert.equal(diagnostics.verdict, "exact:model");
  assert.deepEqual(diagnostics.pages.map((p) => [p.url, p.result]), [[COOP, "no_price"], [GLOBUS_PISCO, "not_same_wine:missing_words"]]);
  assert.match(priceNote(finding as never), / · laut Suche · /);
});

test("Zwei geprüfte Händler 29.90 und 15.90 → Rückfrage mit beiden Preisen statt stillem Treffer", async () => {
  web.clear();
  const OTHER = "https://www.liquori.ch/lazzaroni-amaretto";
  web.set(DRINKS, ld({ "@type": "Product", name: "Lazzaroni Amaretto 70cl", offers: offer("29.90") }));
  web.set(OTHER, ld({ "@type": "Product", name: "Lazzaroni Amaretto 70cl", offers: offer("15.90") }));
  results = [{ url: DRINKS, title: "Lazzaroni Amaretto" }, { url: OTHER, title: "Lazzaroni Amaretto" }];
  answer = NOTHING;
  const { finding, diagnostics } = await researchPrice({ ...LAZ, type: "spirit", country: null, region: null, appellation: null }, null, 700, null);
  assert.equal(finding.kind, "other");
  assert.ok(finding.kind === "other" && finding.reason === "price_spread" && finding.amount === 29.9);
  assert.match(String(finding.kind === "other" && finding.why).replace(/ /g, " "), /CHF 15\.90 \(Liquori\)/);
  assert.equal(diagnostics.verdict, "not_exact:price_spread");
});

test("JSON-LD-Name mit HTML-Zeichen („Noah&#039;s Mill“) wird dekodiert", () => {
  const r = productPage(ld({ "@type": "Product", name: "Noah&#039;s Mill Bourbon Whiskey 70cl", offers: offer("86.90") }));
  assert.ok(r.kind === "product" && r.offer.title === "Noah's Mill Bourbon Whiskey 70cl");
});
