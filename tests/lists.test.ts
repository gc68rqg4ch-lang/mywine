// Listen „Offen“ und „Getrunken“: gleiche Einträge wie der Bestand (Groupable), Kennzahlen,
// Bewertungen je Person, Gruppierung „Getrunken am“ (Jahr, darin Monate, Zürcher Zeit).
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupWines, matchesQuery } from "@/lib/cellar/overview";
import { buildDrunkEntries, drunkTotals, latestByPerson, openTotals, toOpenEntry, type DrunkBottle } from "@/lib/cellar/lists";

const wine = (name: string, type: "red" | "white" = "red", country = "Spanien") => ({ name, producer: `P ${name}`, country, region: null, type });
const b = (id: string, wine_id: string, w: ReturnType<typeof wine>, year: number | null, drunk_at: string | null, price: number | null, legacy: number | null = null): DrunkBottle =>
  ({ itemId: id, wine_id, vintage_year: year, quantity: 1, purchase_price: price, drunk_at, legacy_rating: legacy, wine: w });
const A = wine("Pintia"), B = wine("Chardonnay", "white", "USA"), C = wine("Alt");
const bottles = [
  b("1", "a", A, 2019, "2026-10-12T19:00:00Z", 66),
  b("2", "a", A, 2019, "2026-03-01T19:00:00Z", 66),
  b("3", "a", A, 2016, "2025-12-31T23:30:00Z", 25), // Zürich: 1.1.2026
  b("4", "b", B, 2023, "2026-10-01T18:00:00Z", 36),
  b("5", "c", C, 2010, null, null, 4),
];
const ratings = new Map([
  ["a", [
    { wine_id: "a", person_name: "Sara", rating: 4.5, rated_at: "2026-10-12" },
    { wine_id: "a", person_name: "Michel", rating: 3, rated_at: "2026-01-01" },
    { wine_id: "a", person_name: "Michel", rating: 4, rated_at: "2026-10-12" },
  ]],
  ["b", [{ wine_id: "b", person_name: "Michel", rating: 3.5, rated_at: "2026-10-02" }]],
]);
const entries = buildDrunkEntries(bottles, new Map([["a", ["Tempranillo"]]]), ratings, ["Michel", "Sara"]);

test("Getrunken: ein Eintrag pro Wein, neueste Bewertung je Person, Durchschnitt", () => {
  assert.deepEqual(latestByPerson(ratings.get("a")!), [{ person: "Sara", rating: 4.5 }, { person: "Michel", rating: 4 }]);
  assert.deepEqual(entries.map((e) => e.wine_id), ["a", "b", "c"], "zuletzt getrunken zuerst, ohne Datum zuletzt");
  const a = entries[0];
  assert.deepEqual([a.bottles, a.lastDrunk, a.latestItemId, a.vintages], [3, "2026-10-12", "1", [2016, 2019]]);
  assert.deepEqual(a.ratings.map((r) => r.person), ["Michel", "Sara"]);
  assert.equal(a.score, 4.25);
  assert.equal(entries[2].score, 4, "alte Bewertung als Ersatz");
  assert.ok(matchesQuery(a, "tempra 2016"));
});

test("Getrunken: Kennzahlen des Jahres (Zürcher Zeit), Favoriten, zuletzt", () => {
  const t = drunkTotals(entries, "2026");
  assert.equal(t.thisYear, 4, "Silvester-Flasche zählt in Zürich zu 2026");
  assert.equal(t.thisYearWines, 2);
  assert.deepEqual(t.favorites.map((e) => e.wine_id), ["a", "c", "b"]);
  assert.deepEqual(t.recent.map((e) => e.wine_id), ["a", "b"]);
});

test("Getrunken: Gruppierung „Getrunken am“ und die gemeinsamen Gruppierungen", () => {
  const byDrunk = groupWines(entries, "getrunken");
  assert.deepEqual(byDrunk.map((g) => [g.label, g.bottles]), [["2026", 4], ["Ohne Datum", 1]]);
  assert.deepEqual(byDrunk[0].items.map((i) => [i.wine.wine_id, i.bottles]), [["a", 3], ["b", 1]], "pro Wein einmal im Jahr");
  assert.deepEqual(byDrunk[0].sections!.map((s) => [s.label, s.bottles, s.items.map((i) => i.wine.wine_id).join()]), [
    ["Oktober", 2, "a,b"], ["März", 1, "a"], ["Januar", 1, "a"],
  ]);
  assert.equal(byDrunk[1].sections, undefined);
  assert.deepEqual(groupWines(entries, "preis").map((g) => [g.label, g.bottles]), [["bis 30 CHF", 1], ["30–60 CHF", 1], ["60–100 CHF", 2], ["Ohne Preis", 1]]);
  assert.deepEqual(groupWines(entries, "jahrgang").map((g) => [g.label, g.bottles]), [["2010", 1], ["2016", 1], ["2019", 2], ["2023", 1]]);
  assert.deepEqual(groupWines(entries, "typ").map((g) => [g.label, g.bottles]), [["Rot", 4], ["Weiss", 1]]);
});

test("Offen: Kennzahlen und Gruppierungen inkl. Trinkreife", () => {
  const open = [
    toOpenEntry({ ...wine("X"), inventory_item_id: "i1", wine_id: "x", vintage_year: 2020, purchase_price: 45, fill_level_percent: 50, date_opened: "2026-03-25", bottle_size_ml: 750, drink_from_year: 2022, drink_until_year: 2030 }, ["Merlot"]),
    toOpenEntry({ ...wine("Y", "white"), inventory_item_id: "i2", wine_id: "y", vintage_year: null, purchase_price: null, fill_level_percent: 81, date_opened: null, bottle_size_ml: 500 }, []),
  ];
  const ot = openTotals(open);
  assert.deepEqual([ot.count, ot.longest?.itemId, ot.avgFill], [2, "i1", 66]);
  assert.deepEqual(groupWines(open, "preis").map((g) => [g.label, g.bottles]), [["30–60 CHF", 1], ["Ohne Preis", 1]]);
  assert.deepEqual(groupWines(open, "rebsorte").map((g) => g.label), ["Merlot", "Rebsorte unbekannt"]);
  assert.deepEqual(groupWines(open, "trinkreife", 2026).map((g) => [g.label, g.bottles]), [["Trinkreif", 1], ["Unbekannt", 1]]);
});
