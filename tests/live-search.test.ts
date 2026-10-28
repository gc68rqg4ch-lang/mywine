// Suche beim Tippen (im Browser über die geladenen Einträge): Normalisierung (Akzente,
// Gross/Klein), alle Felder inkl. Notizen, Zahlen je Gruppe und Weintyp nach dem Filtern,
// Filter-Auswahl live, leere Trefferliste, URL-Parameter q wird mit replaceState nachgeführt.
// Ohne DB, API-Schlüssel und Netz. Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterOptions, mergeOptions, optionPart, typeCountParts, type Filterable } from "@/lib/cellar/filters";
import { EMPTY_FILTERS } from "@/lib/cellar/list-params";
import { groupWines, matchesQuery } from "@/lib/cellar/overview";
import { anyVisible, liveCount, queryTerms, searchText, visibleIds, withQuery } from "@/lib/cellar/search";
import { foldText } from "@/lib/text/fold";

type Entry = Filterable & { id: string };
const unit = (vintage_year: number | null, count: number, price_class: string | null = null) => ({ vintage_year, count, price_class, vendors: [] as string[] });
const wines: Entry[] = [
  { id: "a", name: "Pago de Carraovejas", producer: "Bodegas Peñafiel", country: "Spanien", region: "Ribera del Duero", type: "red", grapes: ["Tempranillo"], vintages: [2019, 2020], units: [unit(2019, 2, "30–60"), unit(2020, 1, "30–60")] },
  { id: "b", name: "Cuvée Spéciale", producer: "Tardieu-Laurent", country: "Frankreich", region: "Rhône", type: "white", grapes: ["Viognier"], vintages: [2023], units: [unit(2023, 3, "60–100")] },
  { id: "c", name: "Alion", producer: "Vega Sicilia", country: "Spanien", region: "Ribera del Duero", type: "red", grapes: ["Tinto Fino"], vintages: [2021], units: [unit(2021, 6, "60–100")] },
];
const notes: Record<string, string> = { c: "2021: zu Wild dekantieren" };
const index = Object.fromEntries(wines.map((w) => [w.id, searchText(w, notes[w.id])]));

test("Normalisierung: Akzente, Gross/Klein, ß, Satzzeichen egal", () => {
  assert.equal(foldText("Peñafiel"), "penafiel");
  assert.equal(foldText("CUVÉE Spéciale"), "cuvee speciale");
  assert.equal(foldText("Saint-Émilion Grand Cru"), "saint emilion grand cru");
  assert.equal(foldText("Weißburgunder"), "weissburgunder");
  assert.deepEqual(queryTerms("  Cuvée   SPECIALE "), ["cuvee", "speciale"]);
  assert.deepEqual([...visibleIds(index, "penafiel")!], ["a"]);
  assert.deepEqual([...visibleIds(index, "cuvee")!], ["b"]);
  assert.deepEqual([...visibleIds(index, "PEÑAFIEL")!], ["a"]);
  // Bot-Suche nach ähnlichen Weinen nutzt dieselbe Normalisierung
  assert.match(readFileSync("src/lib/ingest/wine-names.ts", "utf8"), /import \{ foldText \} from "@\/lib\/text\/fold"/);
});

test("Gesucht wird in Wein, Produzent, Land, Region, Traube, Jahrgang und Notizen; alle Begriffe müssen passen", () => {
  const hits = (q: string) => [...(visibleIds(index, q) ?? new Set(Object.keys(index)))].sort();
  assert.deepEqual(hits("carraovejas"), ["a"], "Wein");
  assert.deepEqual(hits("vega"), ["c"], "Produzent");
  assert.deepEqual(hits("frankreich"), ["b"], "Land");
  assert.deepEqual(hits("rhone"), ["b"], "Region ohne Akzent");
  assert.deepEqual(hits("tempranillo"), ["a"], "Traube");
  assert.deepEqual(hits("2020"), ["a"], "Jahrgang");
  assert.deepEqual(hits("dekantieren"), ["c"], "Notizen");
  assert.deepEqual(hits("ribera 2021"), ["c"], "alle Begriffe");
  assert.deepEqual(hits(""), ["a", "b", "c"], "leer = alles");
  assert.equal(visibleIds(index, "   "), null);
  // Server und Bot (matchesQuery) nutzen dieselbe Regel
  assert.ok(matchesQuery(wines[1], "cuvee speciale"));
  assert.ok(matchesQuery(wines[2], "WILD", notes.c));
});

test("Zahlen je Gruppe und je Weintyp nach dem Filtern", () => {
  const groups = groupWines(wines, "land", 2026);
  const parts = (key: string) => groups.find((g) => g.key === key)!.items.map((i): [string, number] => [(i.wine as Entry).id, i.bottles]);
  assert.equal(liveCount(parts("Spanien"), null), 9);
  const ribera = visibleIds(index, "ribera")!;
  assert.equal(liveCount(parts("Spanien"), ribera), 9);
  const pago = visibleIds(index, "pago")!;
  assert.equal(liveCount(parts("Spanien"), pago), 3, "nur die Treffer");
  assert.equal(anyVisible(["b"], pago), false, "Gruppe Frankreich verschwindet");
  // Gruppierung nach Jahrgang: ein Wein in mehreren Gruppen mit der Zahl dieser Gruppe
  const byYear = groupWines(wines, "jahrgang", 2026);
  const y2019 = byYear.find((g) => g.key === "2019")!.items.map((i): [string, number] => [(i.wine as Entry).id, i.bottles]);
  assert.equal(liveCount(y2019, pago), 2);
  // Weintyp-Knöpfe
  const types = typeCountParts(wines, "bottles", (w) => w.id);
  const count = (t: string, visible: Set<string> | null) => liveCount(types.find((x) => x.type === t)!.parts, visible);
  assert.deepEqual([count("red", null), count("white", null)], [9, 3]);
  assert.deepEqual([count("red", pago), count("white", pago)], [3, 0]);
  assert.equal(liveCount(typeCountParts(wines, "wines", (w) => w.id).find((x) => x.type === "red")!.parts, null), 2, "Verkostet: Weine");
});

test("Filter-Auswahl: aus den Beiträgen wie bisher, live nur aus den Treffern", () => {
  const all = mergeOptions(wines.map((w) => optionPart(w, 2026)), EMPTY_FILTERS);
  assert.deepEqual(all, filterOptions(wines, EMPTY_FILTERS, 2026), "gleich wie vorher");
  const visible = visibleIds(index, "spanien")!;
  const live = mergeOptions(wines.filter((w) => visible.has(w.id)).map((w) => optionPart(w, 2026)), EMPTY_FILTERS);
  assert.deepEqual(live.countries, ["Spanien"]);
  assert.deepEqual(live.grapes, ["Tempranillo", "Tinto Fino"]);
  // Gewählte Werte bleiben sichtbar
  assert.deepEqual(mergeOptions([], { ...EMPTY_FILTERS, countries: ["Italien"] }).countries, ["Italien"]);
});

test("Keine Treffer: leere Menge, Hinweis mit Knopf zum Zurücksetzen", () => {
  const none = visibleIds(index, "xyz")!;
  assert.equal(none.size, 0);
  assert.equal(anyVisible(Object.keys(index), none), false);
  const ui = readFileSync("src/components/cellar/live-search.tsx", "utf8");
  assert.match(ui, /Keine Treffer\./);
  assert.match(ui, /onClick=\{\(\) => setQuery\(""\)\}[\s\S]*Suche zurücksetzen/);
});

test("URL: q mit replaceState nachgeführt (andere Parameter bleiben, leer → ohne q)", () => {
  assert.equal(withQuery("/?gruppe=land&auf=Spanien", "pena"), "/?gruppe=land&auf=Spanien&q=pena");
  assert.equal(withQuery("/offen?q=alt&typ=red", "neu wert"), "/offen?q=neu+wert&typ=red");
  assert.equal(withQuery("/verkostet?q=alt&gruppe=land", ""), "/verkostet?gruppe=land");
  assert.equal(withQuery("/getrunken?q=x", "  "), "/getrunken");
  const ui = readFileSync("src/components/cellar/live-search.tsx", "utf8");
  assert.match(ui, /window\.history\.replaceState\(null, "", withQuery\(/);
  assert.ok(!/pushState|router\.push/.test(ui), "kein Eintrag pro Buchstabe");
  assert.match(ui, /rememberList\(basePath\)/, "„← Liste“ führt zur gefilterten Liste");
});

test("Suchfeld: filtert beim Tippen, Enter lädt nicht neu, ✕ leert und behält den Fokus; alle vier Listen", () => {
  const controls = readFileSync("src/components/cellar/list-controls.tsx", "utf8");
  assert.match(controls, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
  assert.match(controls, /onSubmit=\{\(e\) => \{[\s\S]*e\.preventDefault\(\)/);
  assert.match(controls, /setQuery\(""\);\s*input\.current\?\.focus\(\);/);
  assert.match(controls, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  const view = readFileSync("src/components/cellar/list-view.tsx", "utf8");
  assert.match(view, /<SearchScope /);
  for (const f of ["src/app/(cellar)/page.tsx", "src/app/(cellar)/offen/page.tsx", "src/app/(cellar)/getrunken/page.tsx", "src/app/(cellar)/verkostet/page.tsx"]) {
    const page = readFileSync(f, "utf8");
    assert.match(page, /<ListView/, f);
    assert.ok(!/state\.query \?/.test(page), `${f}: Server filtert nicht mehr nach q`);
  }
});
