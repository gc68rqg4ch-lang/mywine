// „ℹ️ Details“ im Bot: alle Angaben eines Jahrgangs kompakt (Herkunft, Rebsorten, Trinkreife,
// Flaschen je Lagerort, offene Flasche, Preise mit Rabatt, Bewertungen, letzte Verkostung,
// Dokumente, Link zur App); leere Angaben fallen weg.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { wineDetailsText, type WineDetails } from "@/lib/chat/details";
import { screenFor } from "@/lib/chat/menu";
import { decodeMenu, encodeMenu } from "@/lib/chat/menu-view";

const W = "11111111-1111-4111-8111-111111111111", I = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M = "86c222d0-3a8c-4d5f-9564-f5654769ecd6", S = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const ov = (x: Record<string, unknown>) => ({ wine_id: W, vintage_year: 2019, producer: "Vega Sicilia", name: "Pintia", type: "red", quantity: 1, bottle_size_ml: 750, currency: "CHF", fill_level_percent: null, date_opened: null, purchase_price: 24.5, regular_price: 29.9, ...x });
const tables: Record<string, Record<string, unknown>[]> = {
  persons: [{ id: M, name: "Michel", sort_order: 0 }, { id: S, name: "Sara", sort_order: 1 }],
  wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: "DO Toro", alcohol_content: 14.5, grapes: ["Tinta de Toro"] }],
  wine_grape_shares: [{ wine_id: W, vintage_year: 2019, grape: "Tinta de Toro", percent: 100, sort_order: 0, source: "research" }],
  wine_vintages: [{ wine_id: W, vintage_year: 2019, drink_from_year: 2024, drink_until_year: 2032 }],
  cellar_overview: [
    ov({ inventory_item_id: "b1", status: "sealed", quantity: 6, storage_room: "Weinkeller" }),
    ov({ inventory_item_id: "b2", status: "sealed", quantity: 4, storage_room: "Wohnzimmer", purchase_price: 66 }),
    ov({ inventory_item_id: I, status: "open", storage_room: "Wohnzimmer", fill_level_percent: 50, date_opened: "2026-10-20" }),
  ],
  cellar_wines: [{ wine_id: W, vintage_year: 2019, sealed_bottles: 10, open_bottles: 1, drink_from_year: 2024, drink_until_year: 2032 }],
  latest_wine_ratings: [{ wine_id: W, vintage_year: 2019, person_id: S, rating: 4.5 }],
  wine_tastings: [
    { wine_id: W, vintage_year: 2019, tasted_at: "2026-01-01", quality_level: "gut", quality_points: 2, sat: {} },
    { wine_id: W, vintage_year: 2019, tasted_at: "2026-10-12", quality_level: "sehr gut", quality_points: 3.5, sat: {} },
  ],
};
const db = fakeDb(tables) as never;
const ctx = { chatId: 1, actor: { personId: M, name: "Michel" } };

test("Wein-Menü → ℹ️ Details: vollständige Angaben und Knöpfe", async () => {
  const menu = await screenFor(db, { op: "vintage", wineId: W, year: 2019, back: { kind: "none" } }, ctx);
  const detailsBtn = menu.screen.keyboard.inline_keyboard.flat().find((b) => b.text === "ℹ️ Details") as { callback_data: string };
  assert.ok(detailsBtn && Buffer.byteLength(detailsBtn.callback_data) <= 64);
  const action = decodeMenu(detailsBtn.callback_data)!;
  assert.equal(action.op, "details");
  assert.equal(encodeMenu(action), detailsBtn.callback_data);

  const { screen } = await screenFor(db, action, ctx);
  const t = screen.text.replace(/ /g, " ");
  assert.match(t, /^🍷 <b>Pintia 2019<\/b>\nVega Sicilia\n🇪🇸 Spanien · Toro · DO Toro\n🍇 Tinta de Toro \(?100 %\)? · 14.5 % vol/);
  assert.match(t, /⏳ Trinkreife 2024–2032/);
  assert.match(t, /📦 Weinkeller 6 · Wohnzimmer 4/);
  assert.match(t, /🍷 Offen: Wohnzimmer · 50 % · seit \d+ T\./);
  assert.match(t, /💰 Weinkeller: CHF 24.50 · normal CHF 29.90 · −18.1 %/);
  assert.match(t, /💰 Wohnzimmer: CHF 66.00 · normal CHF 29.90 · \+120.7 %/);
  assert.match(t, /⭐ Sara 4½/);
  assert.ok(!t.includes("Michel"), "unbewertete Person weglassen");
  assert.match(t, /📝 sehr gut · 3.5 \/ 4 Punkte/, "letzte Verkostung");
  assert.match(t, /<a href="https:\/\/mywine.example\/wein\/11111111-1111-4111-8111-111111111111\?jahrgang=2019">In der App öffnen<\/a>/);
  const labels = screen.keyboard.inline_keyboard.flat().map((b) => b.text);
  for (const l of ["🍾 Öffnen", "⭐ Bewerten", "📝 Verkostung", "ℹ️ Weniger"]) assert.ok(labels.includes(l), l);
});

test("Details ab einer offenen Flasche: Glas-Knöpfe bleiben", async () => {
  const { screen } = await screenFor(db, { op: "details", subject: { kind: "item", itemId: I }, back: { kind: "open" } }, ctx);
  assert.match(screen.text, /Pintia 2019/);
  assert.ok(screen.keyboard.inline_keyboard.flat().some((b) => b.text === "🥃 1 Glas"));
});

const empty = { status: "sealed", bottle_size_ml: 750, fill_level_percent: null, date_opened: null, purchase_price: null, regular_price: null, currency: null } as const;

test("leere Angaben fallen weg; gleicher Preis ohne Rabatt", () => {
  const minimal = wineDetailsText({
    name: "Hauswein", producer: "Unbekannt", type: null, year: null, country: null, region: null, appellation: null, alcohol: null,
    grapes: null, drinkFrom: null, drinkUntil: null, bottles: [{ ...empty, quantity: 2, storage_room: null }], ratings: [], lastTasting: null, appUrl: null,
  });
  assert.equal(minimal, "🍇 <b>Hauswein o. J.</b>\nUnbekannt\n📦 ohne Lagerort 2");
  const same = wineDetailsText({
    name: "X", producer: "Y", type: "white", year: 2020, country: null, region: null, appellation: null, alcohol: null, grapes: null,
    drinkFrom: 2025, drinkUntil: null, bottles: [{ ...empty, quantity: 1, storage_room: "Keller", purchase_price: 20, regular_price: 20, currency: "CHF" }],
    ratings: [], lastTasting: null, appUrl: null,
  });
  assert.match(same.replace(/ /g, " "), /⏳ Trinkreife ab 2025\n📦 Keller 1\n💰 CHF 20.00$/);
});

const base: WineDetails = {
  name: "Pintia", producer: "Vega Sicilia", type: "red", year: 2019, country: "Spanien", region: "Toro", appellation: null,
  alcohol: 14.5, grapes: null, drinkFrom: null, drinkUntil: null, bottles: [], ratings: [], lastTasting: null,
  appUrl: "https://mywine.example/wein/w?jahrgang=2019",
};

test("Dokumente: Anzahl mit Link, ohne Dokumente keine Zeile", () => {
  assert.match(wineDetailsText({ ...base, documents: ["a.pdf", "b.pdf"] }), /📎 2 Dokumente: a\.pdf, b\.pdf – <a href="https:\/\/mywine\.example\/wein\/w\?jahrgang=2019">auf der Weinseite<\/a>/);
  assert.match(wineDetailsText({ ...base, documents: ["2020-the-hype.pdf"] }), /📎 1 Dokument: 2020-the-hype\.pdf –/);
  assert.doesNotMatch(wineDetailsText({ ...base, documents: [] }), /📎/);
  assert.doesNotMatch(wineDetailsText(base), /📄/);
});
