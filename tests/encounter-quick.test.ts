// Verkostet schnell erfassen: Pflicht nur Name und Jahrgang, Wein ohne Produzent (Abgleich
// über den Namen, Auswahl bei mehreren), Reihenfolge des Formulars und „alles oder nichts“
// beim Speichern – inkl. des gemeldeten Falls (neuer Wein „aria“/„ff“). Produzent fehlt →
// wird weggelassen (Anzeige, Sortierung, Bot). Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { buildCellarWines, toSummaryWine } from "@/lib/cellar/overview";
import { shortNames, uniqueNames } from "@/lib/chat/menu-view";
import { NOTHING, applyEdit, prepareEdit } from "@/lib/edit/edit";
import { ENCOUNTER_MORE_FIELDS, ENCOUNTER_QUICK_FIELDS, ENCOUNTER_REQUIRED } from "@/lib/edit/encounter-form";
import { AMBIGUOUS_WINE, wineCandidates } from "@/lib/edit/encounters";
import { editsFromForm } from "@/lib/edit/form";
import type { Edit } from "@/lib/edit/types";
import { compareWineNames, todayIso, wineName } from "@/lib/format";
import { proposalMessage } from "@/lib/ingest/messages";
import { findWine, resolveWine } from "@/lib/ingest/wines";
import { createAdminClient } from "@/lib/supabase/admin";

const M = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const S = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const PINTIA = "11111111-1111-4111-8111-111111111111";
const net: Net = {
  tables: {
    persons: [{ id: M, name: "Michel", sort_order: 0 }, { id: S, name: "Sara", sort_order: 1 }],
    wines: [
      { id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", want_to_buy: false, grapes: [] },
      { id: "22222222-2222-4222-8222-222222222222", name: "Reserva", producer: "Muga", type: "red", want_to_buy: false, grapes: [] },
      { id: "33333333-3333-4333-8333-333333333333", name: "Reserva", producer: "La Rioja Alta", type: "red", want_to_buy: false, grapes: [] },
    ],
    places: [],
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
const count = (t: string) => net.tables[t].length;
const snapshot = () => ["wines", "places", "wine_encounters", "wine_ratings"].map(count);
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const quick = (fields: Record<string, string>) => editsFromForm(form({ kind: "addEncounter", wineMode: "new", ...fields }));

test("Formular: Reihenfolge Wein → Jahrgang → Bewertung → Notiz, Rest unter „Mehr Angaben“", () => {
  assert.deepEqual([...ENCOUNTER_QUICK_FIELDS], ["wine", "vintage", "ratings", "note"]);
  assert.deepEqual([...ENCOUNTER_MORE_FIELDS], ["producer", "type", "origin", "place", "price", "occasion", "companions", "wantToBuy", "date"]);
  assert.deepEqual([...ENCOUNTER_REQUIRED], ["name", "vintage"]);
});

test("Pflicht nur Name und Jahrgang: ohne alles andere gespeichert (Datum heute, CHF, ohne Ort/Produzent)", async () => {
  assert.deepEqual(quick({ newName: "Aria" }), { error: "Jahrgang fehlt – Jahreszahl eintragen oder „Ohne Jahrgang (NV)“ wählen." });
  const [noName] = quick({ newName: "", year: "2020" }) as Edit[];
  assert.equal(((await prepareEdit(db, noName)) as { error: string }).error, "Bitte den Namen des Weins angeben.");

  const [edit] = quick({ newName: "Aria", year: "2020" }) as Edit[];
  const result = await applyEdit(db, { ...(edit as Extract<Edit, { kind: "addEncounter" }>), personId: M });
  assert.ok(result.ok, JSON.stringify(result));
  const wine = net.tables.wines.find((w) => w.name === "Aria")!;
  assert.deepEqual([wine.producer, wine.type, wine.country, wine.want_to_buy], [null, null, null, false], "Produzent darf fehlen");
  assert.equal(result.wineId, wine.id);
  assert.match(result.message, /^Aria 2020 als verkostet am .* gespeichert\.$/, "ohne Produzent kein „–“");
  const e = net.tables.wine_encounters.at(-1)!;
  assert.deepEqual([e.wine_id, e.vintage_year, e.tasted_on, e.place_id, e.price, e.price_unit, e.currency, e.note], [wine.id, 2020, today, null, null, null, "CHF", null]);

  const [nv] = quick({ newName: "Aria", nv: "on", [`rating:${M}`]: "4" }) as Edit[];
  assert.ok((await applyEdit(db, nv)).ok, "NV möglich; gleicher Name ohne Produzent → derselbe Wein");
  assert.equal(net.tables.wines.filter((w) => w.name === "Aria").length, 1);
  assert.deepEqual(
    net.tables.wine_ratings.map((r) => [r.wine_id, r.vintage_year, r.rating, r.encounter_id]),
    [[wine.id, null, 4, net.tables.wine_encounters.at(-1)!.id]],
  );
});

test("Wein ohne Produzent: Abgleich über den Namen – ein Treffer wird genommen, bei mehreren Auswahl", async () => {
  // Ein Treffer (auch wenn der bestehende Wein einen Produzenten hat)
  const pintia = await prepareEdit(db, { kind: "addEncounter", wine: { new: { name: "pintia" } }, year: 2019, set: {}, personId: M, source: "app" });
  assert.ok(pintia.ok);
  assert.equal(pintia.wineId, PINTIA);
  assert.deepEqual(pintia.preview.notes, ["Den Wein „Vega Sicilia – Pintia“ gibt es schon – ich hänge den Eintrag dort an."]);

  // Mehrere Treffer: nicht automatisch zuordnen, sondern Auswahl
  const before = snapshot();
  const reserva: Edit = { kind: "addEncounter", wine: { new: { name: "Reserva" } }, year: 2015, set: {}, personId: M, source: "app" };
  assert.deepEqual(await applyEdit(db, reserva), { ok: false, error: AMBIGUOUS_WINE });
  assert.deepEqual(snapshot(), before, "nichts gespeichert");
  assert.deepEqual((await wineCandidates(db, " reserva ")).map((c) => c.producer), ["La Rioja Alta", "Muga"]);

  // Mit Produzent: genau dieser; „Neuen Wein anlegen“ trotz gleichnamiger
  const muga = await prepareEdit(db, { ...reserva, wine: { new: { name: "Reserva", producer: "muga" } } });
  assert.equal(muga.ok && muga.wineId, "22222222-2222-4222-8222-222222222222");
  const fresh = await applyEdit(db, { ...reserva, wine: { new: { name: "Reserva", forceNew: true } } });
  assert.ok(fresh.ok);
  assert.equal(net.tables.wines.filter((w) => w.name === "Reserva").length, 3);
  assert.equal(net.tables.wines.find((w) => w.id === fresh.wineId)!.producer, null);
  assert.deepEqual(quick({ newName: "Reserva", year: "2015", forceNew: "1" }), [
    { kind: "addEncounter", wine: { new: { name: "Reserva", producer: null, type: null, country: null, region: null, forceNew: true } }, year: 2015, set: {}, personId: null, source: "app", wantToBuy: false, ratings: [] },
  ]);
});

test("Alles oder nichts – gemeldeter Fall: neuer Wein „aria“/„ff“, Eintrag schlägt fehl → nichts bleibt, klare Meldung, Log", async () => {
  const before = snapshot();
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  net.fail = (method, table) => (method === "POST" && table === "wine_encounters" ? { status: 400, body: { code: "23514", message: "check violation" } } : null);
  try {
    const [edit] = quick({
      newName: "aria",
      newProducer: "ff",
      year: "2021",
      place: "new",
      placeName: "Bar Neu",
      placeKind: "bar",
      [`rating:${M}`]: "4.5",
    }) as Edit[];
    const result = await applyEdit(db, { ...(edit as Extract<Edit, { kind: "addEncounter" }>), personId: M });
    assert.deepEqual(result, { ok: false, error: "Das hat leider nicht geklappt – ich habe nichts geändert." });
  } finally {
    net.fail = undefined;
    console.error = original;
  }
  assert.deepEqual(snapshot(), before, "kein Wein, kein Ort, kein Eintrag, keine Bewertung");
  assert.ok(!net.tables.wines.some((w) => w.name === "aria"));
  assert.ok(logged.some((args) => args[0] === "encounter save failed"), "Fehler im Log");
});

test("Alles oder nichts: Bewertung schlägt fehl → Eintrag, Ort und Wein werden zurückgenommen, Merker zurückgesetzt", async () => {
  const before = snapshot();
  const original = console.error;
  console.error = () => {};
  net.fail = (method, table) => (method === "POST" && table === "wine_ratings" ? { status: 500, body: { message: "boom" } } : null);
  try {
    const neu = await applyEdit(db, {
      kind: "addEncounter",
      wine: { new: { name: "Nuevo", producer: "Bodega X" } },
      year: 2022,
      set: { place: { name: "Weinbar Y", kind: "bar", city: null } },
      personId: M,
      source: "app",
      wantToBuy: true,
      ratings: [{ personId: M, rating: 4 }, { personId: S, rating: 3.5 }],
    });
    assert.equal(neu.ok, false);
    assert.deepEqual(snapshot(), before);

    // Bestehender Wein: Merker wird wieder entfernt
    const existing = await applyEdit(db, { kind: "addEncounter", wine: { wineId: PINTIA }, year: 2019, set: {}, personId: M, source: "app", wantToBuy: true, ratings: [{ personId: M, rating: 4 }] });
    assert.equal(existing.ok, false);
    assert.equal(net.tables.wines.find((w) => w.id === PINTIA)!.want_to_buy, false);
    assert.deepEqual(snapshot(), before);
  } finally {
    net.fail = undefined;
    console.error = original;
  }
});

test("Produzent fehlt: weggelassen in Anzeige und Bot, Sortierung nach Name, Wein bleibt in Listen", async () => {
  assert.equal(wineName({ producer: null, name: "Aria" }), "Aria");
  assert.equal(wineName({ producer: "Vega Sicilia", name: "Pintia" }), "Vega Sicilia – Pintia");
  const sorted = [{ producer: "Vega Sicilia", name: "Pintia" }, { producer: null, name: "Aria" }, { producer: "Muga", name: "Reserva" }].sort(compareWineNames);
  assert.deepEqual(sorted.map((w) => w.name), ["Aria", "Reserva", "Pintia"]);
  const summary = toSummaryWine({ wine_id: "w", name: "Aria", producer: null, country: null, region: null, type: null, grapes: [] });
  assert.ok(summary, "Wein ohne Produzent fällt nicht aus der Liste");
  const wines = buildCellarWines([summary!], [{ wine_id: "w", vintage_year: 2020, bottle_size_ml: 750, avg_price: null, price_class: null, drink_status: "unknown", drink_from_year: null, drink_until_year: null, locations: [{ storage_house: null, storage_room: "Weinkeller", sealed: 2, open: 0 }] }], null);
  assert.equal(wines.length, 1);
  assert.deepEqual(shortNames([{ producer: null, name: "Aria", year: 2020 }, { producer: null, name: "Aria", year: 2020, room: "W" }]), ["Aria 2020", "Aria 2020 · W"]);
  assert.deepEqual(uniqueNames([{ producer: null, name: "X" }, { producer: "P", name: "X" }]), ["X", "P X"]);
  const msg = proposalMessage(
    { step: "review", proposal: { name: "Aria", producer: null, vintage_year: 2020, country: null, region: null, appellation: null, type: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null }, recognition: { model: "text", confidence: 1, notes: null, enriched_fields: [], sources: [] } },
    false,
  );
  assert.match(msg, /^🍷 <b>Aria<\/b> 2020/);
  assert.doesNotMatch(msg, /Produzent unbekannt|Name und Produzent/);
});

test("Bot-Nachkauf ohne Produzent: Abgleich über eindeutigen Namen; Speichern ohne Produzent", async () => {
  assert.equal((await findWine(db, "PINTIA", null))?.id, PINTIA, "eindeutiger Name");
  assert.equal(await findWine(db, "Reserva", null), null, "mehrdeutig → kein Treffer");
  assert.equal((await findWine(db, "Reserva", "Muga"))?.id, "22222222-2222-4222-8222-222222222222");
  const id = await resolveWine(db, { name: "Solo", producer: null, vintage_year: 2020, country: null, region: null, appellation: null, type: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null }, null);
  assert.equal(net.tables.wines.find((w) => w.id === id)!.producer, null);
});

test("Weinseite ✏️: Produzent leeren bzw. ergänzen", async () => {
  const aria = net.tables.wines.find((w) => w.name === "Aria")!;
  const set = await applyEdit(db, { kind: "wine", wineId: String(aria.id), set: { producer: "Cantina Aria" } });
  assert.ok(set.ok);
  assert.equal(aria.producer, "Cantina Aria");
  assert.ok((await applyEdit(db, { kind: "wine", wineId: String(aria.id), set: { producer: null } })).ok);
  assert.equal(aria.producer, null);
  assert.deepEqual(await applyEdit(db, { kind: "wine", wineId: String(aria.id), set: { producer: null } }), { ok: false, error: NOTHING });
});
