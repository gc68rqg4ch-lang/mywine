// Bestandsübersicht: ein Eintrag pro Wein, Lagerort-Filter, Kennzahlen, Gruppierungen
// (Weintyp, Land, Rebsorte, Jahrgang, Preisklasse), Suche, Weintyp-Filter und URL-Parameter.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTypeFilter, typeOf } from "@/lib/cellar/list-params";
import {
  BASE_GROUPINGS, buildCellarWines, cellarTotals, countryFlag, drinkCounts, formatVintages, groupWines, isGroupBy, matchesQuery,
  originLabel, parseLocations, priceClass, type SummaryWine, type VintageRow,
} from "@/lib/cellar/overview";

const K = { storage_house: "Zuhause", storage_room: "Weinkeller" };
const W = { storage_house: "Zuhause", storage_room: "Wohnzimmer" };
const N = { storage_house: null, storage_room: null };
const wine = (id: string, type: SummaryWine["type"], country: string, grapes: string[]): SummaryWine =>
  ({ wine_id: id, name: `Wein ${id}`, producer: `P ${id}`, country, region: null, type, grapes });
const row = (id: string, y: number | null, pc: string | null, locs: VintageRow["locations"], ds: VintageRow["drink_status"] = "unknown"): VintageRow =>
  ({ wine_id: id, vintage_year: y, bottle_size_ml: 750, avg_price: null, price_class: pc, drink_status: ds, drink_from_year: null, drink_until_year: null, locations: locs });

const wines = [
  wine("a", "red", "Spanien", ["Tempranillo"]),
  wine("b", "red", "USA", ["Cabernet Sauvignon", "Merlot"]),
  wine("c", "white", "USA", ["Chardonnay"]),
  wine("d", "rose", "Schweiz", ["Pinot Noir"]),
  wine("e", "red", "Portugal", ["Touriga Nacional"]),
];
const rows = [
  row("a", 2019, "60–100", [{ ...K, sealed: 10, open: 0 }, { ...W, sealed: 1, open: 0 }], "ready"),
  row("a", 2021, "30–60", [{ ...W, sealed: 2, open: 0 }]),
  row("b", 2018, "100–200", [{ ...W, sealed: 5, open: 0 }, { ...N, sealed: 0, open: 1 }]),
  row("c", 2023, "30–60", [{ ...K, sealed: 11, open: 0 }]),
  row("d", 2025, "bis 30", [{ ...K, sealed: 3, open: 0 }]),
  row("e", 2022, null, [{ ...N, sealed: 0, open: 1 }]),
];
const all = buildCellarWines(wines, rows, null);
const inStock = (ws = all) => ws.filter((w) => w.sealed > 0);
const summary = (by: Parameters<typeof groupWines>[1], ws = all) => groupWines(inStock(ws), by).map((g) => [g.label, g.bottles]);

test("ein Eintrag pro Wein, Kennzahlen und Trinkreife-Zählung", () => {
  assert.deepEqual(cellarTotals(all), { bottles: 32, wines: 4, vintages: 5 });
  assert.equal(all.find((w) => w.wine_id === "e")?.open, 1);
  assert.equal(formatVintages(all.find((w) => w.wine_id === "a")!.vintages), "2019 · 2021");
  assert.deepEqual(drinkCounts(all), { overdue: 0, now: 0, ready: 11, wait: 0, unknown: 21 });
});

test("Lagerort-Filter: nur Flaschen dort; offene ohne Lagerort nur unter „Alle“", () => {
  const keller = buildCellarWines(wines, rows, { house: "Zuhause", room: "Weinkeller" });
  assert.deepEqual(cellarTotals(keller), { bottles: 24, wines: 3, vintages: 3 });
  assert.deepEqual(keller.map((w) => w.wine_id).sort(), ["a", "c", "d"]);
  assert.deepEqual(summary("jahrgang", keller), [["2019", 10], ["2023", 11], ["2025", 3]]);
  const wohn = buildCellarWines(wines, rows, { house: null, room: "Wohnzimmer" });
  assert.deepEqual(cellarTotals(wohn), { bottles: 8, wines: 2, vintages: 3 });
  assert.equal(wohn.reduce((s, w) => s + w.open, 0), 0);
});

test("Gruppierungen: Weintyp, Jahrgang, Preisklasse, Land, Rebsorte", () => {
  assert.deepEqual(BASE_GROUPINGS, ["typ", "land", "rebsorte", "jahrgang", "preis", "trinkreife"]);
  assert.ok(isGroupBy("trinkreife") && !isGroupBy("getrunken") && isGroupBy("getrunken", ["getrunken"]));
  assert.deepEqual(summary("typ"), [["Rot", 18], ["Weiss", 11], ["Rosé", 3]]);
  assert.deepEqual(summary("jahrgang"), [["2018", 5], ["2019", 11], ["2021", 2], ["2023", 11], ["2025", 3]]);
  assert.deepEqual(summary("preis"), [["bis 30 CHF", 3], ["30–60 CHF", 13], ["60–100 CHF", 11], ["100–200 CHF", 5]]);
  assert.deepEqual(summary("land"), [["USA", 16], ["Spanien", 13], ["Schweiz", 3]]);
  assert.deepEqual(summary("rebsorte")[0], ["Tempranillo", 13]);
  assert.ok(summary("rebsorte").some(([l, n]) => l === "Merlot" && n === 5), "Cuvée unter jeder Traube");
  // Bei Preisklasse/Jahrgang erscheint ein Wein in jeder passenden Gruppe mit deren Flaschen
  const aIn3060 = groupWines(inStock(), "preis").find((g) => g.key === "30–60")!.items.find((i) => i.wine.wine_id === "a")!;
  assert.deepEqual([aIn3060.bottles, aIn3060.vintages], [2, [2021]]);
  assert.equal(groupWines(inStock(), "land")[0].flag, "🇺🇸");
});

test("Weintyp-Filter: gefilterte Liste, wirkt mit Gruppierung", () => {
  const filtered = applyTypeFilter(inStock(), "red");
  assert.deepEqual(filtered.map((w) => w.wine_id), ["a", "b"]);
  assert.deepEqual(groupWines(filtered, "jahrgang").map((g) => [g.label, g.bottles]), [["2018", 5], ["2019", 11], ["2021", 2]]);
  assert.deepEqual(applyTypeFilter(inStock(), null).length, 4);
  assert.equal(typeOf({ type: null }), "unknown");
  assert.deepEqual(applyTypeFilter([{ type: null }, { type: "red" as const }], "unknown"), [{ type: null }]);
});

test("Suche, Flaggen, Herkunft, Lagerorte, Preisklassen", () => {
  assert.ok(matchesQuery(all[0], all[0].producer!.split(" ")[1]));
  assert.ok(matchesQuery(all.find((w) => w.wine_id === "a")!, "tempra 2021"));
  assert.ok(!matchesQuery(all.find((w) => w.wine_id === "a")!, "tempra 2018"));
  assert.equal(countryFlag("Schweiz"), "🇨🇭");
  assert.equal(countryFlag("USA"), "🇺🇸");
  assert.equal(countryFlag("Atlantis"), null);
  assert.equal(originLabel({ country: "Spanien", region: "Toro" }), "🇪🇸 Toro");
  assert.equal(originLabel({ country: null, region: null }), null);
  assert.deepEqual(parseLocations([{ sealed: 2, open: 0, storage_room: "X", storage_house: null }, 3, null]), [
    { storage_house: null, storage_room: "X", sealed: 2, open: 0 },
  ]);
  assert.equal(priceClass(30), "bis 30");
  assert.equal(priceClass(30.01), "30–60");
  assert.equal(priceClass(200), "100–200");
  assert.equal(priceClass(201), "über 200");
  assert.equal(priceClass(null), null);
});
