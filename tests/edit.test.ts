// Integrationstest: gemeinsames Bearbeiten-Modul (App und Bot) – Prüfungen, vorher → nachher,
// Teil-Verschieben ohne falschen Kauf, Jahrgang zusammenführen, Formular-Parser und der
// Bot-Vorschlag mit [Ja]. Supabase und Telegram per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { editsFromForm } from "@/lib/edit/form";
import { handleUpdate } from "@/lib/ingest/bot";
import { prepareEdit, applyEdit, applyEdits, NOTHING } from "@/lib/edit/edit";
import { sendEditProposal } from "@/lib/chat/edits";

const W = "11111111-1111-4111-8111-111111111111";
const W2 = "33333333-3333-4333-8333-333333333333";
const I = "22222222-2222-4222-8222-222222222222";
const item = (extra: Record<string, unknown>) => ({
  wine_id: W, vintage_year: 2019, status: "sealed", quantity: 6, bottle_size_ml: 750, purchased_at: "2026-03-01", vendor_id: null,
  is_gift: false, purchase_price: 24.5, regular_price: 29.9, currency: "CHF", storage_house: "Zuhause", storage_room: "Weinkeller",
  storage_compartment: null, storage_location: null, drunk_at: null, wine: { name: "Pintia", producer: "Vega Sicilia" }, vendor: null, open: null,
  ...extra,
});
const net: Net = {
  tables: {
    wines: [
      { id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: 14.5 },
      { id: W2, name: "Alion", producer: "Vega Sicilia", type: "red", country: "Spanien", region: null, appellation: null, alcohol_content: null },
    ],
    inventory_items: [item({ id: I })],
    wine_vintages: [{ id: "v19", wine_id: W, vintage_year: 2019 }, { id: "v18", wine_id: W, vintage_year: 2018 }],
    vendors: [{ id: "ven1", name: "Mövenpick" }],
    ingest_jobs: [],
    telegram_chat_messages: [],
    persons: [],
  },
  telegram: [],
  rpc: {},
  claude: () => {
    throw new Error("unerwarteter Claude-Aufruf");
  },
};
const rpcCalls: Record<string, unknown>[] = [];
net.rpc.change_vintage = (args) => {
  rpcCalls.push(args);
  return null;
};
// Nachbildung von public.move_bottles: Teilmenge abbuchen, mit gleicher Charge am Ziel zusammenführen.
net.rpc.move_bottles = (args) => {
  rpcCalls.push(args);
  const items = net.tables.inventory_items;
  const src = items.find((r) => r.id === args.p_item_id)!;
  const n = args.p_quantity as number;
  const same = items.find((r) => r !== src && r.status === "sealed" && r.storage_room === args.p_room && r.purchase_price === src.purchase_price);
  const target = same ?? (n === src.quantity ? src : { ...src, id: `44444444-4444-4444-8444-${String(items.length).padStart(12, "0")}`, quantity: 0, storage_room: args.p_room });
  if (target === src) src.storage_room = args.p_room;
  else {
    if (!same) items.push(target);
    target.quantity = (target.quantity as number) + n;
    src.quantity = (src.quantity as number) - n;
    if (src.quantity === 0) items.splice(items.indexOf(src), 1);
  }
  return target.id;
};
installNet(net);

const db = createAdminClient();

test("Wein: gleicher Name + Produzent wie ein anderer → klare Meldung; Änderung mit vorher → nachher", async () => {
  const conflict = await prepareEdit(db, { kind: "wine", wineId: W, set: { name: "alion" } });
  assert.ok(!conflict.ok && /Es gibt schon einen Wein „Alion“ von Vega Sicilia/.test(conflict.error), JSON.stringify(conflict));
  const wine = await prepareEdit(db, { kind: "wine", wineId: W, set: { region: "DO Toro ", appellation: "" } });
  assert.ok(wine.ok);
  assert.deepEqual(wine.preview.changes, [{ label: "Region", before: "Toro", after: "DO Toro" }]);
  assert.equal((await prepareEdit(db, { kind: "wine", wineId: W, set: { region: "Toro" } })).ok, false, NOTHING);
});

test("Charge: Anzahl nur ungeöffnet, 0 → löschen; neuer Händler wird angekündigt und angelegt", async () => {
  const zero = await prepareEdit(db, { kind: "batch", itemId: I, set: { quantity: 0 } });
  assert.ok(!zero.ok && /Charge löschen/.test(zero.error));
  const batch = await applyEdit(db, { kind: "batch", itemId: I, set: { purchasePrice: 22, vendor: "Coop" } });
  assert.ok(batch.ok, JSON.stringify(batch));
  assert.equal(net.tables.vendors.find((v) => v.name === "Coop") != null, true);
  assert.equal(net.tables.inventory_items[0].purchase_price, 22);
  assert.match(batch.message, /^Händler Coop, Bezahlt CHF\s22\.00 gespeichert\.$/);
});

test("Verschieben nur über move_bottles (atomar in der DB) – die App legt selbst keine Chargen an", async () => {
  const posts: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") posts.push(new URL(String(input)).pathname);
    return origFetch(input, init);
  }) as typeof fetch;
  const move = await applyEdit(db, { kind: "move", itemId: I, room: "Wohnzimmer", count: 2 });
  assert.ok(move.ok, JSON.stringify(move));
  assert.equal(move.done, "2 Flaschen ins Wohnzimmer verschoben");
  assert.deepEqual(posts, ["/rest/v1/rpc/move_bottles"], "nur der RPC-Aufruf, kein eigenes Insert");
  assert.deepEqual(rpcCalls.at(-1), { p_item_id: I, p_quantity: 2, p_house: "Zuhause", p_room: "Wohnzimmer" });
  assert.deepEqual(net.tables.inventory_items.map((r) => [r.quantity, r.storage_room]), [[4, "Weinkeller"], [2, "Wohnzimmer"]]);

  // Nochmals 1 Flasche: am Ziel liegt jetzt eine gleiche Charge → Hinweis, die Flasche kommt dazu
  const again = await prepareEdit(db, { kind: "move", itemId: I, room: "Wohnzimmer", count: 1 });
  assert.ok(again.ok && again.preview.notes.some((n) => /gleiche Charge/.test(n)), JSON.stringify(again));
  assert.ok((await applyEdit(db, { kind: "move", itemId: I, room: "Wohnzimmer", count: 1 })).ok);
  globalThis.fetch = origFetch;
  assert.deepEqual(net.tables.inventory_items.map((r) => [r.quantity, r.storage_room]), [[3, "Weinkeller"], [3, "Wohnzimmer"]]);
  assert.ok(!(await prepareEdit(db, { kind: "move", itemId: I, room: "Wohnzimmer", count: 4 })).ok, "mehr als vorhanden");
  assert.ok(!(await prepareEdit(db, { kind: "move", itemId: I, room: "Weinkeller" })).ok, "schon dort");
});

test("Jahrgang: Ziel existiert → Hinweis aufs Zusammenführen; ausführen über change_vintage", async () => {
  const merge = await prepareEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 2018 });
  assert.ok(merge.ok && merge.preview.notes.some((n) => /zusammengeführt/.test(n)));
  const done = await applyEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 2018 });
  assert.ok(done.ok && /zusammengeführt/.test(done.message));
  assert.deepEqual(rpcCalls.at(-1), { p_wine_id: W, p_from: 2019, p_to: 2018 });
  assert.ok(!(await prepareEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 1700 })).ok);
});

test("Formular (App): Charge mit Preis, Lagerort und Jahrgang → drei Bearbeitungen; unveränderte fallen weg", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "batch", itemId: I, giftField: "1", purchasePrice: "22.00", room: "Weinkeller", roomBefore: "Weinkeller", vintage: "NV", vintageBefore: "2019" })) form.set(k, v);
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits));
  assert.deepEqual(edits.map((e) => e.kind), ["batch", "batchVintage"]);
  assert.deepEqual(edits[1], { kind: "batchVintage", itemId: I, to: null });
  const bad = new FormData();
  for (const [k, v] of Object.entries({ kind: "batch", itemId: I, purchasePrice: "viel" })) bad.set(k, v);
  assert.ok("error" in (editsFromForm(bad) as object));
  const multi = await applyEdits(db, [{ kind: "batch", itemId: I, set: { purchasePrice: 22 } }, { kind: "batch", itemId: I, set: { isGift: true } }]);
  assert.ok(multi.ok && multi.message === "Geschenk ja gespeichert.", JSON.stringify(multi));
});

test("Bot: Vorschlag liegt in ingest_jobs, [Ja] führt über dasselbe Modul aus („Ich habe …“)", async () => {
  const edit = { kind: "batch" as const, itemId: I, set: { quantity: 5 } };
  const prepared = await prepareEdit(db, edit);
  assert.ok(prepared.ok);
  await sendEditProposal(db, 111, edit, prepared.preview);
  const question = String(net.telegram.at(-1)!.body.text);
  assert.match(question, /Charge bearbeiten: .*\n• Anzahl: 3 → 5\n\nSoll ich das so ändern\?/);
  const job = net.tables.ingest_jobs.at(-1)!;
  assert.equal(job.source, "telegram_edit");
  await handleUpdate({ update_id: 3, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: `ce:${job.id}`, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0, text: question } } } as never);
  assert.equal(net.tables.inventory_items[0].quantity, 5);
  const reply = net.telegram.filter((t) => t.method === "sendMessage").at(-1)!;
  assert.match(String(reply.body.text), /^✅ Ich habe Anzahl 5 gespeichert\./);
  assert.equal(job.status, "confirmed");
});
