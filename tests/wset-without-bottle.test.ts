// WSET-Bewertung ohne Flasche: speichern mit Flasche, mit Eintrag „Verkostet“ (ohne Flasche)
// und ohne beides; Bearbeiten hängt nichts um; Links und Knöpfe der App auch ohne Bestand.
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { storeTasting } from "@/lib/tasting/save";
import { encounterWsetHref, newWsetHref, preselectedPerson, tastingHref, wineWsetHref } from "@/lib/tasting/links";
import { newTastingData } from "@/lib/tasting/sat";

const W = "11111111-1111-4111-8111-111111111111";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PLACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const SARA = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const TODAY = "2026-11-19";

const wine = { id: W, name: "Abstract", producer: "Orin Swift", region: null, country: "USA", type: "red", grapes: [] };
const tables = () => ({
  wines: [wine],
  inventory_items: [{ id: ITEM, wine_id: W, vintage_year: 2021 }],
  wine_encounters: [{ id: ENC, wine_id: W, vintage_year: 2022, tasted_on: "2026-11-19", place_id: PLACE }],
  wine_tastings: [] as Record<string, unknown>[],
});
const sat = (date = TODAY, year: number | null = 2022) => newTastingData(wine, year, "", date);

test("WSET speichern a) mit Flasche: inventory_item_id gesetzt, ohne Eintrag", async () => {
  const t = tables();
  const db = fakeDb(t) as never;
  const r = await storeTasting(db, { target: { kind: "item", id: ITEM }, tastingId: null, personId: MICHEL, sat: sat(TODAY, 2021), today: TODAY });
  assert.ok(r.ok);
  const [row] = t.wine_tastings;
  assert.deepEqual([row.wine_id, row.vintage_year, row.inventory_item_id, row.encounter_id, row.place_id, row.person_id], [W, 2021, ITEM, undefined, undefined, MICHEL]);
});

test("WSET speichern b) aus einer Verkostung ohne Flasche: encounter_id, Ort, Jahrgang aus dem Eintrag", async () => {
  const t = tables();
  const db = fakeDb(t) as never;
  // Datum der Verkostung (vom Formular vorausgefüllt) wird tasted_at.
  const r = await storeTasting(db, { target: { kind: "encounter", id: ENC }, tastingId: null, personId: SARA, sat: sat("2026-11-19"), today: "2026-11-23" });
  assert.ok(r.ok);
  const [row] = t.wine_tastings;
  assert.deepEqual(
    [row.wine_id, row.vintage_year, row.inventory_item_id, row.encounter_id, row.place_id, row.person_id, row.tasted_at, row.source],
    [W, 2022, null, ENC, PLACE, SARA, "2026-11-19", "app"],
  );
});

test("WSET speichern c) ohne Flasche und ohne Verkostung: beide leer, Datum heute", async () => {
  const t = tables();
  const db = fakeDb(t) as never;
  const data = sat("");
  const r = await storeTasting(db, { target: { kind: "wine", id: W, year: 2022 }, tastingId: null, personId: MICHEL, sat: data, today: TODAY });
  assert.ok(r.ok);
  const [row] = t.wine_tastings;
  assert.deepEqual([row.wine_id, row.vintage_year, row.inventory_item_id, row.encounter_id, row.tasted_at], [W, 2022, null, undefined, TODAY]);
  // Wein ohne Jahrgang (NV) geht auch
  const nv = await storeTasting(db, { target: { kind: "wine", id: W, year: null }, tastingId: null, personId: MICHEL, sat: sat(TODAY, null), today: TODAY });
  assert.ok(nv.ok);
  assert.equal(t.wine_tastings[1].vintage_year, null);
});

test("WSET speichern: Pflicht sind Wein und Person; Bearbeiten hängt nichts um", async () => {
  const t = tables();
  const db = fakeDb(t) as never;
  assert.deepEqual(await storeTasting(db, { target: { kind: "wine", id: W, year: 2022 }, tastingId: null, personId: null, sat: sat(), today: TODAY }), { ok: false, error: "Bitte eine Person wählen." });
  const missing = await storeTasting(db, { target: { kind: "wine", id: "22222222-2222-4222-8222-222222222222", year: 2022 }, tastingId: null, personId: MICHEL, sat: sat(), today: TODAY });
  assert.equal(missing.ok, false);
  assert.equal(t.wine_tastings.length, 0);

  // Bewertung aus der Verkostung; später eingebuchte Flasche → Bearbeiten über die Flasche ändert die Zuordnung nicht.
  const r = await storeTasting(db, { target: { kind: "encounter", id: ENC }, tastingId: null, personId: SARA, sat: sat(), today: TODAY });
  assert.ok(r.ok);
  t.wine_tastings[0].id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const edited = await storeTasting(db, { target: { kind: "item", id: ITEM }, tastingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", personId: SARA, sat: sat(), today: TODAY });
  assert.ok(edited.ok);
  assert.equal(t.wine_tastings.length, 1, "nicht kopiert");
  const [row] = t.wine_tastings;
  assert.deepEqual([row.inventory_item_id, row.encounter_id, row.place_id, row.vintage_year], [null, ENC, PLACE, 2022], "nicht umgehängt");
});

test("Links: Start ohne Bestand, Bearbeiten je nach Zuordnung, Person aus dem Link", () => {
  assert.equal(newWsetHref(W, 2022, null), `/wein/${W}/wset?jahrgang=2022`);
  assert.equal(newWsetHref(W, null, undefined), `/wein/${W}/wset?jahrgang=ohne`);
  assert.equal(newWsetHref(W, 2021, ITEM), `/flasche/${ITEM}/verkostung`, "mit Flasche wie bisher");
  assert.equal(wineWsetHref(W, 2022, { free: true }), `/wein/${W}/wset?jahrgang=2022&frei=1`);
  assert.equal(encounterWsetHref(ENC, { personId: SARA }), `/verkostet/${ENC}/wset?person=${SARA}`);
  const base = { id: "t1", wine_id: W, vintage_year: 2022 };
  assert.equal(tastingHref({ ...base, inventory_item_id: null, encounter_id: ENC }), `/verkostet/${ENC}/wset?t=t1`);
  assert.equal(tastingHref({ ...base, inventory_item_id: ITEM, encounter_id: null }), `/flasche/${ITEM}/verkostung?t=t1`);
  assert.equal(tastingHref({ ...base, inventory_item_id: null, encounter_id: null }), `/wein/${W}/wset?jahrgang=2022&t=t1`);
  const persons = [{ id: MICHEL }, { id: SARA }];
  assert.equal(preselectedPerson(SARA, persons, MICHEL), SARA);
  assert.equal(preselectedPerson("xyz", persons, MICHEL), MICHEL);
  assert.equal(preselectedPerson(undefined, persons, null), null);
});

test("App: Knöpfe „WSET-Bewertung“ erscheinen auch ohne Bestand", () => {
  const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const page = read("app/(cellar)/wein/[id]/page.tsx");
  // Weinseite: Knopf ohne Bedingung auf eine Flasche (anchor), Ziel ohne Flasche über newWsetHref.
  const button = page.slice(page.indexOf('<h3 className="subsection-title">WSET</h3>'), page.indexOf("WSET-Bewertung\n"));
  assert.match(button, /newWsetHref\(wine\.id, year, anchor\?\.inventory_item_id\)/);
  assert.doesNotMatch(button, /\{anchor &&/);
  assert.doesNotMatch(page, /\/flasche\/\$\{tastingItem/, "kein Link auf eine fremde Flasche");
  // Verkostet: Knopf je Eintrag sichtbar (nicht nur im ✏️-Formular).
  const enc = read("app/(cellar)/wein/[id]/encounters.tsx");
  const visible = enc.slice(enc.indexOf("</EditUnit>") - 900, enc.indexOf("</EditUnit>"));
  assert.match(visible, /encounterWsetHref\(e\.id\)[\s\S]*📝 WSET-Bewertung/);
  assert.doesNotMatch(enc.slice(enc.indexOf("form={"), enc.indexOf("</>")), /wset/i);
  // Seite für Wein + Jahrgang ohne Flasche: Auswahl der Verkostungen (Datum + Ort) bzw. ohne.
  const wset = read("app/(cellar)/wein/[id]/wset/page.tsx");
  assert.match(wset, /Zu welcher Verkostung gehört die Bewertung\?/);
  assert.match(wset, /formatDate\(e\.tasted_on\)[\s\S]*e\.place\?\.name \?\? "ohne Ort"/);
  assert.match(wset, /target=\{\{ kind: "wine", id: wine\.id, year \}\}/);
});
