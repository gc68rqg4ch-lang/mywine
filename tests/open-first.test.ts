// Offene Flasche zuerst (Wein): Die Wein-Ansicht im Bot zeigt je offene Flasche eine Taste ganz
// oben; „Öffnen“ fragt nach, wenn vom Wein schon eine offen ist (gleich welcher Jahrgang), mit
// „Zur offenen Flasche“. Dieselbe Prüfung (openBottlesOfWine) gilt im Chat-Vorschlag, nach dem
// Einbuchen und in der App. Supabase als Fake im Speicher.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { screenFor, savedWineKeyboard } from "@/lib/chat/menu";
import { decodeMenu, type MenuAction } from "@/lib/chat/menu-view";
import { chatTools } from "@/lib/chat/tools";
import { alreadyOpenQuestion, openBottlesOfWine, openNeedsConfirmation } from "@/lib/cellar/open-bottles";
import { CHAT_SYSTEM } from "@/lib/bot/chat-prompt";

const VASO = "11111111-1111-4111-8111-111111111111"; // offen 2021 + 1 Charge 2021
const NONE = "22222222-2222-4222-8222-222222222222"; // nichts offen
const OTHER = "33333333-3333-4333-8333-333333333333"; // offen 2019, Charge 2021
const OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN19 = "abababab-abab-4bab-8bab-abababababab";
const B_VASO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const B_NONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B_OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NEW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const opened: Row[] = [];
function reset() {
  opened.length = 0;
  const overview = (id: string, wine: string, name: string, year: number, status: string, extra: Row = {}) => ({
    inventory_item_id: id, wine_id: wine, producer: "P", name, vintage_year: year, type: "red", status, fill_level_percent: null, date_opened: null, bottle_size_ml: 750, storage_room: "Weinkeller", ...extra,
  });
  Object.assign(tables, {
    persons: [],
    wines: [
      { id: VASO, producer: "P", name: "VASO", type: "red" },
      { id: NONE, producer: "P", name: "Ohne", type: "red" },
      { id: OTHER, producer: "P", name: "Anders", type: "red" },
    ],
    cellar_wines: [
      { wine_id: VASO, vintage_year: 2021, sealed_bottles: 3, open_bottles: 1 },
      { wine_id: NONE, vintage_year: 2020, sealed_bottles: 2, open_bottles: 0 },
      { wine_id: OTHER, vintage_year: 2021, sealed_bottles: 2, open_bottles: 0 },
      { wine_id: OTHER, vintage_year: 2019, sealed_bottles: 0, open_bottles: 1 },
    ],
    cellar_overview: [
      overview(OPEN, VASO, "VASO", 2021, "open", { fill_level_percent: 60, date_opened: "2026-11-12", storage_room: "Wohnzimmer" }),
      overview(B_VASO, VASO, "VASO", 2021, "sealed"),
      overview(B_NONE, NONE, "Ohne", 2020, "sealed"),
      overview(OPEN19, OTHER, "Anders", 2019, "open", { fill_level_percent: 40, date_opened: "2026-11-01" }),
      overview(B_OTHER, OTHER, "Anders", 2021, "sealed"),
    ],
    inventory_items: [
      { id: OPEN, wine_id: VASO, vintage_year: 2021, status: "open", quantity: 1, bottle_size_ml: 750, storage_room: "Wohnzimmer", storage_house: "Zuhause" },
      { id: B_VASO, wine_id: VASO, vintage_year: 2021, status: "sealed", quantity: 3, bottle_size_ml: 750, storage_room: "Weinkeller", storage_house: "Zuhause", purchased_at: "2025-01-01" },
      { id: B_NONE, wine_id: NONE, vintage_year: 2020, status: "sealed", quantity: 2, bottle_size_ml: 750, storage_room: "Weinkeller", storage_house: "Zuhause", purchased_at: "2025-01-01" },
      { id: OPEN19, wine_id: OTHER, vintage_year: 2019, status: "open", quantity: 1, bottle_size_ml: 750, storage_room: "Weinkeller", storage_house: "Zuhause" },
      { id: B_OTHER, wine_id: OTHER, vintage_year: 2021, status: "sealed", quantity: 2, bottle_size_ml: 750, storage_room: "Weinkeller", storage_house: "Zuhause", purchased_at: "2025-01-01" },
    ],
    open_bottle_details: [{ inventory_item_id: OPEN, fill_level_percent: 60 }, { inventory_item_id: OPEN19, fill_level_percent: 40 }],
    latest_wine_ratings: [],
    wine_ratings: [],
  });
}
reset();
const db = fakeDb(tables, {
  open_bottle: (args) => {
    opened.push(args);
    const batch = tables.inventory_items.find((i) => i.id === args.p_item_id)!;
    tables.cellar_overview.push({ inventory_item_id: NEW, wine_id: batch.wine_id, producer: "P", name: "X", vintage_year: batch.vintage_year, type: "red", status: "open", fill_level_percent: 100, date_opened: "2026-11-12", bottle_size_ml: 750, storage_room: "Weinkeller" });
    return NEW;
  },
}) as never;

const show = async (a: MenuAction) => (await screenFor(db, a, { chatId: 1 })).screen;
const texts = (s: Awaited<ReturnType<typeof show>>) => s.keyboard.inline_keyboard.flat().map((b) => b.text);
const actionOf = (s: Awaited<ReturnType<typeof show>>, text: string) => {
  const b = s.keyboard.inline_keyboard.flat().find((x) => x.text === text);
  assert.ok(b && "callback_data" in b, `Knopf „${text}“ fehlt: ${texts(s).join(" | ")}`);
  return decodeMenu(b.callback_data)!;
};
const back = { kind: "type", code: "r" } as const;

test("Wein mit offener Flasche: Taste der offenen Flasche ganz oben, „Öffnen“ fragt nach, „Zur offenen Flasche“ → Flaschen-Bildschirm", async () => {
  reset();
  let s = await show({ op: "vintage", wineId: VASO, year: 2021, back });
  assert.deepEqual(texts(s).slice(0, 2), ["🍷 Offen · 60 % · seit 12.11.", "🍾 Öffnen"]);
  assert.deepEqual(actionOf(s, "🍷 Offen · 60 % · seit 12.11."), { op: "item", itemId: OPEN, back });

  s = await show(actionOf(s, "🍾 Öffnen"));
  assert.equal(opened.length, 0, "nicht still eine zweite Flasche öffnen");
  assert.match(s.text, /Von diesem Wein ist schon eine Flasche offen \(2021, 60 %\)\. Trotzdem eine weitere öffnen\?/);
  assert.deepEqual(texts(s), ["🍾 Ja, öffnen", "🍷 Zur offenen Flasche", "Abbrechen"]);

  const toOpen = await show(actionOf(s, "🍷 Zur offenen Flasche"));
  assert.deepEqual(texts(toOpen).slice(0, 4), ["🥃 1 Glas", "🥃🥃 2 Gläser", "Füllstand %", "✅ Ausgetrunken"]);
  assert.equal(opened.length, 0);

  const yes = await show(actionOf(s, "🍾 Ja, öffnen"));
  assert.deepEqual(opened.map((o) => o.p_item_id), [B_VASO], "erst nach „Ja, öffnen“");
  assert.match(yes.text, /Geöffnet/);
});

test("Wein ohne offene Flasche: Öffnen wie bisher, ohne Nachfrage", async () => {
  reset();
  let s = await show({ op: "vintage", wineId: NONE, year: 2020, back });
  assert.equal(texts(s)[0], "🍾 Öffnen", "keine Offen-Taste");
  s = await show(actionOf(s, "🍾 Öffnen"));
  assert.deepEqual(opened.map((o) => o.p_item_id), [B_NONE]);
  assert.match(s.text, /Geöffnet/);
});

test("Offene Flasche eines anderen Jahrgangs: Taste mit Jahrgang, Nachfrage nennt den Jahrgang", async () => {
  reset();
  let s = await show({ op: "vintage", wineId: OTHER, year: 2021, back });
  assert.deepEqual(texts(s).slice(0, 2), ["🍷 Offen · 2019 · 40 % · seit 01.11.", "🍾 Öffnen"]);
  s = await show(actionOf(s, "🍾 Öffnen"));
  assert.equal(opened.length, 0);
  assert.match(s.text, /schon eine Flasche offen \(2019, 40 %\)/);
  assert.deepEqual(actionOf(s, "🍷 Zur offenen Flasche"), { op: "item", itemId: OPEN19, back });
});

test("Nach dem Einbuchen: mit offener Flasche keine direkte „Öffnen“-Taste der Charge", async () => {
  reset();
  const withOpen = await savedWineKeyboard(db, { wineId: VASO, year: 2021, itemId: B_VASO }, null);
  const open = withOpen.inline_keyboard.flat().find((b) => b.text === "🍾 Öffnen")!;
  assert.equal(decodeMenu("callback_data" in open ? open.callback_data : "")?.op, "open", "Öffnen geht über die Nachfrage");
  const without = await savedWineKeyboard(db, { wineId: NONE, year: 2020, itemId: B_NONE }, null);
  const direct = without.inline_keyboard[0][0];
  assert.equal(decodeMenu("callback_data" in direct ? direct.callback_data : "")?.op, "openBatch");
});

test("Chat: propose_open_bottle fragt nach und nennt die offene Flasche fürs Glas; Prompt-Regel", async () => {
  reset();
  const pending: { proposal: unknown; text: string }[] = [];
  const tool = chatTools(db, pending as never).find((t) => t.name === "propose_open_bottle")!;
  const out = String(await tool.run({ wine_id: OTHER, vintage_year: 2021 } as never));
  assert.match(pending[0].text, /öffnen .*– Von diesem Wein ist schon eine Flasche offen \(2019, 40 %\)\. Trotzdem eine weitere öffnen\?$/);
  assert.match(out, new RegExp(`inventory_item_id ${OPEN19}.*propose_open_bottle_edit mit glasses`));
  const none: { proposal: unknown; text: string }[] = [];
  await chatTools(db, none as never).find((t) => t.name === "propose_open_bottle")!.run({ wine_id: NONE, vintage_year: 2020 } as never);
  assert.doesNotMatch(none[0].text, /schon eine/);
  assert.match(CHAT_SYSTEM, /Ein Glas\/Gläser bei einem Wein mit offener Flasche → Füllstand dieser offenen Flasche.*nie propose_open_bottle/);
});

test("App: Öffnen mit offener Flasche braucht die Bestätigung („Trotzdem öffnen“)", async () => {
  reset();
  assert.match((await openNeedsConfirmation(db, B_VASO, false))!, /Trotzdem eine weitere öffnen\?/);
  assert.equal(await openNeedsConfirmation(db, B_VASO, true), null, "bestätigt");
  assert.equal(await openNeedsConfirmation(db, B_NONE, false), null, "nichts offen");
  assert.match((await openNeedsConfirmation(db, B_OTHER, false))!, /\(2019, 40 %\)/, "anderer Jahrgang zählt");
});

test("Gemeinsame Prüfung: alle Jahrgänge; Text für Wein mit Jahrgang, Spirituose wie bisher", async () => {
  reset();
  assert.deepEqual((await openBottlesOfWine(db, OTHER)).map((b) => [b.itemId, b.year, b.fill]), [[OPEN19, 2019, 40]]);
  assert.equal(alreadyOpenQuestion([], "red"), null);
  assert.equal(alreadyOpenQuestion([{ itemId: "x", year: null, fill: null, sizeMl: null, dateOpened: null }], "red"), "Von diesem Wein ist schon eine Flasche offen (ohne Jahrgang). Trotzdem eine weitere öffnen?");
  assert.equal(alreadyOpenQuestion([{ itemId: "x", year: null, fill: 40, sizeMl: null, dateOpened: null }], "spirit"), "Es ist schon eine offen (~40 %). Trotzdem eine weitere öffnen?");
});
