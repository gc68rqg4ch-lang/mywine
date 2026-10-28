// Verkostet (wine_encounters): Erfassen über das gemeinsame Modul (Formular → Bearbeitung →
// Vorschau → Speichern), Bearbeiten, Löschen, Merker „Kaufen?“, Weinseite (Einträge,
// Jahrgänge) und die Liste (Einträge, Kacheln, Gruppierungen). Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { buildTastedEntries, tastedTotals, type EncounterRow, type TastedWineInfo } from "@/lib/cellar/tasted";
import { TASTED_GROUPINGS, groupWines } from "@/lib/cellar/overview";
import { vintageOptions, withTastedYears } from "@/lib/cellar/wine-page";
import { NOTHING, applyEdit, prepareEdit } from "@/lib/edit/edit";
import { encounterPrice, loadWineEncounters, placeLabel } from "@/lib/edit/encounters";
import { editsFromForm } from "@/lib/edit/form";
import type { Edit } from "@/lib/edit/types";
import { formatDate, todayIso } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { tastingRow } from "@/lib/tasting/store";

const W = "11111111-1111-4111-8111-111111111111";
const P1 = "33333333-3333-4333-8333-333333333333";
const M = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const S = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const net: Net = {
  tables: {
    persons: [{ id: M, name: "Michel", sort_order: 0 }, { id: S, name: "Sara", sort_order: 1 }],
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", want_to_buy: false, grapes: [] }],
    places: [{ id: P1, name: "Kronenhalle", kind: "restaurant", city: "Zürich" }],
    wine_encounters: [],
    wine_ratings: [],
    wine_tastings: [],
    inventory_items: [],
  },
  telegram: [],
  rpc: {},
  claude: () => {
    throw new Error("unerwarteter Claude-Aufruf");
  },
};
installNet(net);
const db = createAdminClient();
const today = todayIso();
const encounters = () => net.tables.wine_encounters as Record<string, unknown>[];
const ratings = () => net.tables.wine_ratings as Record<string, unknown>[];
const star = (n: number) => `${n.toLocaleString("de-CH")} ★`;
const wine = (id = W) => net.tables.wines.find((w) => w.id === id)!;

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

test("Formular: Jahrgang Pflicht (NV möglich), neuer Ort, Preis pro Glas, Bewertungen, Merker", () => {
  const base = { kind: "addEncounter", wineMode: "existing", wineId: W, tastedOn: "2026-10-20", place: "" };
  assert.deepEqual(editsFromForm(form({ ...base, year: "" })), { error: "Jahrgang fehlt – Jahreszahl eintragen oder „Ohne Jahrgang (NV)“ wählen." });
  const nv = editsFromForm(form({ ...base, nv: "on" })) as Edit[];
  assert.equal(nv[0].kind === "addEncounter" && nv[0].year, null);

  const [edit] = editsFromForm(
    form({
      ...base,
      year: "2019",
      place: "new",
      placeName: "Wirtschaft Neumarkt",
      placeKind: "restaurant",
      placeCity: "Zürich",
      price: "12.50",
      priceUnit: "glass",
      currency: "AED",
      occasion: "Geburtstag",
      companions: "Marc",
      note: "Sehr fein",
      wantToBuy: "on",
      [`rating:${M}`]: "4.5",
      [`rating:${S}`]: "",
    }),
  ) as Edit[];
  assert.deepEqual(edit, {
    kind: "addEncounter",
    wine: { wineId: W },
    year: 2019,
    set: {
      tastedOn: "2026-10-20",
      place: { name: "Wirtschaft Neumarkt", kind: "restaurant", city: "Zürich" },
      price: 12.5,
      priceUnit: "glass",
      currency: "AED",
      occasion: "Geburtstag",
      companions: "Marc",
      note: "Sehr fein",
    },
    personId: null,
    source: "app",
    wantToBuy: true,
    ratings: [{ personId: M, rating: 4.5 }],
  });
  assert.deepEqual(editsFromForm(form({ ...base, year: "2019", currency: "USD" })), { error: "Währung: CHF, AED, EUR." });
  assert.deepEqual(editsFromForm(form({ kind: "wantToBuy", wineId: W, value: "1" })), [{ kind: "wantToBuy", wineId: W, value: true }]);
});

let first: string;

test("Erfassen: Vorschau, neuer Ort, Bewertungen mit encounter_id und Datum des Eintrags, Merker", async () => {
  const edit: Edit = {
    kind: "addEncounter",
    wine: { wineId: W },
    year: 2019,
    set: { tastedOn: "2026-10-20", place: { name: "Wirtschaft Neumarkt", kind: "restaurant", city: "Zürich" }, price: 12.5, priceUnit: "glass", currency: "AED", occasion: "Geburtstag" },
    personId: M,
    source: "app",
    wantToBuy: true,
    ratings: [{ personId: M, rating: 4.5 }, { personId: S, rating: 4 }],
  };
  const prepared = await prepareEdit(db, edit);
  assert.ok(prepared.ok);
  assert.equal(prepared.preview.title, "Vega Sicilia – Pintia 2019");
  assert.deepEqual(
    prepared.preview.changes.map((c) => `${c.label}: ${c.after}`),
    [
      "Jahrgang: 2019",
      `Verkostet am: ${formatDate("2026-10-20")}`,
      "Ort: Wirtschaft Neumarkt (Restaurant, Zürich) (neu)",
      `Preis: ${encounterPrice({ price: 12.5, price_unit: "glass", currency: "AED" })}`,
      "Anlass: Geburtstag",
      "Kaufen?: ja",
      `Bewertung Michel: ${star(4.5)}`,
      `Bewertung Sara: ${star(4)}`,
    ],
  );
  assert.equal(encounters().length, 0, "Vorschau ändert nichts");

  const result = await applyEdit(db, edit);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.wineId, W);
  assert.match(result.message, /^Vega Sicilia – Pintia 2019 als verkostet am .* gespeichert mit 2 Bewertungen\.$/);
  const e = encounters()[0];
  first = String(e.id);
  const place = net.tables.places.find((p) => p.name === "Wirtschaft Neumarkt")!;
  assert.deepEqual(
    [e.wine_id, e.vintage_year, e.tasted_on, e.place_id, e.price, e.price_unit, e.currency, e.occasion, e.person_id, e.source],
    [W, 2019, "2026-10-20", place.id, 12.5, "glass", "AED", "Geburtstag", M, "app"],
  );
  assert.deepEqual([place.kind, place.city], ["restaurant", "Zürich"]);
  assert.deepEqual(
    ratings().map((r) => [r.person_id, r.rating, r.encounter_id, r.rated_at, r.vintage_year, r.source]),
    [[M, 4.5, first, "2026-10-20", 2019, "manual"], [S, 4, first, "2026-10-20", 2019, "manual"]],
  );
  assert.equal(wine().want_to_buy, true, "Merker gesetzt");
});

test("Erfassen: neuer Wein; gleicher Name + Produzent und gleichnamiger Ort werden wiederverwendet; NV", async () => {
  const fresh = await applyEdit(db, {
    kind: "addEncounter",
    wine: { new: { name: "Alion", producer: "Vega Sicilia", type: "red", country: "Spanien" } },
    year: null,
    set: { place: { placeId: P1 } },
    personId: S,
    source: "app",
  });
  assert.ok(fresh.ok);
  const alion = net.tables.wines.find((w) => w.name === "Alion")!;
  assert.equal(fresh.wineId, alion.id, "die neue Wein-ID kommt zurück");
  assert.deepEqual([alion.type, alion.country, alion.want_to_buy], ["red", "Spanien", false]);
  const e = encounters().at(-1)!;
  assert.deepEqual([e.vintage_year, e.tasted_on, e.place_id, e.price_unit, e.currency], [null, today, P1, null, "CHF"], "Standard: heute, CHF");

  const winesBefore = net.tables.wines.length;
  const placesBefore = net.tables.places.length;
  const again: Edit = {
    kind: "addEncounter",
    wine: { new: { name: "pintia", producer: "VEGA SICILIA" } },
    year: 2016,
    set: { place: { name: "kronenhalle", kind: "bar", city: null } },
    personId: M,
    source: "app",
  };
  const prepared = await prepareEdit(db, again);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.preview.notes, [
    "Den Wein „Vega Sicilia – Pintia“ gibt es schon – ich hänge den Eintrag dort an.",
    "Den Ort „Kronenhalle“ gibt es schon – ich nehme ihn.",
  ]);
  const result = await applyEdit(db, again);
  assert.ok(result.ok);
  assert.equal(result.wineId, W);
  assert.equal(net.tables.wines.length, winesBefore, "kein doppelter Wein");
  assert.equal(net.tables.places.length, placesBefore, "kein doppelter Ort");
  assert.equal(encounters().at(-1)!.place_id, P1);
});

test("Prüfungen: Zukunft, Bewertung, Preis, unbekannter Wein/Ort, neuer Wein ohne Namen", async () => {
  const base = { kind: "addEncounter" as const, wine: { wineId: W }, year: 2019, personId: M, source: "app" as const };
  const err = async (edit: Edit) => {
    const r = await prepareEdit(db, edit);
    return r.ok ? null : r.error;
  };
  assert.equal(await err({ ...base, set: { tastedOn: "2999-01-01" } }), "Verkostet am: darf nicht in der Zukunft liegen.");
  assert.equal(await err({ ...base, set: {}, ratings: [{ personId: M, rating: 4.3 }] }), "Bewertung: 0–5 Sterne in halben Schritten.");
  assert.equal(await err({ ...base, set: { price: -1 } }), "Preis: ungültiger Preis.");
  assert.equal(await err({ ...base, year: 1700, set: {} }), `Jahrgang: bitte eine Jahreszahl zwischen 1800 und ${Number(today.slice(0, 4)) + 1}.`);
  assert.equal(await err({ ...base, wine: { wineId: "99999999-9999-4999-8999-999999999999" }, set: {} }), "Diesen Wein gibt es nicht mehr.");
  assert.equal(await err({ ...base, set: { place: { placeId: "99999999-9999-4999-8999-999999999999" } } }), "Diesen Ort gibt es nicht mehr.");
  assert.equal(await err({ ...base, wine: { new: { name: " ", producer: "X" } }, set: {} }), "Bitte den Namen des Weins angeben.");
});

test("Bearbeiten: Jahrgang, Ort, Preis; Bewertungen des Eintrags ändern bzw. löschen", async () => {
  const edit: Edit = {
    kind: "encounter",
    encounterId: first,
    set: { year: 2018, place: { placeId: P1 }, price: null },
    ratings: [{ personId: M, rating: 3 }, { personId: S, rating: null }],
  };
  const prepared = await prepareEdit(db, edit);
  assert.ok(prepared.ok);
  assert.deepEqual(
    prepared.preview.changes.map((c) => [c.label, c.before, c.after]),
    [
      ["Jahrgang", "2019", "2018"],
      ["Ort", "Wirtschaft Neumarkt (Restaurant, Zürich)", "Kronenhalle (Restaurant, Zürich)"],
      ["Preis", encounterPrice({ price: 12.5, price_unit: "glass", currency: "AED" }), "–"],
      ["Bewertung Michel", star(4.5), star(3)],
      ["Bewertung Sara", star(4), "gelöscht"],
    ],
  );
  const result = await applyEdit(db, edit);
  assert.ok(result.ok);
  const e = encounters().find((x) => x.id === first)!;
  assert.deepEqual([e.vintage_year, e.place_id, e.price, e.price_unit], [2018, P1, null, null]);
  const mine = ratings().filter((r) => r.encounter_id === first);
  assert.deepEqual(mine.map((r) => [r.person_id, r.rating, r.vintage_year]), [[M, 3, 2018]], "Jahrgang gilt auch für die Bewertung");
  assert.deepEqual(await applyEdit(db, edit), { ok: false, error: NOTHING });
});

test("Weinseite: alle Einträge neuester zuerst mit Ort, Bewertungen und WSET; nur verkostete Jahrgänge wählbar", async () => {
  net.tables.wine_tastings.push({ id: "t1", encounter_id: first, quality_level: "sehr gut", quality_points: 3.5, person_id: M });
  const list = await loadWineEncounters(db, W);
  assert.deepEqual(list.map((e) => e.tastedOn), [today, "2026-10-20"].sort().reverse());
  const e = list.find((x) => x.id === first)!;
  assert.equal(placeLabel(e.place), "Kronenhalle (Restaurant, Zürich)");
  assert.deepEqual(e.ratings, [{ personId: M, name: "Michel", rating: 3 }]);
  assert.deepEqual(e.tastings, [{ id: "t1", quality: "sehr gut", points: 3.5, person: "Michel" }]);

  const options = withTastedYears(vintageOptions([{ inventory_item_id: "i", vintage_year: 2019, status: "sealed", quantity: 2, drunk_at: null }]), [2016, 2018, 2019, null]);
  assert.deepEqual(options.map((o) => [o.year, o.sealed, Boolean(o.tastedOnly)]), [[2016, 0, true], [2018, 0, true], [2019, 2, false], [null, 0, true]]);
});

test("WSET aus einem Eintrag: ohne Flasche, mit encounter_id", () => {
  const row = tastingRow({ item: { id: null, wine_id: W, vintage_year: 2018 }, encounterId: first, personId: M, sat: {}, today, source: "app" });
  assert.deepEqual([row.inventory_item_id, row.encounter_id, row.wine_id, row.vintage_year], [null, first, W, 2018]);
  const fromBottle = tastingRow({ item: { id: "i", wine_id: W, vintage_year: 2019 }, personId: M, sat: {}, today, source: "app" });
  assert.equal("encounter_id" in fromBottle, false, "Flaschen-Verkostungen bleiben wie bisher");
});

test("Löschen: Eintrag samt seinen Bewertungen; WSET-Verkostung bleibt", async () => {
  const prepared = await prepareEdit(db, { kind: "deleteEncounter", encounterId: first });
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.preview.notes, [
    "Wird endgültig gelöscht – samt 1 Bewertung dieses Eintrags.",
    "Die WSET-Verkostung bleibt erhalten (ohne Eintrag).",
  ]);
  assert.ok((await applyEdit(db, { kind: "deleteEncounter", encounterId: first })).ok);
  assert.equal(encounters().some((e) => e.id === first), false);
  assert.equal(ratings().some((r) => r.encounter_id === first), false);
  assert.equal(net.tables.wine_tastings.length, 1);
});

test("Merker „Kaufen?“: umschalten, unverändert → nichts zu tun", async () => {
  assert.equal(wine().want_to_buy, true);
  const off = await applyEdit(db, { kind: "wantToBuy", wineId: W, value: false });
  assert.deepEqual(off.ok && off.message, "Den Merker „Kaufen?“ entfernt.");
  assert.equal(wine().want_to_buy, false);
  assert.deepEqual(await applyEdit(db, { kind: "wantToBuy", wineId: W, value: false }), { ok: false, error: NOTHING });
  assert.ok((await applyEdit(db, { kind: "wantToBuy", wineId: W, value: true })).ok);
  assert.equal(wine().want_to_buy, true);
});

test("Liste: ein Eintrag pro Wein, Kacheln, Gruppierungen Ort / Verkostet am / Kaufen? / Preisklasse", () => {
  const wines = new Map<string, TastedWineInfo>([
    ["a", { id: "a", name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", type: "red", want_to_buy: true }],
    ["b", { id: "b", name: "Chablis", producer: "Fèvre", country: "Frankreich", region: null, type: "white", want_to_buy: false }],
  ]);
  const enc = (id: string, wine_id: string, tasted_on: string, place: string | null, price: number | null, unit: string | null, currency = "CHF", year: number | null = 2019): EncounterRow =>
    ({ id, wine_id, vintage_year: year, tasted_on, price, price_unit: unit, currency, created_at: `${tasted_on}T12:00:00Z`, place: place ? { name: place } : null });
  const rows = [
    enc("1", "a", "2026-10-20", "Kronenhalle", 80, "bottle"),
    enc("2", "a", "2025-05-01", "Weingut Pintia", 15, "glass", "CHF", 2016),
    enc("3", "b", "2026-03-01", "Kronenhalle", 45, "bottle", "EUR", 2022),
  ];
  const entries = buildTastedEntries(
    rows,
    wines,
    new Map([["a", ["Tinta de Toro"]]]),
    new Map([["a", [{ wine_id: "a", person_name: "Sara", rating: 4.5, rated_at: "2026-10-20" }, { wine_id: "a", person_name: "Michel", rating: 4, rated_at: "2026-10-20" }]]]),
    new Map([["a", 3]]),
    ["Michel", "Sara"],
  );
  assert.deepEqual(entries.map((e) => e.wine_id), ["a", "b"], "zuletzt verkostet zuerst");
  const a = entries[0];
  assert.deepEqual([a.count, a.lastTasted, a.lastPlace, a.latestVintage, a.vintages, a.inStock, a.wantToBuy], [2, "2026-10-20", "Kronenhalle", 2019, [2016, 2019], 3, true]);
  assert.deepEqual(a.ratings, [{ person: "Michel", rating: 4 }, { person: "Sara", rating: 4.5 }]);
  assert.equal(entries[1].inStock, 0);

  const t = tastedTotals(entries, "2026");
  assert.deepEqual([t.thisYear, t.thisYearWines, t.total, t.toBuy.map((e) => e.wine_id)], [2, 2, 3, ["a"]]);

  assert.deepEqual(TASTED_GROUPINGS, ["typ", "land", "rebsorte", "jahrgang", "preis", "ort", "verkostet", "kaufen"]);
  const summary = (by: Parameters<typeof groupWines>[1]) => groupWines(entries, by).map((g) => [g.label, g.bottles, g.items.map((i) => i.wine.wine_id).join()]);
  assert.deepEqual(summary("ort"), [["Kronenhalle", 2, "a,b"], ["Weingut Pintia", 1, "a"]]);
  assert.deepEqual(summary("verkostet"), [["2026", 2, "a,b"], ["2025", 1, "a"]]);
  assert.deepEqual(groupWines(entries, "verkostet")[0].sections!.map((s) => s.label), ["Oktober", "März"]);
  assert.deepEqual(summary("kaufen"), [["🛒 Kaufen?", 2, "a"], ["Ohne Merker", 1, "b"]]);
  // Preisklasse nur für Flaschenpreise in CHF: Glas und EUR → „Ohne Preis“
  assert.deepEqual(summary("preis"), [["60–100 CHF", 1, "a"], ["Ohne Preis", 2, "a,b"]]);
});
