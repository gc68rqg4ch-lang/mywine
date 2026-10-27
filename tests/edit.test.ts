// Integrationstest: gemeinsames Bearbeiten-Modul (App und Bot) – Prüfungen, vorher → nachher,
// Teil-Verschieben ohne falschen Kauf, Jahrgang zusammenführen, Formular-Parser und der
// Bot-Vorschlag mit [Ja]. Supabase und Telegram per fetch-Stub. Ausführen: npm test
import assert from "node:assert/strict";
import { installNet, type Net } from "./stub-net";

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  SUPABASE_SECRET_KEY: "stub",
  TELEGRAM_BOT_TOKEN: "stub",
  TELEGRAM_WEBHOOK_SECRET: "stub",
  TELEGRAM_ALLOWED_USER_ID: "111",
  ANTHROPIC_API_KEY: "stub",
});

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
installNet(net);

(async () => {
  const { prepareEdit, applyEdit, applyEdits, NOTHING } = await import("@/lib/edit/edit");
  const { editsFromForm } = await import("@/lib/edit/form");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Wein: gleicher Name + Produzent wie ein anderer → klare Meldung; Änderung mit vorher → nachher
  const conflict = await prepareEdit(db, { kind: "wine", wineId: W, set: { name: "alion" } });
  assert.ok(!conflict.ok && /Es gibt schon einen Wein „Alion“ von Vega Sicilia/.test(conflict.error), JSON.stringify(conflict));
  const wine = await prepareEdit(db, { kind: "wine", wineId: W, set: { region: "DO Toro ", appellation: "" } });
  assert.ok(wine.ok);
  assert.deepEqual(wine.preview.changes, [{ label: "Region", before: "Toro", after: "DO Toro" }]);
  assert.equal((await prepareEdit(db, { kind: "wine", wineId: W, set: { region: "Toro" } })).ok, false, NOTHING);

  // Charge: Anzahl nur ungeöffnet, 0 → löschen; neuer Händler wird angekündigt und angelegt
  const zero = await prepareEdit(db, { kind: "batch", itemId: I, set: { quantity: 0 } });
  assert.ok(!zero.ok && /Charge löschen/.test(zero.error));
  const batch = await applyEdit(db, { kind: "batch", itemId: I, set: { purchasePrice: 22, vendor: "Coop" } });
  assert.ok(batch.ok, JSON.stringify(batch));
  assert.equal(net.tables.vendors.find((v) => v.name === "Coop") != null, true);
  assert.equal(net.tables.inventory_items[0].purchase_price, 22);
  assert.match(batch.message, /^Händler Coop, Bezahlt CHF\s22\.00 gespeichert\.$/);

  // Teil verschieben: neue Charge erst mit 0 Flaschen (kein „Kauf“), dann 2 Flaschen umbuchen
  const inserts: unknown[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST" && String(input).includes("/inventory_items")) inserts.push(JSON.parse(String(init?.body)));
    return origFetch(input, init);
  }) as typeof fetch;
  const move = await applyEdit(db, { kind: "move", itemId: I, room: "Wohnzimmer", count: 2 });
  globalThis.fetch = origFetch;
  assert.ok(move.ok, JSON.stringify(move));
  assert.equal(move.done, "2 Flaschen ins Wohnzimmer verschoben");
  assert.equal((inserts[0] as { quantity: number }).quantity, 0, "neue Charge entsteht mit 0 Flaschen");
  const rows = net.tables.inventory_items.map((r) => [r.quantity, r.storage_room]);
  assert.deepEqual(rows, [[4, "Weinkeller"], [2, "Wohnzimmer"]]);
  assert.ok(!(await prepareEdit(db, { kind: "move", itemId: I, room: "Weinkeller" })).ok, "schon dort");

  // Jahrgang: Ziel existiert → Hinweis aufs Zusammenführen; ausführen über change_vintage
  const merge = await prepareEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 2018 });
  assert.ok(merge.ok && merge.preview.notes.some((n) => /zusammengeführt/.test(n)));
  const done = await applyEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 2018 });
  assert.ok(done.ok && /zusammengeführt/.test(done.message));
  assert.deepEqual(rpcCalls.at(-1), { p_wine_id: W, p_from: 2019, p_to: 2018 });
  assert.ok(!(await prepareEdit(db, { kind: "vintage", wineId: W, from: 2019, to: 1700 })).ok);

  // Formular (App): Charge mit Preis, Lagerort und Jahrgang → drei Bearbeitungen; unveränderte fallen weg
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

  // Bot: Vorschlag liegt in ingest_jobs, [Ja] führt über dasselbe Modul aus („Ich habe …“)
  const { sendEditProposal } = await import("@/lib/chat/edits");
  const { handleUpdate } = await import("@/lib/ingest/bot");
  const edit = { kind: "batch" as const, itemId: I, set: { quantity: 5 } };
  const prepared = await prepareEdit(db, edit);
  assert.ok(prepared.ok);
  await sendEditProposal(db, 111, edit, prepared.preview);
  const question = String(net.telegram.at(-1)!.body.text);
  assert.match(question, /Charge bearbeiten: .*\n• Anzahl: 4 → 5\n\nSoll ich das so ändern\?/);
  const job = net.tables.ingest_jobs.at(-1)!;
  assert.equal(job.source, "telegram_edit");
  await handleUpdate({ update_id: 3, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: `ce:${job.id}`, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0, text: question } } } as never);
  assert.equal(net.tables.inventory_items[0].quantity, 5);
  const reply = net.telegram.filter((t) => t.method === "sendMessage").at(-1)!;
  assert.match(String(reply.body.text), /^✅ Ich habe Anzahl 5 gespeichert\./);
  assert.equal(job.status, "confirmed");
  console.log("edit tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
