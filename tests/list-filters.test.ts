// Listen: Zustand in der URL (Gruppierung, Typ, offene Gruppen, Filter), Filterlogik,
// Weintyp-Knöpfe (immer sechs Typen, leere mit 0, Rot vorausgewählt) und Orange entfernt.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { applyFilters, filterOptions, typeCounts, withDrinkWindows, type Filterable } from "@/lib/cellar/filters";
import {
  DEFAULT_TYPE,
  EMPTY_FILTERS,
  TYPE_ORDER,
  activeFilterCount,
  listHref,
  listSearchParams,
  readListState,
  toggle,
  type ListFilters,
} from "@/lib/cellar/list-params";
import { BASE_GROUPINGS, TASTED_GROUPINGS, groupWines, toSummaryWine, type GroupUnit } from "@/lib/cellar/overview";
import { typeCode, typeEmoji } from "@/lib/chat/menu-view";
import { chatTools } from "@/lib/chat/tools";
import { WINE_TYPES, WINE_TYPE_LABELS, asWineType, wineTypeLabel } from "@/lib/format";
import { RecognitionSchema, TextEntrySchema, WineProposalSchema } from "@/lib/ingest/schema";

const Y = 2026;
const params = (href: string) => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of new URL(href, "https://x").searchParams) (out[k] ??= []).push(v);
  return out;
};

test("URL-Zustand: Standard (Weintyp, Rot), alles wieder lesbar, Standardwerte weggelassen", () => {
  const empty = readListState({}, BASE_GROUPINGS);
  assert.deepEqual(empty, { query: "", groupBy: "typ", type: "red", open: [], filters: EMPTY_FILTERS, spirit: { main: null, sub: null } });
  assert.equal(DEFAULT_TYPE, "red");
  assert.equal(listHref("/", empty), "/", "Rot vorausgewählt steht nicht in der URL");

  const state = readListState(
    {
      gruppe: "land",
      q: " pintia ",
      typ: "white",
      auf: ["Spanien", "Frankreich"],
      land: ["Spanien", "Frankreich"],
      region: "Toro",
      traube: ["Tempranillo"],
      jv: "2015",
      jb: "2020",
      preis: ["30–60", "60–100"],
      reife: ["ready", "now", "quatsch"],
      sterne: "3.5",
      von_person: "Sara",
      haendler: "Mövenpick",
    },
    BASE_GROUPINGS,
  );
  assert.deepEqual(state, {
    query: "pintia",
    groupBy: "land",
    type: "white",
    open: ["Spanien", "Frankreich"],
    filters: {
      countries: ["Spanien", "Frankreich"],
      regions: ["Toro"],
      grapes: ["Tempranillo"],
      yearFrom: 2015,
      yearTo: 2020,
      priceClasses: ["30–60", "60–100"],
      drink: ["ready", "now"],
      minRating: 3.5,
      ratingBy: "Sara",
      vendors: ["Mövenpick"],
    },
    spirit: { main: null, sub: null },
  });
  // Hin und zurück: gleicher Zustand (so führt „Zurück“ genau dorthin).
  const href = listHref("/getrunken", state);
  assert.ok(href.startsWith("/getrunken?"));
  assert.deepEqual(readListState(params(href), BASE_GROUPINGS), state);
  assert.equal(activeFilterCount(state.filters), 2 + 1 + 1 + 1 + 2 + 2 + 1 + 1);

  // Ungültiges fällt weg; bei Weintyp gilt ein gewählter Typ als Knopf.
  assert.deepEqual(readListState({ gruppe: "getrunken", typ: "orange", sterne: "7", jv: "abc" }, BASE_GROUPINGS), empty);
  assert.equal(readListState({ typ: "sweet" }, BASE_GROUPINGS).type, "sweet");
  assert.equal(readListState({ gruppe: "kaufen" }, TASTED_GROUPINGS).groupBy, "kaufen");
  assert.equal(listSearchParams({ ...empty, type: "white" }).get("typ"), "white");
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggle(["a"], "c"), ["a", "c"]);
});

// --- Filter

const unit = (vintage_year: number | null, count: number, x: Partial<GroupUnit> = {}): GroupUnit => ({ vintage_year, price_class: null, count, ...x });
type Entry = Filterable & { id: string };
const entry = (id: string, x: Partial<Entry>, units: GroupUnit[]): Entry => ({
  id,
  name: id,
  producer: "P",
  country: null,
  region: null,
  type: "red",
  grapes: [],
  vintages: [...new Set(units.map((u) => u.vintage_year))],
  units,
  ...x,
});
const entries: Entry[] = [
  entry("pintia", { country: "Spanien", region: "Toro", grapes: ["Tinta de Toro"], ratings: [{ person: "Michel", rating: 4 }, { person: "Sara", rating: 4.5 }] }, [
    unit(2016, 2, { price_class: "60–100", drink_from_year: 2020, drink_until_year: 2026, vendors: ["Mövenpick"] }),
    unit(2019, 6, { price_class: "30–60", drink_from_year: 2024, drink_until_year: 2032, vendors: ["Mövenpick", "Coop"] }),
  ]),
  entry("rioja", { country: "Spanien", region: "Rioja", grapes: ["Tempranillo", "Graciano"], ratings: [{ person: "Michel", rating: 3 }] }, [
    unit(2018, 3, { price_class: "bis 30", vendors: [] }),
  ]),
  entry("chablis", { type: "white", country: "Frankreich", region: "Burgund", grapes: ["Chardonnay"] }, [
    unit(2021, 1, { price_class: "30–60", drink_from_year: 2030, vendors: ["Coop"] }),
  ]),
];
const f = (x: Partial<ListFilters>): ListFilters => ({ ...EMPTY_FILTERS, ...x });
const ids = (list: Entry[]) => list.map((e) => e.id);

test("Filter Wein-Ebene: Land, Region, Rebsorte (eine davon), Bewertung je Person oder eine von beiden", () => {
  assert.deepEqual(applyFilters(entries, EMPTY_FILTERS, Y), entries, "ohne Filter unverändert");
  assert.deepEqual(ids(applyFilters(entries, f({ countries: ["Spanien"] }), Y)), ["pintia", "rioja"]);
  assert.deepEqual(ids(applyFilters(entries, f({ countries: ["Spanien", "Frankreich"] }), Y)), ["pintia", "rioja", "chablis"]);
  assert.deepEqual(ids(applyFilters(entries, f({ countries: ["Spanien"], regions: ["Toro"] }), Y)), ["pintia"]);
  assert.deepEqual(ids(applyFilters(entries, f({ grapes: ["Graciano", "Chardonnay"] }), Y)), ["rioja", "chablis"]);
  assert.deepEqual(ids(applyFilters(entries, f({ minRating: 4 }), Y)), ["pintia"], "eine von beiden ≥ 4");
  assert.deepEqual(ids(applyFilters(entries, f({ minRating: 3, ratingBy: "Michel" }), Y)), ["pintia", "rioja"]);
  assert.deepEqual(ids(applyFilters(entries, f({ minRating: 4.5, ratingBy: "Michel" }), Y)), []);
  assert.deepEqual(ids(applyFilters(entries, f({ minRating: 4.5, ratingBy: "Sara" }), Y)), ["pintia"]);
});

test("Filter Einheiten-Ebene: Jahrgang von–bis, Preisklasse, Trinkreife, Händler – nur passende Flaschen bleiben", () => {
  const years = applyFilters(entries, f({ yearFrom: 2017, yearTo: 2019 }), Y);
  assert.deepEqual(ids(years), ["pintia", "rioja"]);
  assert.deepEqual(years[0].units.map((u) => [u.vintage_year, u.count]), [[2019, 6]], "2016 fällt weg");
  assert.deepEqual(years[0].vintages, [2019]);
  assert.deepEqual(groupWines(years, "typ").map((g) => [g.label, g.bottles]), [["Rot", 9]]);

  assert.deepEqual(ids(applyFilters(entries, f({ priceClasses: ["30–60"] }), Y)), ["pintia", "chablis"]);
  // 2016: bis 2026 → jetzt trinken; 2019: trinkreif; Chablis: ab 2030 → noch lagern; Rioja: kein Fenster → unbekannt
  assert.deepEqual(ids(applyFilters(entries, f({ drink: ["now"] }), Y)), ["pintia"]);
  assert.deepEqual(ids(applyFilters(entries, f({ drink: ["wait", "unknown"] }), Y)), ["rioja", "chablis"]);
  const coop = applyFilters(entries, f({ vendors: ["Coop"] }), Y);
  assert.deepEqual(ids(coop), ["pintia", "chablis"], "ohne Händler (Rioja) fällt weg");
  assert.deepEqual(coop[0].units.map((u) => u.vintage_year), [2019]);
  // kombiniert
  assert.deepEqual(ids(applyFilters(entries, f({ countries: ["Spanien"], vendors: ["Coop"], drink: ["ready"] }), Y)), ["pintia"]);
});

test("Filterfeld: nur vorhandene Werte, Regionen des gewählten Lands, gewählte bleiben sichtbar", () => {
  const all = filterOptions(entries, EMPTY_FILTERS, Y);
  assert.deepEqual(all.countries, ["Frankreich", "Spanien"]);
  assert.deepEqual(all.regions, ["Burgund", "Rioja", "Toro"]);
  assert.deepEqual(all.grapes, ["Chardonnay", "Graciano", "Tempranillo", "Tinta de Toro"]);
  assert.deepEqual(all.years, [2016, 2018, 2019, 2021]);
  assert.deepEqual(all.priceClasses, ["bis 30", "30–60", "60–100"], "Reihenfolge wie price_class");
  assert.deepEqual(all.drink, ["now", "ready", "wait", "unknown"]);
  assert.deepEqual(all.persons, ["Michel", "Sara"]);
  assert.deepEqual(all.vendors, ["Coop", "Mövenpick"]);
  assert.deepEqual(filterOptions(entries, f({ countries: ["Spanien"] }), Y).regions, ["Rioja", "Toro"]);
  assert.deepEqual(filterOptions(entries.slice(2), f({ countries: ["Italien"], vendors: ["Denner"] }), Y).countries, ["Frankreich", "Italien"]);
  assert.deepEqual(filterOptions(entries.slice(1, 2), EMPTY_FILTERS, Y).vendors, []);

  const windows = withDrinkWindows([entry("x", {}, [unit(2019, 1)])], [{ wine_id: "x", vintage_year: 2019, drink_from_year: 2020, drink_until_year: 2030 }], (e) => e.id);
  assert.deepEqual([windows[0].units[0].drink_from_year, windows[0].units[0].drink_until_year], [2020, 2030]);
});

test("Art-Knöpfe: immer sechs Weinarten und Spirituose in fester Reihenfolge, leere mit 0, Unbekannt nur wenn vorhanden", () => {
  const counts = typeCounts(entries, "bottles");
  assert.deepEqual(counts, [
    { type: "red", count: 11 },
    { type: "white", count: 1 },
    { type: "rose", count: 0 },
    { type: "sparkling", count: 0 },
    { type: "sweet", count: 0 },
    { type: "fortified", count: 0 },
    { type: "spirit", count: 0 },
  ]);
  assert.deepEqual(counts.map((c) => WINE_TYPE_LABELS[c.type as keyof typeof WINE_TYPE_LABELS]), ["Rot", "Weiss", "Rosé", "Schaumwein", "Süsswein", "Likörwein", "Spirituose"]);
  assert.deepEqual(typeCounts(entries, "wines").slice(0, 2), [{ type: "red", count: 2 }, { type: "white", count: 1 }], "Verkostet: Anzahl Weine");
  const withUnknown = typeCounts([...entries, entry("x", { type: null }, [unit(null, 2)])], "bottles");
  assert.deepEqual(withUnknown.at(-1), { type: "unknown", count: 2 });
  assert.deepEqual(typeCounts([], "bottles").map((c) => c.count), [0, 0, 0, 0, 0, 0, 0]);
});

test("Orange ist entfernt: App-Typen, Symbole/Bot, Erkennung und Tool-Schemas", () => {
  assert.deepEqual([...WINE_TYPES], ["red", "white", "rose", "sparkling", "sweet", "fortified", "spirit"]);
  assert.ok(!(TYPE_ORDER as string[]).includes("orange"));
  assert.equal("orange" in WINE_TYPE_LABELS, false);
  assert.equal(asWineType("orange"), null, "alte DB-Werte → unbekannt");
  assert.equal(wineTypeLabel("orange"), "Unbekannt");
  assert.equal(toSummaryWine({ wine_id: "w", name: "N", producer: "P", country: null, region: null, type: "orange", grapes: [] })?.type, null);
  // Bot: Süsswein 🍯, Likörwein 🫗, Spirituose 🥃, kein 🟠
  assert.deepEqual([typeEmoji("sweet"), typeEmoji("fortified"), typeEmoji("spirit"), typeEmoji("orange")], ["🍯", "🫗", "🥃", "🍇"]);
  assert.equal(typeCode("orange"), "u");
  // Claude-Schemas: Erkennung, Text-Erfassung und alle Chat-Tools ohne „orange“
  for (const schema of [WineProposalSchema, RecognitionSchema, TextEntrySchema]) {
    assert.doesNotMatch(JSON.stringify(z.toJSONSchema(schema)), /orange/i);
  }
  for (const tool of chatTools({} as never, []) as { name: string; input_schema?: unknown }[]) {
    assert.doesNotMatch(JSON.stringify(tool.input_schema ?? {}), /"orange"/, tool.name);
  }
});
