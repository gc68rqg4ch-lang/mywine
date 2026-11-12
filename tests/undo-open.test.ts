// Öffnen rückgängig: kürzlich geöffnete Flasche wieder als ungeöffnet buchen (Wein, Likörwein,
// Spirituose) – DB-Funktion undo_open_bottle (Migration), gemeinsame Prüfung (≤ 24 h seit dem
// Öffnen, nichts angehängt), Menü („↩️ Öffnen rückgängig“ → Rückfrage → cu:<itemId>), Chat
// (propose_undo_open), Callback-Kodierung. Supabase als Fake im Speicher; die DB-Funktion als
// Nachbildung (das Verhalten der echten Funktion ist lokal gegen Postgres geprüft, siehe Migration).
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { screenFor } from "@/lib/chat/menu";
import { decodeMenu, encodeMenu, isMenuCallback, type MenuAction } from "@/lib/chat/menu-view";
import { decodeProposal, encodeProposal, isChatCallback } from "@/lib/chat/proposals";
import { isTastingCallback } from "@/lib/chat/tasting";
import { executeProposal } from "@/lib/chat/execute";
import { chatTools } from "@/lib/chat/tools";
import { CHAT_SYSTEM } from "@/lib/bot/chat-prompt";
import { UNDO_OPEN_BLOCK_TEXT, undoOpenBlock, undoOpenCheck } from "@/lib/cellar/undo-open";

const VASO = "11111111-1111-4111-8111-111111111111";
const GRAPPA = "22222222-2222-4222-8222-222222222222";
const OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // VASO 2021, eben geöffnet, 60 %
const OLDER = "abababab-abab-4bab-8bab-abababababab"; // VASO 2021, vorgestern geöffnet
const BATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // VASO 2021, 3 zu
const SPIRIT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Grappa, eben geöffnet

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const undone: string[] = [];
let rpcError: { code: string; message: string } | null = null;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function reset() {
  undone.length = 0;
  rpcError = null;
  const ov = (id: string, wine: string, name: string, type: string, status: string, fill: number | null, opened: string | null) => ({
    inventory_item_id: id, wine_id: wine, producer: null, name, vintage_year: type === "spirit" ? null : 2021, type, status, fill_level_percent: fill, date_opened: opened, bottle_size_ml: 750, storage_room: "Weinkeller",
  });
  Object.assign(tables, {
    persons: [], latest_wine_ratings: [], wine_ratings: [], wine_tastings: [], wine_media: [], ingest_jobs: [],
    wines: [{ id: VASO, producer: null, name: "VASO", type: "red" }, { id: GRAPPA, producer: null, name: "Grappa", type: "spirit" }],
    cellar_overview: [
      ov(OPEN, VASO, "VASO", "red", "open", 60, "2026-11-12"),
      ov(OLDER, VASO, "VASO", "red", "open", 30, "2026-11-10"),
      ov(BATCH, VASO, "VASO", "red", "sealed", null, null),
      ov(SPIRIT, GRAPPA, "Grappa", "spirit", "open", 100, "2026-11-12"),
    ],
    inventory_items: [
      { id: OPEN, wine_id: VASO, vintage_year: 2021, status: "open", quantity: 1 },
      { id: OLDER, wine_id: VASO, vintage_year: 2021, status: "open", quantity: 1 },
      { id: BATCH, wine_id: VASO, vintage_year: 2021, status: "sealed", quantity: 3 },
      { id: SPIRIT, wine_id: GRAPPA, vintage_year: null, status: "open", quantity: 1 },
    ],
    open_bottle_details: [
      { inventory_item_id: OPEN, fill_level_percent: 60, created_at: hoursAgo(1) },
      { inventory_item_id: OLDER, fill_level_percent: 30, created_at: hoursAgo(50) },
      { inventory_item_id: SPIRIT, fill_level_percent: 100, created_at: hoursAgo(2) },
    ],
  });
}
reset();
// Nachbildung von undo_open_bottle (Zusammenführen mit der Charge bzw. wieder zu).
const db = fakeDb(tables, {
  undo_open_bottle: (args) => {
    if (rpcError) return { __error: rpcError };
    const id = String(args.p_item_id);
    undone.push(id);
    const item = tables.inventory_items.find((i) => i.id === id)!;
    const batch = tables.inventory_items.find((i) => i.status === "sealed" && i.wine_id === item.wine_id && i.vintage_year === item.vintage_year);
    tables.open_bottle_details = tables.open_bottle_details.filter((d) => d.inventory_item_id !== id);
    if (batch) {
      batch.quantity = Number(batch.quantity) + 1;
      tables.inventory_items.splice(tables.inventory_items.indexOf(item), 1);
      return batch.id;
    }
    item.status = "sealed";
    return id;
  },
}) as never;

const show = async (a: MenuAction) => (await screenFor(db, a, { chatId: 1 })).screen;
const texts = (s: Awaited<ReturnType<typeof show>>) => s.keyboard.inline_keyboard.flat().map((b) => b.text);
const back = { kind: "open" } as const;

test("Migration: Bedingungen, Zusammenführen mit „is not distinct from“, Journal ohne Reste, Rechte", () => {
  const sql = readFileSync("supabase/migrations/20261112185349_undo_open_bottle.sql", "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.undo_open_bottle\(p_item_id uuid\)\s+RETURNS uuid[\s\S]*SET search_path TO ''/);
  assert.match(sql, /private\.is_member\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(sql, /where id = p_item_id\s+for update/);
  assert.match(sql, /v_item\.status <> 'open'[\s\S]*errcode = '22023'/);
  assert.match(sql, /select d\.created_at into v_opened_at[\s\S]*v_opened_at < now\(\) - interval '24 hours'[\s\S]*errcode = 'UO001'/);
  for (const t of ["wine_ratings", "wine_tastings", "wine_media", "ingest_jobs"]) assert.match(sql, new RegExp(`from public\\.${t} +\\w+ where \\w+\\.inventory_item_id = p_item_id`));
  assert.match(sql, /errcode = 'UO002'/);
  assert.match(sql, /set_config\('mywine\.import', 'on', true\)[\s\S]*set_config\('mywine\.import', v_prev_import, true\)/, "keine neuen Events durch Trigger");
  assert.match(sql, /delete from public\.inventory_events\s+where inventory_item_id = p_item_id and event_type in \('opened', 'fill_changed'\)/);
  assert.match(sql, /delete from public\.open_bottle_details where inventory_item_id = p_item_id/);
  for (const col of ["vintage_year", "bottle_size_ml", "purchase_price", "regular_price", "currency", "purchased_at", "vendor_id", "is_gift", "storage_house", "storage_room", "storage_compartment", "storage_location"]) {
    assert.match(sql, new RegExp(`s\\.${col} is not distinct from v_item\\.${col}`), col);
  }
  assert.match(sql, /quantity = quantity \+ 1 where id = v_target\.id;\s+delete from public\.inventory_items where id = v_item\.id/);
  assert.match(sql, /set status = 'sealed', quantity = 1 where id = v_item\.id/, "letzte Flasche: wieder zu");
  assert.match(sql, /grant execute on function public\.undo_open_bottle\(uuid\) to authenticated, service_role;/);
});

test("Prüfung (rein): offen, höchstens 24 h, nichts angehängt", () => {
  assert.equal(undoOpenBlock({ status: "open", openedAt: hoursAgo(23.9), linked: false }), null);
  assert.equal(undoOpenBlock({ status: "open", openedAt: hoursAgo(24.1), linked: false }), "too_old");
  assert.equal(undoOpenBlock({ status: "open", openedAt: hoursAgo(1), linked: true }), "linked");
  assert.equal(undoOpenBlock({ status: "sealed", openedAt: hoursAgo(1), linked: false }), "not_open");
  assert.match(UNDO_OPEN_BLOCK_TEXT.too_old, /24 Stunden.*✏️ Bearbeiten bzw\. in der App/);
});

test("Menü: Knopf nur, wenn erlaubt; Rückfrage mit Füllstand-Hinweis; Ja = cu:<itemId>", async () => {
  reset();
  let s = await show({ op: "item", itemId: OPEN, back });
  assert.ok(texts(s).includes("↩️ Öffnen rückgängig"), texts(s).join(" | "));
  s = await show({ op: "undoAsk", itemId: OPEN, back });
  assert.equal(s.text, "↩️ VASO 2021 (60 %) wieder als ungeöffnet buchen? Damit wird auch der Füllstand zurückgenommen (wieder voll und zu).");
  assert.deepEqual(texts(s), ["Ja", "Nein"]);
  const [yes, no] = s.keyboard.inline_keyboard[0];
  assert.deepEqual(decodeProposal("callback_data" in yes ? yes.callback_data : ""), { kind: "undoOpen", itemId: OPEN });
  assert.deepEqual(decodeMenu("callback_data" in no ? no.callback_data : ""), { op: "item", itemId: OPEN, back });

  // Nach 24 h: kein Knopf; Rückfrage sagt warum
  s = await show({ op: "item", itemId: OLDER, back });
  assert.ok(!texts(s).includes("↩️ Öffnen rückgängig"));
  s = await show({ op: "undoAsk", itemId: OLDER, back });
  assert.match(s.text, /mehr als 24 Stunden/);

  // Mit Bewertung bzw. Verkostung seit dem Öffnen: kein Knopf
  for (const table of ["wine_ratings", "wine_tastings"]) {
    reset();
    tables[table].push({ inventory_item_id: OPEN, created_at: hoursAgo(0.5) });
    s = await show({ op: "item", itemId: OPEN, back });
    assert.ok(!texts(s).includes("↩️ Öffnen rückgängig"), table);
    assert.equal((await undoOpenCheck(db, OPEN)).ok, false);
  }
  // Foto vom Einbuchen (vor dem Öffnen) zählt nicht (letzte Flasche = dieselbe Position)
  reset();
  tables.wine_media.push({ inventory_item_id: OPEN, created_at: hoursAgo(5) });
  assert.equal((await undoOpenCheck(db, OPEN)).ok, true);
});

test("Ausführen: erneute Prüfung, Meldung mit Bestand; Ablehnung der Funktion ehrlich gemeldet", async () => {
  reset();
  const done = await executeProposal(db, { kind: "undoOpen", itemId: OPEN });
  assert.deepEqual(done, { ok: true, text: "Ich habe VASO 2021 wieder als ungeöffnet gebucht (jetzt 4 Fl. ungeöffnet · 1 offen)." });
  assert.deepEqual(undone, [OPEN]);
  assert.equal(tables.inventory_items.filter((i) => i.wine_id === VASO && i.status === "sealed")[0].quantity, 4);

  reset();
  const old = await executeProposal(db, { kind: "undoOpen", itemId: OLDER });
  assert.equal(old.ok, false);
  assert.match(old.text, /24 Stunden/);
  assert.deepEqual(undone, [], "zu alt: Funktion gar nicht aufgerufen");

  reset();
  rpcError = { code: "UO002", message: "linked" };
  const linked = await executeProposal(db, { kind: "undoOpen", itemId: OPEN });
  assert.deepEqual(linked, { ok: false, text: UNDO_OPEN_BLOCK_TEXT.linked });
});

test("Spirituose: Knopf und Ausführung gleich (letzte Flasche → wieder zu)", async () => {
  reset();
  const s = await show({ op: "item", itemId: SPIRIT, back });
  assert.ok(texts(s).includes("↩️ Öffnen rückgängig"));
  const done = await executeProposal(db, { kind: "undoOpen", itemId: SPIRIT });
  assert.equal(done.ok, true);
  assert.match(done.text, /^Ich habe Grappa wieder als ungeöffnet gebucht \(jetzt 1 Fl\. ungeöffnet\)\.$/);
  assert.equal(tables.inventory_items.find((i) => i.id === SPIRIT)!.status, "sealed");
});

test("Chat: propose_undo_open schlägt die zuletzt geöffnete vor; zu alt → ehrlicher Hinweis; Prompt", async () => {
  reset();
  const pending: { proposal: unknown; text: string }[] = [];
  const tool = () => chatTools(db, pending as never).find((t) => t.name === "propose_undo_open")!;
  await tool().run({ wine_id: VASO } as never);
  assert.deepEqual(pending[0].proposal, { kind: "undoOpen", itemId: OPEN });
  assert.match(pending[0].text, /^VASO 2021 \(60 %\) wieder als ungeöffnet buchen – die zuletzt geöffnete \(geöffnet am 12\.11\.\), es sind 2 offen\?/);
  pending.length = 0;
  const out = String(await tool().run({ wine_id: VASO, inventory_item_id: OLDER } as never));
  assert.equal(pending.length, 0, "zu alt: nichts vorschlagen");
  assert.match(out, /nichts vorschlagen, ehrlich sagen warum.*24 Stunden.*✏️ Bearbeiten/);
  assert.match(CHAT_SYSTEM, /propose_undo_open/);
  assert.doesNotMatch(CHAT_SYSTEM, /kann ich nicht wieder verschliessen/i);
});

test("Callbacks: cu:<itemId> (Chat), Ou:<itemId> (Menü) – eindeutig, höchstens 64 Bytes", () => {
  const cu = encodeProposal({ kind: "undoOpen", itemId: OPEN });
  assert.equal(cu, `cu:${OPEN}`);
  assert.ok(isChatCallback(cu) && !isMenuCallback(cu) && !isTastingCallback(cu));
  assert.deepEqual(decodeProposal(cu), { kind: "undoOpen", itemId: OPEN });
  assert.equal(decodeProposal(`cu:${OPEN}:1`), null);
  assert.equal(decodeProposal("cu:kaputt"), null);
  const menu = encodeMenu({ op: "undoAsk", itemId: OPEN, back: { kind: "type", code: "r" } });
  assert.ok(Buffer.byteLength(menu) <= 64 && isMenuCallback(menu) && !isChatCallback(menu) && !isTastingCallback(menu));
  assert.deepEqual(decodeMenu(menu), { op: "undoAsk", itemId: OPEN, back: { kind: "type", code: "r" } });
});
