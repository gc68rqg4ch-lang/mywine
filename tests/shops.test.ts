// Schweizer Händler-Shops als Quelle: Adapter mit gespeicherten Beispielseiten (napawine.ch,
// bauraulacvins.ch; von moevenpick-wein.com nur noch der Seiten-Parser – kein Such-Adapter), Abgleich Wein/Jahrgang, Reihenfolge (Händler der
// Flasche zuerst), Shop nicht erreichbar → ohne Shop-Quellen weiter, Shop-Seite als Quelle im
// Recherche-Aufruf. Ohne DB, API-Schlüssel und Netz (fetch-Stub). Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine } from "@/lib/research/wine";
import { findAndStoreDrinkWindow } from "@/lib/research/drink-window";
import { SHOPS, bauraulacPage, moevenpickPage, parseDrink } from "@/lib/research/shops/adapters";
import { createGetter, findShopPages, orderShops } from "@/lib/research/shops";
import { nameMatch, pageMatches, pickCandidate, searchTerms, type ShopWine } from "@/lib/research/shops/match";
import { UNKNOWN } from "@/lib/taste/profile";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/shops/${name}`, import.meta.url), "utf8");
const MP_2023 = "https://www.moevenpick-wein.com/de/2023-condrieu-aop-cuvee-speciale-tardieu-laurent.html";
const NAPA = "https://napawine.ch/products/arador-syrah-2021";

type Row = Record<string, unknown>;
type Call = { tool: string; pages: { title: string; context: string; data: string }[]; text: string };
const calls: Call[] = [];
const requested: string[] = [];
const noMatch = { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] };
let tasteReply: () => Record<string, unknown> = () => claudeTool("report_taste_profile", noMatch);
/** Websites: Adresse → Antwort (Standard: Napa Wine und Mövenpick wie am 28.10.2026). */
let web: (url: string) => ReturnType<NonNullable<Net["web"]>> = () => null;

const shopWeb = (url: string) => {
  if (url.startsWith("https://napawine.ch/search")) return { body: fixture("napawine-search.html") };
  if (url === `${NAPA}.js`) return { body: fixture("napawine-arador-syrah-2021.json"), type: "application/json" };
  if (url === MP_2023) return { body: fixture("moevenpick-2023-condrieu.html") };
  return null;
};

const net: Net = {
  tables: {}, telegram: [], rpc: {},
  web: (url) => {
    requested.push(url);
    return web(url);
  },
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    const content = (body.messages as { content: unknown }[])[0].content;
    const blocks = Array.isArray(content) ? (content as Row[]) : [{ type: "text", text: content }];
    const pages = blocks
      .filter((b) => b.type === "document" && (b.source as Row).type === "text")
      .map((b) => ({ title: String(b.title), context: String(b.context), data: String((b.source as Row).data) }));
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
    if (tools.includes("report_taste_profile")) {
      calls.push({ tool: "taste", pages, text });
      return tasteReply();
    }
    if (tools.includes("report_drink_window")) {
      calls.push({ tool: "window", pages, text });
      return claudeTool("report_drink_window", { matches_wine: false, same_vintage: false, drink_from: 0, drink_until: 0, sources: [], quote: "", estimate_from: 0, estimate_until: 0, estimate_reason: "" });
    }
    calls.push({ tool: "wine", pages, text });
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

const W = "22222222-2222-4222-8222-222222222222";
const condrieu: ShopWine = { name: "Cuvée Spéciale", producer: "Tardieu-Laurent", year: 2023, appellation: "Condrieu AOP" };

/** Arador Syrah 2021 bei Napa Wine (Shopify) – für die Abläufe in Recherche, Profil und Trinkfenster. */
const ARADOR = { name: "Syrah", producer: "Arador", country: "Chile", region: null, appellation: null, type: "red" };

function reset(vendor: string | null = "Napa Wine", wine: Partial<Row> = ARADOR, year = 2021) {
  net.tables = {
    wines: [{ id: W, name: "Cuvée Spéciale", producer: "Tardieu-Laurent", country: "Frankreich", region: "Rhône", appellation: "Condrieu AOP", type: "white", alcohol_content: null, grapes: [], researched_at: null, ...wine }],
    vendors: vendor ? [{ id: "ven1", name: vendor }] : [],
    inventory_items: [{ wine_id: W, vintage_year: year, status: "sealed", vendor_id: vendor ? "ven1" : null }],
    wine_encounters: [], wine_vintages: [], wine_grape_shares: [], research_suggestions: [], wine_taste_profiles: [], wine_media: [],
  };
  calls.length = 0;
  requested.length = 0;
  web = shopWeb;
  tasteReply = () => claudeTool("report_taste_profile", noMatch);
}

/** Console-Ausgaben mitschreiben (error und warn). */
async function capture<T>(fn: () => Promise<T>) {
  const logged: string[] = [];
  const { error, warn } = console;
  console.error = console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    return { result: await fn(), logged };
  } finally {
    Object.assign(console, { error, warn });
  }
}

test("napawine: Suche → Produkt-URL (nur Treffer, gesuchter Jahrgang), JSON → Text", async () => {
  reset();
  const napa = SHOPS.find((s) => s.id === "napawine")!;
  const get = createGetter();
  const candidates = await napa.search({ name: "Syrah", producer: "Arador", year: 2021 }, get);
  assert.deepEqual(candidates.map((c) => [c.url, c.year]), [["https://napawine.ch/products/arador-syrah-2020", 2020], [NAPA, 2021]], "Menü-Link nicht dabei");
  assert.match(requested[0], /^https:\/\/napawine\.ch\/search\?q=Arador\+Syrah/);
  const page = await napa.read(NAPA, get);
  assert.equal(page?.title, "Arador | Syrah - 2021");
  assert.equal(page?.year, 2021);
  assert.match(page!.text, /Bouquet von luftgetrocknetem Fleisch/);
  assert.ok(!/<p>|&nbsp;/.test(page!.text), "HTML entfernt");
  // Ganzer Ablauf: nur die Seite 2021
  const pages = await findShopPages({ name: "Syrah", producer: "Arador" }, [2021], { vendors: ["Napa Wine"], shops: [napa] });
  assert.deepEqual(pages.map((p) => p.url), [NAPA]);
});

test("Mövenpick-Seite (aus der Websuche): Aromenprofil, Genussreif, Alkohol, Rebsorte; kein Such-Adapter mehr", () => {
  assert.ok(!SHOPS.some((s) => s.id === "moevenpick"), "robots.txt sperrt „?“-Adressen");
  const page = moevenpickPage(fixture("moevenpick-2023-condrieu.html"), MP_2023)!;
  assert.equal(page.title, "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent");
  assert.equal(page.year, 2023);
  assert.match(page.text, /Aromenprofil: Leuchtendes Goldgelb\. Ananas und weisser Pfirsich/);
  assert.match(page.text, /Genussreif: Jetzt bis 2035/);
  assert.ok(!page.text.includes("Zur Jahrgangstabelle"));
  assert.match(page.text, /Alkoholgehalt: 13\.5%/);
  assert.match(page.text, /Rebsorte\(n\): Viognier: 100%/);
  assert.match(page.text, /Passt zu: Raffinierten Vorspeisen/);
  assert.deepEqual(page.drink, { from: null, until: 2035 });
  assert.deepEqual(parseDrink("2026 bis 2034"), { from: 2026, until: 2034 });
  assert.equal(parseDrink("2 bis 8 Jahre"), null);
});

test("Baur au Lac Vins: Titel mit Produzent aus dem Untertitel, Beschreibung, Genussreife", () => {
  const url = "https://www.bauraulacvins.ch/de/p/rotwein/frankreich/rhone/syrah-2023-28316723.html";
  const page = bauraulacPage(fixture("bauraulac-syrah-2023.html"), url)!;
  assert.equal(page.title, "Syrah 2023 – Vin de France, Maison Stéphan, 750 ml");
  assert.equal(page.year, 2023);
  assert.match(page.text, /Beschreibung: Ein Syrah, der einen Duft/);
  assert.match(page.text, /Genussreife: 2 bis 8 Jahre/);
  assert.match(page.text, /Produzent: Maison Stéphan/);
  assert.ok(pageMatches(page, { name: "Syrah", producer: "Maison Stéphan", year: 2023 }));
  assert.ok(!pageMatches(page, { name: "Syrah", producer: "Polkura", year: 2023 }), "anderer Produzent");
});

test("Falscher Jahrgang, anderer Wein oder unklar → verworfen", () => {
  const title = "2023 Condrieu AOP Cuvée spéciale Tardieu-Laurent";
  assert.ok(pageMatches({ title, text: "" }, condrieu));
  assert.ok(!pageMatches({ title: title.replace("2023", "2022"), text: "" }, condrieu), "anderer Jahrgang");
  assert.ok(!pageMatches({ title, text: "" }, { ...condrieu, year: null }), "NV-Wein: Seite mit Jahrgang zählt nicht");
  assert.ok(pageMatches({ title: "Champagne Brut Réserve NV", text: "" }, { name: "Brut Réserve", producer: "Champagne", year: null }));
  // Zusätze, die einen anderen Wein bezeichnen
  assert.equal(nameMatch("quinta de la rosa reserva late release 2018", { name: "Quinta de la Rosa Reserva", producer: null, year: 2018 }), null);
  assert.equal(nameMatch("syrah block g i marchigue vina polkura", { name: "Syrah", producer: "Polkura", year: 2017 }), null);
  assert.equal(nameMatch("2023 hermitage aop blanc vieilles vignes tardieu laurent", { name: "Hermitage", producer: "Tardieu-Laurent", year: 2023 }), null);
  assert.ok(nameMatch("2021 hermitage aop tardieu laurent", { name: "Hermitage", producer: "Tardieu-Laurent", year: 2021 }) != null);
  // Mehrere verschiedene Weine passen gleich → unsicher → keiner
  const enemigo = ["malbec el enemigo valle de uco puerto ancona", "chardonnay el enemigo mendoza puerto ancona"].map((label) => ({ label, base: label }));
  assert.deepEqual(pickCandidate(enemigo, { name: "El Enemigo", producer: "Puerto Ancona S.A.", year: 2022 }, true), []);
  // Suchbegriffe: Produzent ohne Klammern und Rechtsform, keine doppelten Wörter
  assert.equal(searchTerms({ name: "Quinta de la Rosa Reserva", producer: "Quinta de la Rosa (Quinta da Rosa Vinhos SA)" }), "Quinta de la Rosa Reserva");
  assert.equal(searchTerms({ name: "El Enemigo", producer: "Puerto Ancona S.A." }), "Puerto Ancona El Enemigo");
});

test("Reihenfolge: zuerst der Shop des Händlers der Flasche, dann die übrigen", async () => {
  assert.deepEqual(orderShops([]).map((s) => s.id), ["napawine", "finespirits", "bauraulac"]);
  assert.deepEqual(orderShops(["Baur au Lac Vins", "Coop", "Mövenpick"]).map((s) => s.id), ["bauraulac", "napawine", "finespirits"]);
  assert.deepEqual(orderShops(["Finespirits"]).map((s) => s.id)[0], "finespirits");
  // In der Recherche: Händler aus inventory_items → Baur au Lac wird zuerst abgefragt
  reset("Baur au Lac Vins");
  await researchAndFillWine(db, W, "all", { taste: "only", year: 2021 });
  assert.match(requested[0], /^https:\/\/www\.bauraulacvins\.ch\//);
  reset("Napa Wine");
  await researchAndFillWine(db, W, "all", { taste: "only", year: 2021 });
  assert.match(requested[0], /^https:\/\/napawine\.ch\//);
  assert.ok(!requested.some((u) => u.includes("moevenpick")), "Mövenpick wird nicht direkt abgefragt");
});

test("Shop nicht erreichbar bzw. gesperrt → Recherche läuft ohne Shop-Quellen weiter, nur Log", async () => {
  reset();
  web = (url) => (url.includes("napawine") ? { status: 403, body: "Forbidden" } : null);
  const { result, logged } = await capture(() => researchAndFillWine(db, W, "all", { taste: "always", year: 2021 }));
  assert.equal(result.status, "nothing");
  assert.equal(result.taste, "none");
  assert.deepEqual(calls.map((c) => [c.tool, c.pages.length]), [["wine", 0], ["taste", 0]]);
  assert.ok(logged.some((l) => l.startsWith("shop research failed") && l.includes("HTTP 403")), logged.join("\n"));
  // Netzfehler (Zeitlimit o. ä.) → ebenso
  reset();
  web = () => {
    throw new Error("Zeitlimit");
  };
  const second = await capture(() => researchAndFillWine(db, W, "all", { taste: "only", year: 2021 }));
  assert.equal(second.result.taste, "none");
  assert.equal(calls.length, 1);
  assert.ok(second.logged.some((l) => l.startsWith("shop research failed")));
  // Wenige Abrufe pro Wein
  assert.ok(requested.length <= 12, String(requested.length));
});

test("Shop-Seite landet als Quelle (merchant) im Recherche- und im Profil-Aufruf; Beleg auf die Shop-URL", async () => {
  reset();
  tasteReply = () =>
    claudeTool("report_taste_profile", {
      matches_wine: true, same_vintage: true,
      sources: [{ url: NAPA, title: "Napa Wine", kind: "merchant", vintage: 2021 }],
      fields: { sweetness: "trocken", acidity: UNKNOWN, tannin: UNKNOWN, alcohol: UNKNOWN, body: "voll", flavour_intensity: UNKNOWN, finish: UNKNOWN },
      aromas: [], contradictions: [], style_summary: "", food_pairing: [],
      evidence: [{ field: "body", source_url: NAPA, quote: "Bouquet von luftgetrocknetem Fleisch" }, { field: "sweetness", source_url: NAPA, quote: "trocken" }],
    });
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2021 });
  for (const tool of ["wine", "taste"]) {
    const call = calls.find((c) => c.tool === tool)!;
    assert.deepEqual(call.pages.map((p) => [p.title, p.context]), [["Arador | Syrah - 2021", `Händlerseite ${NAPA}`]], tool);
    assert.ok(call.pages[0].data.length <= 4002);
    assert.ok(call.text.includes(`als Quelle mit url "${NAPA}" und kind "merchant"`), tool);
  }
  assert.equal(outcome.taste, "saved");
  const p = net.tables.wine_taste_profiles[0];
  assert.deepEqual(p.sources, [{ url: NAPA, title: "Napa Wine", kind: "merchant", vintage: 2021 }]);
  // Höchstens 3 Seiten pro Wein
  assert.ok(calls.every((c) => c.pages.length <= 3));
});

test("Trinkfenster: Shop-Seite ohne Angabe → Websuche, die Shop-Seite geht als Quelle mit", async () => {
  reset();
  await findAndStoreDrinkWindow(db, W, 2021);
  assert.deepEqual(calls.map((c) => [c.tool, c.pages.length]), [["window", 1]]);
  assert.ok(calls[0].text.includes(`url "${NAPA}" und kind "merchant"`));
});
