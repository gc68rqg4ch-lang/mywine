// Mövenpick-Datenblätter (PDF): Link auf der Jahrgangsseite, Text auslesen (Trinkreife, Alkohol,
// Rebsorten), falscher Jahrgang verworfen; ohne Shop-Treffer darf Claude per web_fetch (nur
// Shop-Domains, höchstens 3 Abrufe) ein Datenblatt öffnen – sonst nicht. Gespeicherte Beispiele
// (gekürzte echte Datenblätter), ohne DB, API-Schlüssel und Netz. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine } from "@/lib/research/wine";
import { findAndStoreDrinkWindow, shopDrinkWindow } from "@/lib/research/drink-window";
import { datasheetLink, moevenpickDatasheet, SHOPS } from "@/lib/research/shops/adapters";
import { SHOP_DOMAINS, shopSourceAllowed } from "@/lib/research/shops/match";
import { MAX_SHOP_FETCHES, researchTools } from "@/lib/ingest/recognize";
import { UNKNOWN } from "@/lib/taste/profile";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/shops/${name}`, import.meta.url));
const MP_2023 = "https://www.moevenpick-wein.com/de/2023-condrieu-aop-cuvee-speciale-tardieu-laurent.html";
const SHEET_2023 = "https://www.moevenpick-wein.com/de/customization_catalog/product/pdf/product_id/96615/file/2023-condrieu-aop-cuvee-speciale-tardieu-laurent.pdf";
const SHEET_APERTURE = "https://www.moevenpick-wein.com/de/customization_catalog/product/pdf/product_id/96409/file/2020-aperture-red-alexander-valley-sonoma-county-aperture-cellars.pdf";

type Row = Record<string, unknown>;
type Call = { tool: string; tools: Row[]; text: string; pages: string[] };
const calls: Call[] = [];
const noMatch = { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] };
let tasteReply: () => Record<string, unknown> = () => claudeTool("report_taste_profile", noMatch);
let web: NonNullable<Net["web"]> = () => null;

const shopWeb: NonNullable<Net["web"]> = (url) => {
  if (url.includes("/catalogsearch/")) return { body: fixture("moevenpick-2023-condrieu.html").toString("utf8"), url: MP_2023 };
  if (url === MP_2023) return { body: fixture("moevenpick-2023-condrieu.html").toString("utf8") };
  if (url === SHEET_2023) return { body: new Uint8Array(fixture("moevenpick-datenblatt-2023-condrieu.pdf")), type: "application/pdf" };
  return null;
};

const net: Net = {
  tables: {}, telegram: [], rpc: {},
  web: (url) => web(url),
  claude: (body) => {
    const tools = (body.tools as Row[]) ?? [];
    const names = tools.map((t) => String(t.name));
    const content = (body.messages as { content: unknown }[])[0].content;
    const blocks = Array.isArray(content) ? (content as Row[]) : [{ type: "text", text: content }];
    const pages = blocks.filter((b) => b.type === "document" && (b.source as Row).type === "text").map((b) => String(b.context));
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
    if (names.includes("report_taste_profile")) {
      calls.push({ tool: "taste", tools, text, pages });
      return tasteReply();
    }
    if (names.includes("report_drink_window")) {
      calls.push({ tool: "window", tools, text, pages });
      return claudeTool("report_drink_window", { matches_wine: false, same_vintage: false, drink_from: 0, drink_until: 0, sources: [], quote: "", estimate_from: 0, estimate_until: 0, estimate_reason: "" });
    }
    calls.push({ tool: "wine", tools, text, pages });
    return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
  },
};
net.rpc.replace_grape_shares = () => [];
net.rpc.ensure_wine_vintage = (args) => {
  const rows = net.tables.wine_vintages;
  let row = rows.find((r) => r.wine_id === args.p_wine_id && r.vintage_year === (args.p_vintage_year ?? null));
  if (!row) rows.push((row = { id: `v${rows.length}`, wine_id: args.p_wine_id, vintage_year: args.p_vintage_year ?? null }));
  return row.id;
};
installNet(net);
const db = createAdminClient();
const W = "33333333-3333-4333-8333-333333333333";

function reset(year: number | null = 2023, wine: Partial<Row> = {}) {
  net.tables = {
    wines: [{ id: W, name: "Cuvée Spéciale", producer: "Tardieu-Laurent", country: "Frankreich", region: "Rhône", appellation: "Condrieu AOP", type: "white", alcohol_content: null, grapes: [], researched_at: null, ...wine }],
    vendors: [{ id: "ven1", name: "Mövenpick" }],
    inventory_items: [{ wine_id: W, vintage_year: year, status: "sealed", vendor_id: "ven1" }],
    wine_encounters: [], wine_vintages: [], wine_grape_shares: [], research_suggestions: [], wine_taste_profiles: [], wine_media: [],
  };
  calls.length = 0;
  web = shopWeb;
  tasteReply = () => claudeTool("report_taste_profile", noMatch);
}

const webFetch = (c: Call) => c.tools.find((t) => t.type === "web_fetch_20260209");

test("Datenblatt-Link auf der Jahrgangsseite; PDF-Text: Trinkreife, Alkohol, Rebsorten", () => {
  assert.equal(datasheetLink(fixture("moevenpick-2023-condrieu.html").toString("utf8")), SHEET_2023);
  const sheet = moevenpickDatasheet(new Uint8Array(fixture("moevenpick-datenblatt-2023-condrieu.pdf")), SHEET_2023, "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent")!;
  assert.equal(sheet.title, "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent – Datenblatt");
  assert.equal(sheet.year, 2023);
  assert.match(sheet.text, /Aromenprofil: Leuchtendes Goldgelb\. Ananas und weisser Pfirsich/, "Wörter mit Abständen (Blocksatz)");
  assert.match(sheet.text, /Alkoholgehalt: 13\.5%/);
  assert.match(sheet.text, /Rebsorte\(n\): 100% Viognier/);
  assert.match(sheet.text, /Trinkreife: Jetzt bis 2035/);
  assert.ok(!sheet.text.includes("Oberneuhofstr"), "ohne Firmenadresse");
  assert.deepEqual(sheet.drink, { from: null, until: 2035 });
  // Ausgelaufener Jahrgang (Seite 404): Aperture Red 2020
  const aperture = moevenpickDatasheet(new Uint8Array(fixture("moevenpick-datenblatt-2020-aperture-red.pdf")), SHEET_APERTURE, "2020 Aperture Red")!;
  assert.match(aperture.text, /Alkoholgehalt: 14\.5%/);
  assert.deepEqual(aperture.drink, { from: null, until: 2035 });
});

test("Seite und Datenblatt: Trinkfenster aus „Trinkreife“ (Parser bleiben für Seiten aus der Websuche)", () => {
  const sheet = moevenpickDatasheet(new Uint8Array(fixture("moevenpick-datenblatt-2023-condrieu.pdf")), SHEET_2023, "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent")!;
  const page = { shop: "moevenpick" as const, url: MP_2023, title: "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent", year: 2023, text: "" };
  assert.deepEqual(shopDrinkWindow([page, { ...sheet, year: 2023 }], 2023, 2026), { from: null, until: 2035, source: "research", note: "moevenpick-wein.com" });
  // Mövenpick hat keinen Such-Adapter mehr (robots.txt sperrt „?“-Adressen)
  assert.ok(!SHOPS.some((s) => s.id === "moevenpick"));
});

test("Falscher Jahrgang wird verworfen (Adresse bzw. Dateiname des Datenblatts)", async () => {
  assert.equal(shopSourceAllowed(SHEET_APERTURE, 2020), true);
  assert.equal(shopSourceAllowed(SHEET_APERTURE, 2021), false, "anderer Jahrgang im Dateinamen");
  assert.equal(shopSourceAllowed("https://www.moevenpick-wein.com/de/customization_catalog/product/pdf/product_id/96409/file/aperture-red.pdf", 2020), false, "Datenblatt ohne Jahrgang → unklar");
  assert.equal(shopSourceAllowed(SHEET_APERTURE, null), false, "Wein ohne Jahrgang");
  assert.equal(shopSourceAllowed(MP_2023, 2022), false, "Seite eines anderen Jahrgangs");
  assert.equal(shopSourceAllowed(MP_2023, 2023), true);
  assert.equal(shopSourceAllowed("https://www.decanter.com/wine-reviews/2019-something", 2023), true, "andere Websites: wie bisher");
  // Profil: Beleg aus einem Datenblatt eines anderen Jahrgangs zählt nicht → kein Profil
  reset(2021);
  web = () => null;
  const wrong = SHEET_APERTURE;
  tasteReply = () =>
    claudeTool("report_taste_profile", {
      matches_wine: true, same_vintage: true,
      sources: [{ url: wrong, title: "Datenblatt", kind: "merchant", vintage: 2021 }],
      fields: { sweetness: "trocken", acidity: UNKNOWN, tannin: UNKNOWN, alcohol: UNKNOWN, body: "voll", flavour_intensity: UNKNOWN, finish: UNKNOWN },
      aromas: [], contradictions: [], style_summary: "", food_pairing: [],
      evidence: [{ field: "body", source_url: wrong, quote: "vollmundig" }],
    });
  const outcome = await researchAndFillWine(db, W, "all", { taste: "only", year: 2021 });
  assert.equal(outcome.taste, "none");
  assert.equal(net.tables.wine_taste_profiles.length, 0);
});

test("web_fetch nur ohne Shop-Treffer, nur Shop-Domains, höchstens 3 Abrufe; Hinweis im Prompt", async () => {
  // Seite 404 (ausgelaufener Jahrgang), Suche ohne Treffer
  reset(2020, { name: "Aperture Red", producer: "Aperture Cellars", appellation: "Alexander Valley", country: "USA", type: "red" });
  web = () => null;
  await researchAndFillWine(db, W, "all", { taste: "always", year: 2020 });
  assert.deepEqual(calls.map((c) => c.tool), ["wine", "taste"]);
  for (const c of calls) {
    assert.deepEqual(webFetch(c), { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, allowed_domains: [...SHOP_DOMAINS] }, c.tool);
    assert.match(c.text, /„moevenpick-wein\.com 2020 Aperture Cellars Aperture Red pdf“/);
    assert.match(c.text, /Dateiname den Jahrgang 2020 nennt/);
  }
  // Trinkfenster ebenso
  reset(2020, { name: "Aperture Red", producer: "Aperture Cellars" });
  web = () => null;
  await findAndStoreDrinkWindow(db, W, 2020);
  assert.ok(webFetch(calls.find((c) => c.tool === "window")!));
  // Wein ohne Jahrgang: kein web_fetch (Datenblatt nicht eindeutig zuzuordnen)
  reset(null);
  web = () => null;
  await researchAndFillWine(db, W, "all", { taste: "always", year: null });
  assert.ok(calls.length > 0 && calls.every((c) => webFetch(c) === undefined));
  // Werkzeuge: Domains fest, strict-Tool unverändert
  const tools = researchTools({ toolName: "x", toolDescription: "x", inputSchema: { type: "object", properties: {}, additionalProperties: false, required: [] }, maxSearches: 4, fetchShops: true });
  assert.deepEqual(tools.map((t) => ("type" in t && t.type ? t.type : t.name)), ["web_search_20260209", "web_fetch_20260209", "x"]);
  assert.equal(MAX_SHOP_FETCHES, 3);
  assert.deepEqual([...SHOP_DOMAINS].sort(), ["bauraulacvins.ch", "finespirits.ch", "moevenpick-wein.com", "napawine.ch", "smithandsmith.ch", "ullrich.ch"]);
  assert.equal(researchTools({ toolName: "x", toolDescription: "x", inputSchema: { type: "object" }, maxSearches: 4 }).length, 2, "ohne fetchShops kein web_fetch");
});
