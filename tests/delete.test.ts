// Integrationstest: unwiderruflich löschen – Flaschen (ganz/teilweise, auch offen/getrunken)
// und den ganzen Wein (Übersicht, Namensbestätigung, Dateien aus den Buckets). App-Formular,
// Bot-Menü (🗑 unter ✏️) und [Abbrechen]. Die DB-Funktionen delete_bottles/delete_wine sind
// im Stub nachgebildet. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyEdit, prepareEdit } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import { deleteBottlesQuestion, nameConfirmed, wineDeleteSummaryText } from "@/lib/edit/delete-text";
import { handleUpdate } from "@/lib/ingest/bot";
import { screenFor } from "@/lib/chat/menu";
import { decodeMenu, encodeMenu, type MenuAction } from "@/lib/chat/menu-view";

const W = "11111111-1111-4111-8111-111111111111";
const W2 = "33333333-3333-4333-8333-333333333333";
const SEALED = "22222222-2222-4222-8222-222222222222";
const OPEN = "44444444-4444-4444-8444-444444444444";
const DRUNK = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";

const position = (id: string, wine_id: string, extra: Record<string, unknown>) => ({
  id, wine_id, vintage_year: 2019, status: "sealed", quantity: 1, bottle_size_ml: 750, purchase_price: 24.5, currency: "CHF",
  storage_house: "Zuhause", storage_room: "Wohnzimmer", storage_compartment: null, storage_location: null, drunk_at: null, ...extra,
});

function freshTables(): Net["tables"] {
  return {
    wines: [
      { id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro" },
      { id: W2, name: "Alion", producer: "Vega Sicilia", type: "red", country: "Spanien", region: null },
    ],
    inventory_items: [
      position(SEALED, W, { quantity: 5 }),
      position(OPEN, W, { status: "open", storage_room: "Küche" }),
      position(DRUNK, W, { status: "drunk", storage_room: null, drunk_at: "2026-10-20T18:00:00Z" }),
      position(OTHER, W2, { quantity: 2 }),
    ],
    inventory_events: [],
    wine_vintages: [{ id: "v19", wine_id: W, vintage_year: 2019 }],
    wine_ratings: [
      { id: "r1", wine_id: W, vintage_year: 2019, rating: 4 },
      { id: "r2", wine_id: W, vintage_year: 2019, rating: 4.5 },
      { id: "r3", wine_id: W2, vintage_year: 2019, rating: 3 },
    ],
    wine_tastings: [{ id: "t1", wine_id: W, vintage_year: 2019 }],
    wine_encounters: [{ id: "e1", wine_id: W }, { id: "e2", wine_id: W }],
    wine_media: [
      { id: "m1", wine_id: W, kind: "photo", storage_bucket: "wine-photos", storage_path: "w/1.jpg", thumb_path: "w/1.thumb.jpg" },
      { id: "m2", wine_id: W, kind: "photo", storage_bucket: "wine-photos", storage_path: "w/2.jpg", thumb_path: null },
      { id: "m3", wine_id: W, kind: "document", storage_bucket: "wine-documents", storage_path: "w/a.pdf", thumb_path: "w/a.thumb.jpg" },
    ],
    vendors: [],
    persons: [],
    ingest_jobs: [],
    telegram_chat_messages: [],
  };
}

const file = (type = "image/jpeg") => ({ bytes: new Uint8Array([1]), type });
const net: Net = { tables: freshTables(), telegram: [], rpc: {}, claude: () => ({}) };
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

// Nachbildung von public.delete_bottles: ganz oder teilweise, genau ein Journal-Eintrag „deleted“.
net.rpc.delete_bottles = (args) => {
  rpcCalls.push({ name: "delete_bottles", args });
  const items = net.tables.inventory_items;
  const item = items.find((r) => r.id === args.p_item_id)!;
  const n = args.p_quantity as number | undefined;
  const all = n == null || n >= (item.quantity as number);
  net.tables.inventory_events.push({ event_type: "deleted", inventory_item_id: item.id, quantity: all ? item.quantity : n });
  if (all) {
    items.splice(items.indexOf(item), 1);
    return 0;
  }
  item.quantity = (item.quantity as number) - n;
  return item.quantity;
};
// Nachbildung von public.delete_wine: alles weg (kein Journal), Storage-Pfade zurück.
net.rpc.delete_wine = (args) => {
  rpcCalls.push({ name: "delete_wine", args });
  const files = net.tables.wine_media
    .filter((m) => m.wine_id === args.p_wine_id)
    .map((m) => ({ storage_bucket: m.storage_bucket, storage_path: m.storage_path, thumb_path: m.thumb_path }));
  for (const [name, rows] of Object.entries(net.tables)) {
    net.tables[name] = rows.filter((r) => (name === "wines" ? r.id : r.wine_id) !== args.p_wine_id);
  }
  return files;
};

function reset() {
  net.tables = freshTables();
  net.telegram.length = 0;
  rpcCalls.length = 0;
  net.storage = new Map([
    ["wine-photos/w/1.jpg", file()],
    ["wine-photos/w/1.thumb.jpg", file()],
    ["wine-photos/w/2.jpg", file()],
    ["wine-documents/w/a.pdf", file("application/pdf")],
    ["wine-documents/w/a.thumb.jpg", file()],
    ["wine-photos/other/9.jpg", file()],
  ]);
}
installNet(net);
const db = createAdminClient();
const qty = (id: string) => net.tables.inventory_items.find((r) => r.id === id)?.quantity;

async function press(data: string) {
  await handleUpdate({
    update_id: 1,
    callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0, text: "?" } },
  } as never);
}
const lastReply = () => String(net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.text);
const buttons = (screen: { keyboard: { inline_keyboard: { text: string; callback_data?: string }[][] } }) =>
  screen.keyboard.inline_keyboard.flat();

test("Warntexte: Charge, offene und getrunkene Flasche – „Nicht als getrunken“", () => {
  assert.equal(
    deleteBottlesQuestion({ status: "sealed", quantity: 5, storage_room: "Wohnzimmer" }, 1),
    "1 Flasche aus Charge Wohnzimmer löschen? Sie verschwindet aus dem Bestand und wird im Journal als gelöscht vermerkt. Nicht als getrunken.",
  );
  assert.match(deleteBottlesQuestion({ status: "sealed", quantity: 5, storage_room: "Weinkeller" }, 3), /^3 Flaschen aus Charge Weinkeller löschen\? Sie verschwinden .* werden im Journal/);
  assert.match(deleteBottlesQuestion({ status: "open", quantity: 1, storage_room: "Küche" }), /^Die offene Flasche \(Küche\) löschen\?.*Nicht als getrunken\.$/);
  assert.match(deleteBottlesQuestion({ status: "drunk", quantity: 1, storage_room: null, drunk_at: "2026-10-20T18:00:00Z" }), /^Die getrunkene Flasche vom 20\.10\.2026 löschen\? .*„Getrunken“.*falsch erfasst/);
  assert.equal(
    wineDeleteSummaryText({ bottles: { sealed: 5, open: 1, drunk: 1 }, ratings: 3, tastings: 1, encounters: 2, photos: 4, documents: 1 }),
    "7 Flaschen (5 im Bestand, 1 offen, 1 getrunken), 3 Bewertungen, 1 Verkostung, 2 Verkostet-Einträge, 4 Fotos, 1 PDF",
  );
  assert.equal(wineDeleteSummaryText({ bottles: { sealed: 0, open: 0, drunk: 0 }, ratings: 0, tastings: 0, encounters: 0, photos: 0, documents: 0 }), "nur die Stammdaten");
  assert.ok(nameConfirmed("  pintia ", "Pintia"));
  assert.ok(nameConfirmed("Clos  de la Roche", "Clos de la Roche"));
  assert.ok(!nameConfirmed("", "Pintia"));
  assert.ok(!nameConfirmed("Pinti", "Pintia"));
});

test("Flaschen teilweise löschen: Charge bleibt mit dem Rest, genau ein Journal-Eintrag", async () => {
  reset();
  const prepared = await prepareEdit(db, { kind: "deleteBottles", itemId: SEALED, count: 2 });
  assert.ok(prepared.ok);
  assert.match(prepared.preview.notes!.join(" "), /^2 Flaschen aus Charge Wohnzimmer löschen\?/);
  assert.equal(rpcCalls.length, 0, "Vorschau ändert nichts");
  const result = await applyEdit(db, { kind: "deleteBottles", itemId: SEALED, count: 2 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.done, "2 Flaschen gelöscht (noch 3 Flaschen in der Charge)");
  assert.deepEqual(rpcCalls, [{ name: "delete_bottles", args: { p_item_id: SEALED, p_quantity: 2 } }]);
  assert.equal(qty(SEALED), 3);
  assert.deepEqual(net.tables.inventory_events, [{ event_type: "deleted", inventory_item_id: SEALED, quantity: 2 }]);
  assert.equal(result.wineId, W, "danach auf der Weinseite bleiben");

  const tooMany = await prepareEdit(db, { kind: "deleteBottles", itemId: SEALED, count: 4 });
  assert.ok(!tooMany.ok && /höchstens 3/.test(tooMany.error));
});

test("Letzte Flaschen löschen: Charge weg, Wein mit Bewertungen bleibt; offen und getrunken gehen auch", async () => {
  reset();
  const prepared = await prepareEdit(db, { kind: "deleteBottles", itemId: SEALED, count: 5 });
  assert.ok(prepared.ok);
  assert.match(prepared.preview.notes!.join(" "), /Bewertungen und Verkostungen bleiben beim Wein/);
  const all = await applyEdit(db, { kind: "deleteBottles", itemId: SEALED, count: 5 });
  assert.ok(all.ok && all.done === "5 Flaschen gelöscht");
  for (const id of [OPEN, DRUNK]) {
    const r = await applyEdit(db, { kind: "deleteBottles", itemId: id });
    assert.ok(r.ok, JSON.stringify(r));
  }
  assert.equal(rpcCalls[1].args.p_quantity, undefined, "ohne Anzahl = ganze Position");
  assert.deepEqual(net.tables.inventory_items.map((r) => r.id), [OTHER]);
  assert.equal(net.tables.inventory_events.length, 3, "je ein Eintrag „deleted“");
  assert.ok(net.tables.wines.some((w) => w.id === W), "Wein bleibt");
  assert.equal(net.tables.wine_ratings.filter((r) => r.wine_id === W).length, 2, "Bewertungen bleiben");
  assert.equal(net.tables.wine_tastings.length, 1);
});

test("Ganzen Wein löschen: Übersicht, Name muss passen, danach alles weg samt Dateien (Original und Vorschau)", async () => {
  reset();
  const prepared = await prepareEdit(db, { kind: "deleteWine", wineId: W });
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.preview.notes, [
    "Es verschwindet alles: 7 Flaschen (5 im Bestand, 1 offen, 1 getrunken), 2 Bewertungen, 1 Verkostung, 2 Verkostet-Einträge, 2 Fotos, 1 PDF.",
    "Das lässt sich nicht rückgängig machen.",
  ]);

  const wrong = await applyEdit(db, { kind: "deleteWine", wineId: W, confirmName: "Alion" });
  assert.ok(!wrong.ok && /„Pintia“ genau eintippen/.test(wrong.error));
  assert.equal(rpcCalls.length, 0, "falscher Name: nichts gelöscht");

  const done = await applyEdit(db, { kind: "deleteWine", wineId: W, confirmName: "pintia" });
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(done.wineId, null, "zurück zur Liste");
  assert.deepEqual(net.tables.wines.map((w) => w.id), [W2]);
  for (const t of ["inventory_items", "wine_ratings", "wine_tastings", "wine_encounters", "wine_media"]) {
    assert.ok(!net.tables[t].some((r) => r.wine_id === W), t);
  }
  assert.equal(net.tables.inventory_events.length, 0, "kein Journal-Eintrag");
  assert.deepEqual([...net.storage!.keys()], ["wine-photos/other/9.jpg"], "Dateien des Weins aus beiden Buckets entfernt");
  assert.equal(qty(OTHER), 2, "anderer Wein unberührt");
});

test("App-Formular: deleteBottles mit Anzahl, deleteWine mit eingetipptem Namen", () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "deleteBottles", itemId: SEALED, count: "2" })) form.set(k, v);
  assert.deepEqual(editsFromForm(form), [{ kind: "deleteBottles", itemId: SEALED, count: 2 }]);
  const whole = new FormData();
  for (const [k, v] of Object.entries({ kind: "deleteWine", wineId: W, confirmName: "Pintia" })) whole.set(k, v);
  assert.deepEqual(editsFromForm(whole), [{ kind: "deleteWine", wineId: W, confirmName: "Pintia" }]);
});

test("Bot: 🗑 Flaschen löschen – Charge wählen, Anzahl, Rückfrage; [Abbrechen] ändert nichts, [🗑 Löschen] löscht", async () => {
  reset();
  const back = { kind: "none" } as const;
  const subject = { kind: "vintage", wineId: W, year: 2019 } as const;
  const actions: MenuAction[] = [
    { op: "delBottles", subject, back },
    { op: "delCount", itemId: SEALED, count: null, back },
    { op: "delCount", itemId: SEALED, count: 2, back },
    { op: "delWine", subject, back },
  ];
  for (const a of actions) {
    const data = encodeMenu(a);
    assert.ok(Buffer.byteLength(data) <= 64, data);
    assert.deepEqual(decodeMenu(data), a, data);
  }

  const edit = await screenFor(db, { op: "edit", subject, back }, { chatId: 111 });
  assert.ok(buttons(edit.screen).some((b) => b.text === "🗑 Flaschen löschen"));
  assert.ok(buttons(edit.screen).some((b) => b.text === "🗑 Wein löschen"));

  const pick = await screenFor(db, actions[0], { chatId: 111 });
  const labels = buttons(pick.screen).map((b) => b.text);
  assert.ok(labels.includes("Charge · 5 Fl. · Wohnzimmer"), labels.join(" | "));
  assert.ok(labels.includes("Offen · Küche"));
  assert.ok(labels.includes("Getrunken · 20.10.2026"));

  const count = await screenFor(db, actions[1], { chatId: 111 });
  assert.match(count.screen.text, /Wie viele Flaschen löschen\? \(5/);
  assert.deepEqual(buttons(count.screen).map((b) => b.text), ["1", "2", "3", "4", "Alle 5", "‹ Zurück"]);
  assert.equal(net.tables.ingest_jobs.length, 0);

  // Anzahl gewählt → Rückfrage; Abbrechen lässt alles stehen.
  const ask = await screenFor(db, actions[2], { chatId: 111 });
  assert.match(ask.screen.text, /2 Flaschen aus Charge Wohnzimmer löschen\?.*Nicht als getrunken\.[\s\S]*Wirklich löschen\?/);
  const [yes, no] = buttons(ask.screen);
  assert.deepEqual([yes.text, no.text], ["🗑 Löschen", "Abbrechen"]);
  await press(no.callback_data!);
  assert.equal(qty(SEALED), 5);
  assert.equal(rpcCalls.length, 0, "Abbruch: nichts gelöscht");
  assert.equal(net.tables.ingest_jobs[0].status, "discarded");

  const again = await screenFor(db, actions[2], { chatId: 111 });
  await press(buttons(again.screen)[0].callback_data!);
  assert.equal(qty(SEALED), 3);
  assert.match(lastReply(), /^✅ Ich habe 2 Flaschen gelöscht \(noch 3 Flaschen in der Charge\)\./);
  await press(buttons(again.screen)[0].callback_data!);
  assert.equal(qty(SEALED), 3, "zweimal drücken löscht nicht doppelt");
});

test("Bot: 🗑 Wein löschen – zweistufig: Übersicht, dann „Ja, endgültig löschen“ / „Abbrechen“", async () => {
  reset();
  const subject = { kind: "vintage", wineId: W, year: 2019 } as const;
  const overview = await screenFor(db, { op: "delWine", subject, back: { kind: "none" } }, { chatId: 111 });
  assert.match(overview.screen.text, /Es verschwindet alles: 7 Flaschen .*2 Fotos, 1 PDF\.\nℹ️ Das lässt sich nicht rückgängig machen\.[\s\S]*Wirklich löschen\?/);
  assert.equal(rpcCalls.length, 0, "Übersicht löscht nichts");
  const [yes, no, back] = buttons(overview.screen);
  assert.deepEqual([yes.text, no.text, back.text], ["Ja, endgültig löschen", "Abbrechen", "‹ Zurück"]);

  await press(no.callback_data!);
  assert.ok(net.tables.wines.some((w) => w.id === W), "Abbruch: Wein bleibt");
  assert.equal(net.storage!.size, 6);

  const second = await screenFor(db, { op: "delWine", subject, back: { kind: "none" } }, { chatId: 111 });
  await press(buttons(second.screen)[0].callback_data!);
  assert.ok(!net.tables.wines.some((w) => w.id === W));
  assert.deepEqual([...net.storage!.keys()], ["wine-photos/other/9.jpg"]);
  assert.match(lastReply(), /^✅ Ich habe den Wein Vega Sicilia – Pintia mit allem gelöscht\.$/);
});
