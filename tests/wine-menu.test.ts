// Wein-Menü im Bot: Callback-Format (≤ 64 Bytes, eindeutig gegenüber Chat/Erfassung), Listen
// (Offen, Bestand nach Typ, Trinkreif), offene Flasche (Gläser, Füllstand, Ausgetrunken,
// Bewerten), Öffnen mit Chargenwahl. Supabase als Fake im Speicher.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import {
  decodeMenu, encodeMenu, formatStars, isMenuCallback, menuKeyFor, shortNames, typeCode, type MenuAction,
} from "@/lib/chat/menu-view";
import { isChatCallback } from "@/lib/chat/proposals";
import { parseCallbackData } from "@/lib/ingest/messages";
import { screenFor } from "@/lib/chat/menu";
import { currentYear } from "@/lib/cellar/overview";

const Y = currentYear();

const W1 = "11111111-1111-4111-8111-111111111111"; // Palermo (rot), offen + 2 Chargen
const W2 = "22222222-2222-4222-8222-222222222222"; // Chardonnay (weiss), 2 Jahrgänge
const W3 = "33333333-3333-4333-8333-333333333333"; // "Cabernet Sauvignon" Produzent A
const W4 = "44444444-4444-4444-8444-444444444444"; // "Cabernet Sauvignon" Produzent B
const I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // offen, Palermo 2022
const B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // Charge Palermo Keller
const B2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Charge Palermo Wohnzimmer
const NEW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PM = "86c222d0-3a8c-4d5f-9564-f5654769ecd6", PS = "c7690541-4e68-4051-aa8f-6a2920fea55b";

const subjects = [{ kind: "item", itemId: I1 } as const, { kind: "vintage", wineId: W1, year: 2022 } as const, { kind: "vintage", wineId: W1, year: null } as const];
const lists = [{ kind: "open" }, { kind: "ready" }, { kind: "stock" }, { kind: "type", code: "y" }, { kind: "none" }] as const;
const actions: MenuAction[] = [];
for (const back of lists) {
  actions.push({ op: "list", list: back, offset: 0 }, { op: "list", list: back, offset: 16 });
  actions.push({ op: "wine", wineId: W1, back }, { op: "vintage", wineId: W1, year: 2022, back }, { op: "vintage", wineId: W1, year: null, back });
  actions.push({ op: "item", itemId: I1, back }, { op: "glasses", itemId: I1, glasses: 2, back }, { op: "fillPicker", itemId: I1, back });
  actions.push({ op: "fill", itemId: I1, percent: 100, back }, { op: "drunkAsk", itemId: I1, back }, { op: "drunk", itemId: I1, back });
  actions.push({ op: "open", wineId: W1, year: null, back }, { op: "openBatch", batchId: B1, back });
  for (const subject of subjects) {
    actions.push({ op: "ratePicker", subject, personKey: "c7690541", back });
    actions.push({ op: "rate", subject, personKey: "c7690541", rating: 4.5, back });
  }
}
test("Callback-Format: ≤ 64 Bytes, umkehrbar, keine Kollision mit Chat/Erfassung", () => {
for (const a of actions) {
  const data = encodeMenu(a);
  assert.ok(Buffer.byteLength(data) <= 64, data);
  assert.ok(isMenuCallback(data), data);
  assert.ok(!isChatCallback(data), data);
  assert.equal(parseCallbackData(data), null, data);
  assert.deepEqual(decodeMenu(data), a, data);
}
for (const bad of ["L:x", "O:" + I1, "G:" + I1 + ":9:o", "S:o" + I1 + ":c7690541:11:o", "P:" + I1 + ":101:o", "V:" + W1 + ":1700:o", "save:" + I1, "cf:" + I1 + ":50"]) {
  assert.equal(decodeMenu(bad), null, bad);
}
assert.equal(formatStars(4.5), "4½"); assert.equal(formatStars(1), "1"); assert.equal(formatStars(0.5), "½");
assert.equal(menuKeyFor("🍷 Offen"), "open"); assert.equal(menuKeyFor("📷 Neuer Wein"), "newWine"); assert.equal(menuKeyFor("Offen"), null);
assert.equal(typeCode("fortified"), "y"); assert.equal(typeCode(null), "u");
assert.deepEqual(
  shortNames([
    { producer: "A", name: "Cab", year: 2021, room: "K" }, { producer: "B", name: "Cab", year: 2021, room: "K" },
    { producer: "C", name: "X", year: 2020, room: "K" }, { producer: "C", name: "X", year: 2020, room: "W" },
    { producer: "D", name: "Y", year: 2019, room: null },
  ]),
  ["A Cab 2021", "B Cab 2021", "C X 2020 · K", "C X 2020 · W", "Y 2019"],
);
});

const loc = (room: string, sealed: number, open = 0) => ({ storage_house: "Zuhause", storage_room: room, sealed, open });
const tables = {
  persons: [{ id: PM, name: "Michel", sort_order: 0 }, { id: PS, name: "Sara", sort_order: 1 }],
  wines: [
    { id: W1, producer: "Tasca", name: "Palermo", type: "red" },
    { id: W2, producer: "Rombauer", name: "Chardonnay", type: "white" },
    { id: W3, producer: "Mondavi", name: "Cabernet Sauvignon", type: "red" },
    { id: W4, producer: "Lewis", name: "Cabernet Sauvignon", type: "red" },
  ],
  cellar_wine_summary: [
    { wine_id: W1, name: "Palermo", producer: "Tasca", country: "Italien", region: "Sizilien", type: "red", grapes: ["Nero d'Avola"] },
    { wine_id: W2, name: "Chardonnay", producer: "Rombauer", country: "USA", region: "California", type: "white", grapes: ["Chardonnay"] },
    { wine_id: W3, name: "Cabernet Sauvignon", producer: "Mondavi", country: "USA", region: null, type: "red", grapes: [] },
    { wine_id: W4, name: "Cabernet Sauvignon", producer: "Lewis", country: "USA", region: null, type: "red", grapes: [] },
  ],
  cellar_wines: [
    { wine_id: W1, vintage_year: 2022, bottle_size_ml: 750, avg_price: 20, price_class: "bis 30", drink_status: "ready", drink_from_year: Y - 2, drink_until_year: Y + 2, locations: [loc("Weinkeller", 3), loc("Wohnzimmer", 1, 1)], sealed_bottles: 4, open_bottles: 1, name: "Palermo", producer: "Tasca", type: "red" },
    { wine_id: W2, vintage_year: 2022, bottle_size_ml: 750, avg_price: 36, price_class: "30–60", drink_status: "unknown", drink_from_year: null, drink_until_year: null, locations: [loc("Weinkeller", 5)], sealed_bottles: 5, open_bottles: 0, name: "Chardonnay", producer: "Rombauer", type: "white" },
    { wine_id: W2, vintage_year: 2023, bottle_size_ml: 750, avg_price: 36, price_class: "30–60", drink_status: "unknown", drink_from_year: null, drink_until_year: null, locations: [loc("Weinkeller", 6)], sealed_bottles: 6, open_bottles: 0, name: "Chardonnay", producer: "Rombauer", type: "white" },
    { wine_id: W3, vintage_year: 2021, bottle_size_ml: 750, avg_price: 33, price_class: "30–60", drink_status: "unknown", locations: [loc("Weinkeller", 6)], sealed_bottles: 6, open_bottles: 0, name: "Cabernet Sauvignon", producer: "Mondavi", type: "red" },
    { wine_id: W4, vintage_year: 2020, bottle_size_ml: 750, avg_price: 135, price_class: "100–200", drink_status: "unknown", locations: [loc("Wohnzimmer", 1)], sealed_bottles: 1, open_bottles: 0, name: "Cabernet Sauvignon", producer: "Lewis", type: "red" },
  ],
  cellar_overview: [
    { inventory_item_id: I1, wine_id: W1, producer: "Tasca", name: "Palermo", vintage_year: 2022, type: "red", status: "open", fill_level_percent: 50, date_opened: "2026-03-25", bottle_size_ml: 750, storage_room: "Wohnzimmer" },
  ],
  inventory_items: [
    { id: I1, wine_id: W1, vintage_year: 2022, status: "open", quantity: 1, bottle_size_ml: 750, storage_room: "Wohnzimmer", storage_house: "Zuhause" },
    { id: B1, wine_id: W1, vintage_year: 2022, status: "sealed", quantity: 3, bottle_size_ml: 750, storage_room: "Weinkeller", storage_house: "Zuhause", purchased_at: "2025-01-01" },
    { id: B2, wine_id: W1, vintage_year: 2022, status: "sealed", quantity: 1, bottle_size_ml: 750, storage_room: "Wohnzimmer", storage_house: "Zuhause", purchased_at: "2025-02-01" },
  ],
  open_bottle_details: [{ inventory_item_id: I1, fill_level_percent: 50 }],
  latest_wine_ratings: [{ wine_id: W1, vintage_year: 2022, person_id: PS, rating: 4.5 }],
  wine_ratings: [] as Record<string, unknown>[],
};
const opened: unknown[] = [];
const db = fakeDb(tables, {
  open_bottle: (args) => {
    opened.push(args);
    tables.cellar_overview.push({ inventory_item_id: NEW, wine_id: W1, producer: "Tasca", name: "Palermo", vintage_year: 2022, type: "red", status: "open", fill_level_percent: 100, date_opened: "2026-10-27", bottle_size_ml: 750, storage_room: "Weinkeller" });
    return NEW;
  },
}) as never;

const show = async (a: MenuAction) => {
  const { screen, toast } = await screenFor(db, a, { chatId: 1 });
  for (const row of screen.keyboard.inline_keyboard) for (const b of row) {
    if ("callback_data" in b) { assert.ok(Buffer.byteLength(b.callback_data) <= 64); assert.ok(decodeMenu(b.callback_data), b.callback_data); }
  }
  void toast;
  return screen;
};
const texts = (s: Awaited<ReturnType<typeof show>>) => s.keyboard.inline_keyboard.flat().map((b) => b.text);

let s: Awaited<ReturnType<typeof show>>;

test("Offen-Liste: Lagerort nur, wenn nötig", async () => {
s = await show({ op: "list", list: { kind: "open" }, offset: 0 });
assert.match(s.text, /🍷 Palermo 2022 · 50 % · seit \d+ T\./);
assert.ok(!s.text.includes("Wohnzimmer"), "Lagerort nicht nötig");
});

test("offene Flasche: Knöpfe, Gläser, Füllstand, Bewerten", async () => {
s = await show({ op: "item", itemId: I1, back: { kind: "open" } });
assert.deepEqual(texts(s), ["🥃 1 Glas", "🥃🥃 2 Gläser", "Füllstand %", "✅ Ausgetrunken", "⭐ Bewertung Michel", "⭐ Bewertung Sara", "📝 Verkostung", "ℹ️ Details", "📷 Foto", "✏️ Bearbeiten", "📱 In der App öffnen", "‹ Zurück"]);
assert.match(s.text, /Sara 4½ ★/);

s = await show({ op: "glasses", itemId: I1, glasses: 1, back: { kind: "open" } });
assert.match(s.text, /1 Glas: 50 % → 30 %/);
assert.equal(tables.open_bottle_details[0].fill_level_percent, 30);
s = await show({ op: "glasses", itemId: I1, glasses: 2, back: { kind: "open" } });
assert.match(s.text, /leer/); assert.equal(tables.open_bottle_details[0].fill_level_percent, 30, "leer → erst nachfragen");
assert.deepEqual(texts(s), ["✅ Ja, ausgetrunken", "‹ Zurück"]);
s = await show({ op: "fillPicker", itemId: I1, back: { kind: "open" } });
assert.equal(texts(s).length, 10);
s = await show({ op: "fill", itemId: I1, percent: 60, back: { kind: "open" } });
assert.equal(tables.open_bottle_details[0].fill_level_percent, 60);
s = await show({ op: "ratePicker", subject: { kind: "item", itemId: I1 }, personKey: "86c222d0", back: { kind: "open" } });
assert.match(s.text, /Bewertung von Michel/); assert.equal(texts(s).length, 10);
s = await show({ op: "rate", subject: { kind: "item", itemId: I1 }, personKey: "86c222d0", rating: 4, back: { kind: "open" } });
assert.equal(tables.wine_ratings.length, 1); assert.equal(tables.wine_ratings[0].rating, 4); assert.equal(tables.wine_ratings[0].vintage_year, 2022);
});

test("Bestand: Typen, gleiche Namen mit Produzent, Jahrgangswahl, Öffnen mit Chargenwahl", async () => {
s = await show({ op: "list", list: { kind: "stock" }, offset: 0 });
assert.deepEqual(texts(s), ["🍷 Rot (11)", "🥂 Weiss (11)"]);
s = await show({ op: "list", list: { kind: "type", code: "r" }, offset: 0 });
assert.ok(s.text.includes("Lewis Cabernet Sauvignon") && s.text.includes("Mondavi Cabernet Sauvignon"), "gleiche Namen mit Produzent");
s = await show({ op: "list", list: { kind: "type", code: "w" }, offset: 0 });
assert.match(s.text, /🥂 Chardonnay 2022 · 2023 · 11 Fl\./);
s = await show({ op: "wine", wineId: W2, back: { kind: "type", code: "w" } });
assert.deepEqual(texts(s), ["2022 · 5 Fl.", "2023 · 6 Fl.", "‹ Zurück"]);
s = await show({ op: "wine", wineId: W1, back: { kind: "type", code: "r" } });
assert.ok(texts(s).includes("🍾 Öffnen"));
s = await show({ op: "open", wineId: W1, year: 2022, back: { kind: "type", code: "r" } });
assert.deepEqual(texts(s), ["Weinkeller (3)", "Wohnzimmer (1)", "‹ Zurück"]);
assert.equal(opened.length, 0, "bei mehreren Orten erst wählen");
s = await show({ op: "openBatch", batchId: B1, back: { kind: "type", code: "r" } });
assert.equal(opened.length, 1); assert.match(s.text, /Geöffnet/);
});

test("Trinkreif und Ausgetrunken", async () => {
s = await show({ op: "list", list: { kind: "ready" }, offset: 0 });
assert.match(s.text, /✅ Trinkreif 4/);
assert.match(s.text, /✅ 🍷 Palermo 2022 · \d{4}–\d{4} · 4 Fl\./);
s = await show({ op: "drunk", itemId: I1, back: { kind: "open" } });
assert.match(s.text, /ausgetrunken/);
});
