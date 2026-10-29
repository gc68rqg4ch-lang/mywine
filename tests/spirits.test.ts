// Spirituosen als weitere Art: Art-Filter und Kategorie-Filter (zwei Ebenen, nur vorhandene, mit
// Anzahl), kein Trinkfenster und keine Offen-Warnungen, Recherche legt keine Kategorien an, Profil
// ohne Säure/Tannin, Startseite mit Zeile „Spirituose“, Bot: Rückfrage „Wein oder Spirituose?“ und
// Vorschlag einer neuen Kategorie (angelegt erst nach Bestätigung). Ohne DB, API-Schlüssel und Netz.
// Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyTypeFilter, listHref, readListState } from "@/lib/cellar/list-params";
import { BASE_GROUPINGS, drinkBadges, drinkCounts, groupWines, type CellarWine, type GroupUnit } from "@/lib/cellar/overview";
import { openTotals, type OpenEntry } from "@/lib/cellar/lists";
import { searchText } from "@/lib/cellar/search";
import { applySpiritFilter, categoryChips, spiritMeta, withSpiritTags } from "@/lib/spirits/tag";
import { categoryLabel, categoryPath, matchCategory, type SpiritCategory } from "@/lib/spirits/categories";
import { draftFromLabel, planCategory } from "@/lib/spirits/draft";
import { spiritFindings, type SpiritResearchRaw } from "@/lib/spirits/research";
import { researchAndFillSpirit } from "@/lib/research/spirit";
import { findAndStoreDrinkWindow } from "@/lib/research/drink-window";
import { windowTargets, wineGaps } from "@/lib/research/gaps";
import { toRow, validateTasteProfile, UNKNOWN, type TasteResearchRaw } from "@/lib/taste/profile";
import { drunkByType, readiness, stockTotals, stockUnits, type StockItem } from "@/lib/home/summary";
import { noteContext } from "@/lib/home/compose";
import { wineDetailsText } from "@/lib/chat/details";
import { openBottleLine, typeEmoji } from "@/lib/chat/menu-view";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { nextPurchaseStep, saveJob } from "@/lib/ingest/flow";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import { callbackData } from "@/lib/ingest/messages";
import { needsVintage, type IngestState } from "@/lib/ingest/schema";

// Kategorien wie die Startliste (Ausschnitt).
const CATS: SpiritCategory[] = [
  { id: "c-whisky", parentId: null, name: "Whisky", sortOrder: 10 },
  { id: "c-scotch", parentId: "c-whisky", name: "Scotch Single Malt", sortOrder: 10 },
  { id: "c-bourbon", parentId: "c-whisky", name: "Bourbon", sortOrder: 30 },
  { id: "c-likoer", parentId: null, name: "Likör", sortOrder: 20 },
  { id: "c-nuss", parentId: "c-likoer", name: "Nuss", sortOrder: 30 },
  { id: "c-obst", parentId: null, name: "Obstbrand", sortOrder: 40 },
  { id: "c-kirsch", parentId: "c-obst", name: "Kirsch", sortOrder: 10 },
  { id: "c-calva", parentId: "c-obst", name: "Apfel / Calvados", sortOrder: 40 },
  { id: "c-rum", parentId: null, name: "Rum", sortOrder: 70 },
  { id: "c-tequila", parentId: null, name: "Tequila / Mezcal", sortOrder: 100 },
  { id: "c-andere", parentId: null, name: "Andere", sortOrder: 200 },
];

const unit = (vintage_year: number | null, count: number, x: Partial<GroupUnit> = {}): GroupUnit => ({ vintage_year, price_class: null, count, ...x });
type E = CellarWine & { id: string };
const wine = (id: string, x: Partial<E>, units: GroupUnit[]): E =>
  ({
    id,
    wine_id: id,
    name: id,
    producer: "P",
    country: null,
    region: null,
    type: "red",
    grapes: [],
    vintages: [...new Set(units.map((u) => u.vintage_year))],
    units,
    sealed: units.reduce((n, u) => n + u.count, 0),
    open: 0,
    rows: [],
    ...x,
  }) as E;

const spirits = {
  categories: CATS,
  fields: new Map([
    ["woodford", { categoryId: "c-bourbon", ageYears: null, cask: "New American Oak", distilledYear: null, bottledYear: null }],
    ["lagavulin", { categoryId: "c-scotch", ageYears: 16, cask: null, distilledYear: null, bottledYear: null }],
    ["kirsch", { categoryId: "c-kirsch", ageYears: null, cask: null, distilledYear: 2015, bottledYear: 2020 }],
    ["frangelico", { categoryId: "c-nuss", ageYears: null, cask: null, distilledYear: null, bottledYear: null }],
  ]),
};
const ENTRIES = withSpiritTags(
  [
    wine("pintia", { type: "red", grapes: ["Tinta de Toro"] }, [unit(2019, 6, { drink_from_year: 2020, drink_until_year: 2024 })]),
    wine("woodford", { type: "spirit" }, [unit(null, 2)]),
    wine("lagavulin", { type: "spirit" }, [unit(null, 1)]),
    wine("kirsch", { type: "spirit" }, [unit(null, 3)]),
    wine("frangelico", { type: "spirit" }, [unit(null, 1)]),
    wine("ohne", { type: "spirit" }, [unit(null, 1)]),
  ],
  (e) => e.wine_id,
  spirits,
);

test("Art-Filter: „Spirituose“ in der Bestandsliste, Kategorie in der URL (zwei Ebenen)", () => {
  const state = readListState({ typ: "spirit", kat: "c-whisky", ukat: "c-bourbon" }, BASE_GROUPINGS);
  assert.equal(state.type, "spirit");
  assert.deepEqual(state.spirit, { main: "c-whisky", sub: "c-bourbon" });
  // Hin und zurück (Filter bleibt beim Zurückkehren erhalten).
  const href = listHref("/bestand", state);
  assert.equal(href, "/bestand?typ=spirit&kat=c-whisky&ukat=c-bourbon");
  // Unterkategorie ohne Hauptkategorie gilt nicht.
  assert.deepEqual(readListState({ typ: "spirit", ukat: "c-bourbon" }, BASE_GROUPINGS).spirit, { main: null, sub: null });
  // „Alle“ (Hauptkategorie zurück) entfernt auch die Unterkategorie.
  assert.equal(listHref("/bestand", state, { spirit: { main: null, sub: null } }), "/bestand?typ=spirit");

  const shown = applyTypeFilter(ENTRIES, "spirit");
  assert.deepEqual(shown.map((e) => e.wine_id), ["woodford", "lagavulin", "kirsch", "frangelico", "ohne"]);
  assert.deepEqual(applyTypeFilter(ENTRIES, "red").map((e) => e.wine_id), ["pintia"]);
});

test("Kategorie-Filter: nur vorhandene Hauptkategorien mit Anzahl; Unterkategorien erst nach Wahl", () => {
  const spiritsOnly = applyTypeFilter(ENTRIES, "spirit");
  const bottles = (e: E) => e.units.reduce((n, u) => n + u.count, 0);
  const none = categoryChips(spiritsOnly, CATS, { main: null, sub: null }, (e) => e.wine_id, bottles);
  // Rum und Tequila kommen nicht vor → keine Chips; Reihenfolge wie sort_order.
  assert.deepEqual(none.mains.map((c) => [c.name, c.parts.reduce((n, [, k]) => n + k, 0)]), [["Whisky", 3], ["Likör", 1], ["Obstbrand", 3]]);
  assert.deepEqual(none.subs, []);

  const whisky = categoryChips(spiritsOnly, CATS, { main: "c-whisky", sub: null }, (e) => e.wine_id, bottles);
  assert.deepEqual(whisky.subs.map((c) => [c.name, c.parts.reduce((n, [, k]) => n + k, 0)]), [["Scotch Single Malt", 1], ["Bourbon", 2]]);
  assert.deepEqual(applySpiritFilter(spiritsOnly, { main: "c-whisky", sub: null }).map((e) => e.wine_id), ["woodford", "lagavulin"]);
  assert.deepEqual(applySpiritFilter(spiritsOnly, { main: "c-whisky", sub: "c-bourbon" }).map((e) => e.wine_id), ["woodford"]);
  // Hauptkategorie ohne vorhandene Unterkategorien (Calvados fehlt im Bestand): nur Kirsch.
  const obst = categoryChips(spiritsOnly, CATS, { main: "c-obst", sub: null }, (e) => e.wine_id, bottles);
  assert.deepEqual(obst.subs.map((c) => c.name), ["Kirsch"]);
  // Ohne Auswahl alle (auch ohne Kategorie).
  assert.equal(applySpiritFilter(spiritsOnly, { main: null, sub: null }).length, 5);
});

test("Liste: Kategorie und Alter auf der Karte, Suche findet Kategorie und Fass; Rebsorte ohne Spirituosen", () => {
  const lagavulin = ENTRIES.find((e) => e.wine_id === "lagavulin")!;
  assert.deepEqual(spiritMeta(lagavulin), ["Whisky › Scotch Single Malt", "16 Jahre"]);
  assert.deepEqual(spiritMeta(ENTRIES[0]), [], "Wein: nichts");
  const woodford = ENTRIES.find((e) => e.wine_id === "woodford")!;
  assert.match(searchText(woodford), /whisky bourbon/);
  assert.match(searchText(woodford), /new american oak/);
  // Übersicht nach Rebsorte: Spirituosen weglassen; nach Art: eigene Gruppe „Spirituose“.
  assert.deepEqual(groupWines(ENTRIES, "rebsorte").flatMap((g) => g.items.map((i) => i.wine.wine_id)), ["pintia"]);
  assert.deepEqual(groupWines(ENTRIES, "typ").map((g) => [g.label, g.bottles]), [["Rot", 6], ["Spirituose", 8]]);
  // Trinkreife nur Wein.
  assert.deepEqual(groupWines(ENTRIES, "trinkreife", 2026).flatMap((g) => g.items.map((i) => i.wine.wine_id)), ["pintia"]);
  assert.deepEqual(drinkBadges(woodford, [null], 2026), []);
  const counts = drinkCounts([
    wine("w", { type: "red", rows: [{ drink_status: "overdue", sealed: 2 }] as never }, []),
    wine("s", { type: "spirit", rows: [{ drink_status: "unknown", sealed: 5 }] as never }, []),
  ]);
  assert.deepEqual([counts.overdue, counts.unknown], [2, 0]);
});

test("Kategorien: Pfad, Bezeichnung und Zuordnung erkannter Namen", () => {
  assert.equal(categoryLabel(categoryPath(CATS, "c-bourbon")), "Whisky › Bourbon");
  assert.equal(categoryLabel(categoryPath(CATS, "c-rum")), "Rum");
  assert.equal(matchCategory(CATS, "whisky", "bourbon").category?.id, "c-bourbon");
  assert.equal(matchCategory(CATS, null, "Bourbon").category?.id, "c-bourbon", "nur Unterkategorie erkannt");
  assert.equal(matchCategory(CATS, "Calvados", "").category?.id, "c-calva", "Teil von „Apfel / Calvados“");
  assert.equal(matchCategory(CATS, "Mezcal", "").category?.id, "c-tequila");
  assert.deepEqual(matchCategory(CATS, "Whisky", "Rye").missingSub, "Rye");
  assert.deepEqual(matchCategory(CATS, "Sake", "").missingMain, "Sake");
});

test("Bot-Plan: nur bestehende Kategorien – Unterkategorie, sonst Hauptkategorie ohne Rückfrage, sonst Auswahl, ganz unklar „Andere“", () => {
  const label = { kind: "spirit" as const, category: "Whisky", subcategory: "Bourbon", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 };
  const ok = planCategory(CATS, draftFromLabel(label));
  assert.deepEqual([ok.categoryId, ok.label, ok.done], ["c-bourbon", "Whisky › Bourbon", true]);
  // Unbekannte Unterkategorie → Hauptkategorie, fertig (nichts vorgeschlagen)
  const rye = planCategory(CATS, draftFromLabel({ ...label, subcategory: "Rye", age_years: 7 }));
  assert.deepEqual([rye.categoryId, rye.label, rye.done, rye.ageYears], ["c-whisky", "Whisky", true, 7]);
  assert.ok(!("newCategory" in rye), "kein Vorschlag zum Anlegen");
  const nosiola = planCategory(CATS, draftFromLabel({ ...label, category: "Obstbrand", subcategory: "Monovitigno Nosiola" }));
  assert.deepEqual([nosiola.categoryId, nosiola.done], ["c-obst", true]);
  // Unbekannte Hauptkategorie → Auswahl der bestehenden
  const sake = planCategory(CATS, draftFromLabel({ ...label, category: "Sake", subcategory: "" }));
  assert.deepEqual([sake.categoryId, sake.done], [null, false]);
  // Gar nichts erkannt → „Andere“ (ohne „Andere“: Auswahl)
  const nothing = planCategory(CATS, draftFromLabel({ ...label, category: "", subcategory: "" }));
  assert.deepEqual([nothing.categoryId, nothing.label, nothing.done], ["c-andere", "Andere", true]);
  const withoutOther = planCategory(CATS.filter((c) => c.id !== "c-andere"), draftFromLabel({ ...label, category: "", subcategory: "" }));
  assert.deepEqual([withoutOther.categoryId, withoutOther.done], [null, false]);
  // Ablauf: Kategorie vor allem anderen; Jahrgang bei Spirituosen freiwillig.
  const state = { step: "review", proposal: { type: "spirit", vintage_year: null }, spirit: sake } as unknown as IngestState;
  assert.equal(nextPurchaseStep(state), "category_main");
  assert.equal(nextPurchaseStep({ ...state, spirit: rye }), "location");
  assert.equal(nextPurchaseStep({ ...state, spirit: ok }), "location");
  assert.equal(needsVintage(state), false);
  assert.equal(nextPurchaseStep({ ...state, kind_unsure: true }), "kind");
});

test("Recherche legt nie Kategorien an: nur bestehende, sonst nichts", () => {
  const raw = (category: string): SpiritResearchRaw => ({
    matches_spirit: true, producer: "Brown-Forman", country: "USA", region: "Kentucky", alcohol_content: 45.2, age_years: 0, cask: "", distilled_year: 0, bottled_year: 0, category, sources: [],
  });
  assert.equal(spiritFindings(raw("Whisky › Bourbon"), CATS)?.spirit_category_id, "c-bourbon");
  const rye = spiritFindings(raw("Whisky › Rye"), CATS)!;
  assert.equal(rye.spirit_category_id, undefined, "unbekannte Kategorie wird nicht übernommen");
  assert.deepEqual([rye.region, rye.alcohol_content, rye.age_years], ["Kentucky", 45.2, undefined]);
  assert.equal(spiritFindings({ ...raw("Rum"), matches_spirit: false }, CATS), null);
});

test("Profil der Spirituose: ohne Säure und Tannin (bleiben leer), Aromen aus dem eigenen Lexikon", () => {
  const url = "https://www.finespirits.ch/products/woodford";
  const raw: TasteResearchRaw = {
    matches_wine: true,
    same_vintage: true,
    sources: [{ url, title: "Finespirits", kind: "merchant", vintage: 0 }],
    fields: { sweetness: "trocken", acidity: "hoch", tannin: "hoch", alcohol: "hoch", body: "voll", flavour_intensity: "ausgeprägt", finish: "lang" },
    aromas: [
      { group: "Fass & Reife", aroma: "Vanille", source_url: url, quote: "rich vanilla and caramel" },
      { group: "Primäraromen – Frucht", aroma: "Kirsche", source_url: url, quote: "cherry" },
    ],
    evidence: ["acidity", "tannin", "alcohol", "body", "finish"].map((field) => ({ field, source_url: url, quote: `${field}: long finish, full-bodied` })),
    contradictions: [],
    style_summary: "",
    food_pairing: [],
  } as TasteResearchRaw;
  const profile = validateTasteProfile(raw, { type: "rot", year: null, wineType: "spirit" })!;
  assert.equal(profile.spirit, true);
  assert.equal(profile.values.acidity, UNKNOWN);
  assert.equal(profile.values.tannin, UNKNOWN);
  assert.equal(profile.values.body, "voll");
  assert.deepEqual(profile.aromas, { "Fass & Reife": ["Vanille"] }, "Wein-Gruppen gelten nicht");
  const row = toRow(profile);
  assert.equal(row.acidity, null);
  assert.equal(row.tannin, null);
});

test("Startseite: Spirituosen in Bestand und Getrunken (eigene Zeile), Trinkreife und Vorschläge nur Wein", () => {
  const item = (x: Partial<StockItem>): StockItem => ({
    itemId: "i", wineId: "pintia", name: "Pintia", producer: null, type: "red", year: 2019, status: "sealed", quantity: 2, paid: 50, regular: 60,
    dateOpened: null, purchasedAt: null, drinkFrom: 2018, drinkUntil: 2024, ...x,
  });
  const stock = [item({}), item({ itemId: "s", wineId: "woodford", name: "Woodford", type: "spirit", year: null, quantity: 3, drinkFrom: null, drinkUntil: 2020 })];
  const totals = stockTotals(stock);
  assert.deepEqual([totals.bottles, totals.wines, totals.spiritBottles, totals.spirits], [5, 2, 3, 1]);
  const ready = readiness(stockUnits(stock, 2026));
  assert.deepEqual(ready.overdue.map((u) => u.wineId), ["pintia"], "Spirituose nie „über dem Höhepunkt“");
  const drunk = drunkByType(
    [
      { wineId: "pintia", name: "Pintia", type: "red", year: 2019, quantity: 1, drunkAt: "2026-10-10" },
      { wineId: "woodford", name: "Woodford", type: "spirit", year: null, quantity: 1, drunkAt: "2026-10-12" },
    ],
    Date.parse("2026-10-29T10:00:00Z"),
  );
  assert.deepEqual(drunk.month.byType, [{ type: "red", bottles: 1 }, { type: "spirit", bottles: 1 }]);
  const ctx = noteContext({ stock, drunk: [], purchases: [], tastedThisMonth: 0, ratings: [], pendingSuggestions: 0 }, "Michel", Date.parse("2026-10-29T10:00:00Z"));
  assert.deepEqual(ctx.refs.map((r) => r.wine_id), ["pintia"], "Tagestext schlägt nur Wein vor");
});

test("Offene Flaschen: Füllstand ja, aber keine Warnungen bei Spirituosen", () => {
  const open = (id: string, type: OpenEntry["type"], days: number): OpenEntry =>
    ({ itemId: id, wine_id: id, name: id, producer: "P", country: null, region: null, type, grapes: [], vintages: [null], units: [unit(null, 1)], fill: 60, dateOpened: null, days, bottleSizeMl: 700 }) as OpenEntry;
  const totals = openTotals([open("woodford", "spirit", 400), open("pintia", "red", 5)]);
  assert.equal(totals.longest?.wine_id, "pintia", "„Am längsten offen“ nur Wein");
  assert.equal(totals.count, 2);
  // Bot: Füllstand ja, „seit … T.“ nein.
  assert.equal(openBottleLine({ itemId: "x", wineId: "w", producer: "", name: "Woodford", year: null, type: "spirit", fill: 60, days: 400, room: null }, "Woodford"), "🥃 Woodford · 60 %");
  assert.match(openBottleLine({ itemId: "x", wineId: "w", producer: "", name: "Pintia", year: 2019, type: "red", fill: 60, days: 4, room: null }, "Pintia 2019"), /4 T\./);
  assert.equal(typeEmoji("spirit"), "🥃");
  const details = wineDetailsText({
    name: "Woodford Reserve", producer: "Woodford", type: "spirit", year: null, country: "USA", region: "Kentucky", appellation: null, alcohol: 45.2, grapes: "Mais",
    drinkFrom: null, drinkUntil: 2030, bottles: [{ status: "open", quantity: 1, storage_room: "Wohnzimmer", bottle_size_ml: 700, fill_level_percent: 60, date_opened: "2025-01-01", purchase_price: null, regular_price: null, currency: "CHF" }],
    ratings: [], lastTasting: null, appUrl: null, spirit: ["Whisky › Bourbon", "7 Jahre"],
  });
  assert.match(details, /Whisky › Bourbon · 7 Jahre/);
  assert.doesNotMatch(details, /Trinkreife|seit \d+ T\.|🍇/);
  assert.match(details, /🥃 Offen: Wohnzimmer · 60 %/);
});

// --- Mit Stub: Trinkfenster, Recherche, Bot

type Row = Record<string, unknown>;
let recognition: Row = {};
let researchCategory = "unbekannt";
const claudeCalls: string[] = [];
const net: Net = {
  tables: {},
  telegram: [],
  rpc: {
    replace_grape_shares: () => [],
  },
  storage: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name).filter(Boolean) ?? [];
    claudeCalls.push(tools.join(",") || "format");
    if ((body.output_config as { format?: unknown } | undefined)?.format) return claudeText(recognition);
    if (tools.includes("report_spirit_details")) {
      return claudeTool("report_spirit_details", {
        matches_spirit: true, producer: "", country: "", region: "Kentucky", alcohol_content: 45.2, age_years: 0, cask: "New Oak", distilled_year: 0, bottled_year: 0, category: researchCategory, sources: ["https://www.finespirits.ch/x"],
      });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
installNet(net);
const db = createAdminClient();
const W = "11111111-1111-4111-8111-111111111111";
const catRows = () => CATS.map((c) => ({ id: c.id, parent_id: c.parentId, name: c.name, sort_order: c.sortOrder }));

function reset() {
  claudeCalls.length = 0;
  net.telegram.length = 0;
  net.tables = {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [{ id: W, name: "Woodford Reserve", producer: "Woodford", type: "spirit", country: "USA", region: null, appellation: null, alcohol_content: null, grapes: [], spirit_category_id: null, age_years: null, cask: null, distilled_year: null, bottled_year: null }],
    spirit_categories: catRows(),
    wine_vintages: [], wine_grape_shares: [], inventory_items: [], ingest_jobs: [], vendors: [], wine_media: [], research_suggestions: [],
  };
}

test("kein Trinkfenster für Spirituosen (weder Recherche noch Schätzung); „Trinkfenster fehlt“ ohne sie", async () => {
  reset();
  assert.deepEqual(await findAndStoreDrinkWindow(db, W, null), { result: "none" });
  assert.equal(claudeCalls.length, 0, "keine Suche");
  assert.equal(net.tables.wine_vintages.length, 0);
  const g = wineGaps({ id: W, name: "W", producer: null, country: "USA", region: null, appellation: null, type: "spirit", alcohol_content: null, grapes: [] }, {
    items: [{ wine_id: W, vintage_year: 2015, status: "sealed" }],
    vintages: [],
    shares: [],
  }, "cellar")!;
  assert.deepEqual(g.gaps, ["alcohol", "origin"], "keine Rebsorten- und Trinkfenster-Lücken");
  assert.deepEqual(windowTargets(g, { vintages: [] }), []);
});

test("Recherche der Spirituose: füllt Leeres, legt keine Kategorie an", async () => {
  reset();
  // Keine passende Kategorie („unbekannt“ – das Schema lässt nur bestehende zu).
  researchCategory = "unbekannt";
  const result = await researchAndFillSpirit(db, { id: W, name: "Woodford Reserve", producer: "Woodford", country: "USA", region: null, alcohol_content: null });
  assert.deepEqual(result.filled, ["Region", "Alkohol", "Fass/Finish"]);
  const w = net.tables.wines[0];
  assert.deepEqual([w.region, w.alcohol_content, w.cask, w.spirit_category_id], ["Kentucky", 45.2, "New Oak", null]);
  assert.equal(net.tables.spirit_categories.length, CATS.length, "keine neue Kategorie");
  // Passt eine bestehende: gesetzt (nur, wenn leer).
  researchCategory = "Whisky › Bourbon";
  await researchAndFillSpirit(db, { id: W, name: "Woodford Reserve", producer: "Woodford", country: "USA", region: "Kentucky", alcohol_content: 45.2 });
  assert.equal(net.tables.wines[0].spirit_category_id, "c-bourbon");
  assert.equal(net.tables.spirit_categories.length, CATS.length);
});

const JOB = jobIdFor(111, "spirit-1");
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const lastText = () => String(sent().at(-1)?.body.text ?? "");
const buttons = () => ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard ?? []).flat().map((b) => b.text);
const cb = (data: string) => ({
  update_id: 2,
  callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } },
});
async function startAlbum(label: Row) {
  recognition = {
    name: "Rye Whiskey", producer: "Woodford Reserve", vintage_year: null, country: "USA", region: "Kentucky", appellation: null, type: null,
    grape_shares: [], alcohol_content: 45.2, bottle_size_ml: null, confidence: 0.95, uncertain_notes: null, vintage_certain: false, image_sides: ["front"], best_before: "",
    spirit: label,
  };
  net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], extracted: { step: "received", intent: "bought" }, updated_at: new Date(Date.now() - 60_000).toISOString() });
  net.storage!.set(`wine-photos/${photoFolder(JOB)}/10.jpg`, { bytes: await sharp({ create: { width: 600, height: 900, channels: 3, background: "#a06020" } }).jpeg().toBuffer(), type: "image/jpeg" });
  await processJob(JOB, 111);
}

test("Bot: unsicher → „Wein oder Spirituose?“, unbekannte Unterkategorie → Hauptkategorie ohne Rückfrage", async () => {
  reset();
  await startAlbum({ kind: "unsure", category: "Whisky", subcategory: "Rye", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 });
  assert.equal(state().step, "review");
  assert.equal(state().kind_unsure, true);
  assert.match(lastText(), /Wein oder Spirituose\?/);
  assert.ok(!claudeCalls.includes("report_wine_details"), "keine Wein-Recherche, solange unklar");

  await handleUpdate(cb(callbackData("save", JOB)) as never);
  assert.equal(state().step, "kind");
  assert.match(lastText(), /Wein oder (eine )?Spirituose\?/);
  assert.deepEqual(buttons(), ["🍷 Wein", "🥃 Spirituose", "✖️ Abbrechen"]);

  await handleUpdate(cb(callbackData("kind", JOB, "s")) as never);
  assert.equal(state().proposal.type, "spirit");
  assert.equal(state().proposal.bottle_size_ml, 700, "Standard 0,7 l");
  // „Rye“ gibt es nicht: Whisky, ohne Rückfrage und ohne „Anlegen“; kein Jahrgang nötig → Lagerort.
  assert.equal(state().step, "location");
  assert.equal(state().spirit?.categoryId, "c-whisky");
  assert.ok(!sent().some((m) => /anlegen/i.test(String(m.body.text))), "nichts zum Anlegen vorgeschlagen");
  assert.ok(!buttons().some((b) => /Anlegen/.test(b)));
  assert.equal(net.tables.spirit_categories.length, CATS.length, "nichts angelegt");

  await handleUpdate(cb(callbackData("loc", JOB, "wohnzimmer")) as never);
  await handleUpdate(cb(callbackData("qty", JOB, "1")) as never);
  await handleUpdate(cb(callbackData("skipprice", JOB)) as never);
  await handleUpdate(cb(callbackData("skipregular", JOB)) as never);
  assert.equal(state().step, "vendor");
  job().extracted = { ...state(), vendor_id: null, vendor_name: null, step: "saving" };
  await saveJob(job() as never, 111);
  assert.equal(job().status, "confirmed");
  const saved = net.tables.wines.find((w) => w.name === "Rye Whiskey")!;
  assert.deepEqual([saved.type, saved.spirit_category_id, saved.alcohol_content], ["spirit", "c-whisky", 45.2]);
  assert.equal(net.tables.inventory_items[0].bottle_size_ml, 700);
  assert.equal(net.tables.wine_vintages.filter((v) => v.drink_from_year != null || v.drink_until_year != null).length, 0, "kein Trinkfenster");
  assert.equal(net.tables.inventory_items[0].status, "sealed", "Einbuchen: alle Flaschen zu, nichts automatisch geöffnet");
});

test("Bot: unsichere Hauptkategorie → nur bestehende als Knöpfe, dann Unterkategorien; Bestätigung ohne Trinkfenster", async () => {
  reset();
  await startAlbum({ kind: "spirit", category: "Sake", subcategory: "", age_years: 7, cask: "Charred Oak", distilled_year: 2015, bottled_year: 2022 });
  assert.equal(state().proposal.type, "spirit");
  assert.match(lastText(), /🥃/);
  assert.match(lastText(), /Alter: 7 Jahre/);
  assert.match(lastText(), /Fass\/Finish: Charred Oak/);
  assert.match(lastText(), /Destilliert: 2015/);
  assert.match(lastText(), /Abgefüllt: 2022/);
  assert.doesNotMatch(lastText(), /Trinkreife|Trauben/);
  await handleUpdate(cb(callbackData("save", JOB)) as never);
  // „Sake“ gibt es nicht: Auswahl nur der bestehenden Hauptkategorien – kein „Anlegen“.
  assert.equal(state().step, "category_main");
  assert.match(lastText(), /In welche Kategorie gehört sie\?/);
  assert.deepEqual(buttons(), ["Whisky", "Likör", "Obstbrand", "Rum", "Tequila / Mezcal", "Andere", "✖️ Abbrechen"]);
  await handleUpdate(cb(callbackData("catmain", JOB, "0")) as never);
  assert.equal(state().step, "category_sub");
  assert.deepEqual(buttons(), ["Scotch Single Malt", "Bourbon", "Nur „Whisky“", "✖️ Abbrechen"]);
  await handleUpdate(cb(callbackData("catsub", JOB, "1")) as never);
  assert.equal(state().spirit?.categoryId, "c-bourbon");
  assert.equal(state().spirit?.label, "Whisky › Bourbon");
  assert.equal(state().step, "location");
  assert.equal(net.tables.spirit_categories.length, CATS.length, "„Sake“ nicht angelegt");
});

test("Gekauft oder nur verkostet? – bei Spirituosen mit 🥃, bei Wein 🍷", async () => {
  const { askPhotoIntent } = await import("@/lib/chat/tasted");
  const recognitionOf = (type: string | null, kind: "wine" | "spirit") => ({
    proposal: { name: kind === "spirit" ? "Acquastilla 36 Mesi" : "Pintia", producer: kind === "spirit" ? "Casa Grappa" : "Vega Sicilia", vintage_year: kind === "spirit" ? null : 2019, type, country: null, region: null, appellation: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null },
    spirit: kind === "spirit" ? { kind, category: "Grappa / Trester", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 } : null,
    model: "x", confidence: 0.9, notes: null, imageSides: null, vintageCertain: true,
  });
  for (const [type, kind, icon, question] of [
    [null, "spirit", "🥃", "Hast du sie gekauft oder nur verkostet?"],
    ["spirit", "spirit", "🥃", "Hast du sie gekauft oder nur verkostet?"],
    ["red", "wine", "🍷", "Hast du ihn gekauft oder nur verkostet?"],
  ] as const) {
    reset();
    net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "processing", photo_paths: [], extracted: { step: "received" } });
    await askPhotoIntent(db, JOB, 111, recognitionOf(type, kind) as never);
    assert.ok(lastText().startsWith(`${icon} <b>`), lastText());
    assert.ok(lastText().endsWith(question), lastText());
  }
});
