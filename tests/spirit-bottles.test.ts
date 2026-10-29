// Spirituosen: „aktuelle Flasche“ mit Füllstand statt „offen“. Erste Flasche wird aktuell (100 %),
// Nachkauf ändert sie nicht, „leer“ (auch 0 %) bucht sie als getrunken und macht die nächste
// aktuell, die letzte verschwindet aus dem Bestand. Bestand, Offen und Bot (Füllstand/leer).
// Supabase per fetch-Stub mit kleiner Nachbildung der Views; die DB-Funktionen fehlen hier
// (Weg ohne Migration) bzw. werden für den Weg mit Migration nachgebildet. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentBottles, emptySpiritBottle, ensureSpiritCurrent, setSpiritFill } from "@/lib/spirits/bottles";
import { buildCellarWines, cellarTotals, toSummaryWine, toVintageRow } from "@/lib/cellar/overview";
import { currentFillNote, currentFills, inStockRow, openWineRow } from "@/lib/spirits/tag";
import { chatTools, loadCellar, type PendingProposal } from "@/lib/chat/tools";
import { executeProposal } from "@/lib/chat/execute";
import { decodeProposal, encodeProposal, isChatCallback } from "@/lib/chat/proposals";
import { stockTotals } from "@/lib/home/summary";
import { loadHomeData } from "@/lib/home/data";

type Row = Record<string, unknown>;
const LAGA = "11111111-1111-4111-8111-111111111111";
const TALI = "22222222-2222-4222-8222-222222222222";
const WINE = "33333333-3333-4333-8333-333333333333";
const missing = () => ({ __status: 404, body: { code: "PGRST202", message: "Could not find the function" } });

let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
let rpcCalls: string[] = [];

/** open_bottle wie in der DB: von einer Charge mit mehreren Flaschen eine abspalten. */
function openBottle(tables: Record<string, Row[]>, args: Row) {
  const item = tables.inventory_items.find((i) => i.id === args.p_item_id);
  if (!item || item.status !== "sealed" || Number(item.quantity) < 1) return { __status: 400, body: { code: "22023", message: "not sealed" } };
  let id = item.id as string;
  if (Number(item.quantity) > 1) {
    item.quantity = Number(item.quantity) - 1;
    id = newId();
    tables.inventory_items.push({ ...item, id, quantity: 1, status: "open" });
  } else item.status = "open";
  tables.open_bottle_details.push({ inventory_item_id: id, fill_level_percent: args.p_fill_level_percent, date_opened: args.p_date_opened });
  return id;
}

const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => { throw new Error("kein Claude-Aufruf erwartet"); } };

/** Views aus den Tabellen berechnen (wie cellar_overview, cellar_wines, cellar_wine_summary). */
function withViews(tables: Record<string, Row[]>) {
  const wine = (id: unknown) => tables.wines.find((w) => w.id === id) ?? {};
  Object.defineProperty(tables, "cellar_overview", {
    enumerable: true,
    get: () =>
      tables.inventory_items.map((i) => {
        const w = wine(i.wine_id);
        const d = tables.open_bottle_details.find((o) => o.inventory_item_id === i.id);
        return {
          inventory_item_id: i.id, wine_id: i.wine_id, status: i.status, quantity: i.quantity, bottle_size_ml: i.bottle_size_ml,
          name: w.name, producer: w.producer, type: w.type, country: null, region: null, grapes: [], vintage_year: null,
          storage_room: i.storage_room ?? "Keller", storage_house: null, purchase_price: 80, stock_value: i.status === "drunk" ? 0 : 80 * (i.status === "sealed" ? Number(i.quantity) : 1),
          stock_value_regular: null, fill_level_percent: d?.fill_level_percent ?? null, date_opened: d?.date_opened ?? null, drunk_at: i.drunk_at ?? null,
        };
      }),
  });
  Object.defineProperty(tables, "cellar_wine_summary", {
    enumerable: true,
    get: () => tables.wines.map((w) => ({ wine_id: w.id, name: w.name, producer: w.producer, country: null, region: null, type: w.type, grapes: [] })),
  });
  Object.defineProperty(tables, "cellar_wines", {
    enumerable: true,
    get: () =>
      tables.wines.map((w) => {
        const items = tables.inventory_items.filter((i) => i.wine_id === w.id);
        const sealed = items.filter((i) => i.status === "sealed").reduce((s, i) => s + Number(i.quantity), 0);
        const open = items.filter((i) => i.status === "open").length;
        return {
          wine_id: w.id, vintage_year: null, bottle_size_ml: 700, avg_price: 80, price_class: null, drink_from_year: null, drink_until_year: null,
          locations: [{ storage_house: null, storage_room: "Keller", sealed, open }],
        };
      }),
  });
  return tables;
}

function reset({ withFunctions = false } = {}) {
  rpcCalls = [];
  net.tables = withViews({
    wines: [
      { id: LAGA, name: "Lagavulin 16", producer: "Lagavulin", type: "spirit", notes: "Islay, rauchig" },
      { id: TALI, name: "Talisker 10", producer: "Talisker", type: "spirit", notes: "Islay-Nachbar, Skye" },
      { id: WINE, name: "Pintia", producer: "Vega Sicilia", type: "red", notes: null },
    ],
    inventory_items: [],
    open_bottle_details: [],
    spirit_categories: [],
  });
  const t = net.tables;
  net.rpc = {
    open_bottle: (args) => {
      rpcCalls.push("open_bottle");
      return openBottle(t, args);
    },
    ensure_spirit_current: withFunctions
      ? (args) => {
          rpcCalls.push("ensure_spirit_current");
          // Nachbildung der DB-Funktion (gleiche Regeln wie der Weg ohne Migration).
          if (wine(t, args.p_wine_id)?.type !== "spirit") return null;
          const current = t.inventory_items.find((i) => i.wine_id === args.p_wine_id && i.status === "open");
          if (current) return current.id;
          const batch = t.inventory_items.find((i) => i.wine_id === args.p_wine_id && i.status === "sealed" && Number(i.quantity) > 0);
          return batch ? openBottle(t, { p_item_id: batch.id, p_fill_level_percent: 100, p_date_opened: "2026-10-29" }) : null;
        }
      : missing,
    spirit_bottle_empty: withFunctions
      ? (args) => {
          rpcCalls.push("spirit_bottle_empty");
          const item = t.inventory_items.find((i) => i.id === args.p_item_id && i.status === "open");
          if (!item) return { __status: 400, body: { code: "22023", message: "not open" } };
          item.status = "drunk";
          item.drunk_at = "2026-10-29T12:00:00Z";
          const nextId = net.rpc.ensure_spirit_current({ p_wine_id: item.wine_id });
          const left = t.inventory_items.filter((i) => i.wine_id === item.wine_id);
          return { next_id: nextId, remaining: left.reduce((n, i) => n + (i.status === "sealed" ? Number(i.quantity) : i.status === "open" ? 1 : 0), 0) };
        }
      : missing,
  };
}
const wine = (t: Record<string, Row[]>, id: unknown) => t.wines.find((w) => w.id === id);

/** Einbuchen (wie saveJob): Charge anlegen, dann aktuelle Flasche sicherstellen. */
async function buy(wineId: string, quantity: number) {
  net.tables.inventory_items.push({ id: newId(), wine_id: wineId, status: "sealed", quantity, bottle_size_ml: 700, purchased_at: `2026-10-${String(10 + seq).padStart(2, "0")}` });
  return ensureSpiritCurrent(db, wineId, 700);
}
const items = (wineId: string) => net.tables.inventory_items.filter((i) => i.wine_id === wineId);
const count = (wineId: string, status: string) => items(wineId).filter((i) => i.status === status).reduce((s, i) => s + (status === "sealed" ? Number(i.quantity) : 1), 0);
const proposals = (pending: PendingProposal[]) => pending.flatMap((p) => ("proposal" in p ? [p.proposal] : []));
const fillOf = (itemId: string | null) => net.tables.open_bottle_details.find((d) => d.inventory_item_id === itemId)?.fill_level_percent;

installNet(net);
const db = createAdminClient();

for (const withFunctions of [false, true]) {
  const mode = withFunctions ? "mit DB-Funktion" : "ohne Migration";

  test(`Einbuchen (${mode}): erste Flasche wird aktuell mit 100 %, Nachkauf ändert die aktuelle nicht`, async () => {
    reset({ withFunctions });
    const first = await buy(LAGA, 3);
    assert.ok(first);
    assert.deepEqual([count(LAGA, "open"), count(LAGA, "sealed"), fillOf(first)], [1, 2, 100]);
    await setSpiritFill(db, LAGA, 40);
    const again = await buy(LAGA, 2);
    assert.equal(again, first, "gleiche aktuelle Flasche");
    assert.deepEqual([count(LAGA, "open"), count(LAGA, "sealed"), fillOf(first)], [1, 4, 40]);
    // Wein: keine aktuelle Flasche
    assert.equal(await buy(WINE, 2), null);
    assert.equal(count(WINE, "open"), 0);
  });

  test(`Leer (${mode}): aktuelle getrunken, nächste aktuell mit 100 %; letzte → nicht mehr im Bestand`, async () => {
    reset({ withFunctions });
    const first = await buy(LAGA, 2);
    await setSpiritFill(db, LAGA, 30);
    const r1 = await emptySpiritBottle(db, LAGA);
    assert.ok(r1.ok);
    assert.deepEqual([r1.name, r1.remaining], ["Lagavulin 16", 1]);
    assert.notEqual(r1.nextId, first);
    assert.equal(net.tables.inventory_items.find((i) => i.id === first)?.status, "drunk");
    assert.deepEqual([count(LAGA, "open"), count(LAGA, "sealed"), fillOf(r1.nextId)], [1, 0, 100]);
    if (withFunctions) assert.ok(rpcCalls.includes("spirit_bottle_empty"), "atomar über die DB-Funktion");

    const r2 = await emptySpiritBottle(db, LAGA);
    assert.ok(r2.ok);
    assert.deepEqual([r2.remaining, r2.nextId], [0, null]);
    assert.equal(count(LAGA, "drunk"), 2, "beide unter Getrunken");
    assert.equal(net.tables.inventory_items.filter((i) => inStockRow({ status: String(i.status), type: "spirit" })).length, 0);
    const again = await emptySpiritBottle(db, LAGA);
    assert.equal(again.ok, false, "nichts mehr da");
  });

  test(`Füllstand 0 % (${mode}) gilt als leer`, async () => {
    reset({ withFunctions });
    await buy(LAGA, 2);
    const r = await setSpiritFill(db, LAGA, 0);
    assert.ok(r.ok && r.emptied);
    assert.deepEqual([count(LAGA, "drunk"), count(LAGA, "open"), count(LAGA, "sealed")], [1, 1, 0]);
    assert.equal((await setSpiritFill(db, LAGA, 101)).ok, false);
  });
}

test("Bestand: Spirituose mit nur der aktuellen Flasche bleibt drin, zählt wie eine volle; Karte zeigt Füllstand", async () => {
  reset();
  await buy(LAGA, 3);
  await setSpiritFill(db, LAGA, 40);
  await buy(TALI, 1);
  await setSpiritFill(db, TALI, 60);
  const wines = buildCellarWines(
    net.tables.cellar_wine_summary.map((r) => toSummaryWine(r as never)!),
    net.tables.cellar_wines.map((r) => toVintageRow(r as never)!),
    null,
  );
  const laga = wines.find((w) => w.wine_id === LAGA)!;
  const tali = wines.find((w) => w.wine_id === TALI)!;
  assert.deepEqual([laga.sealed, laga.open], [3, 0], "3 Flaschen inkl. aktueller, kein „offen“");
  assert.deepEqual([tali.sealed, tali.open], [1, 0], "nur die aktuelle – trotzdem im Bestand");
  assert.equal(cellarTotals(wines).bottles, 4);
  const fills = currentFills(net.tables.cellar_overview as never);
  assert.equal(currentFillNote(fills.get(LAGA)), "aktuelle ~40 %");
  assert.equal(currentFillNote(100), null, "bei 100 % kein Füllstand");
  // Bestandswert: aktuelle Flasche zählt voll
  const rows = net.tables.cellar_overview as { status: string; type: string; stock_value: number }[];
  assert.equal(rows.filter(inStockRow).reduce((s, r) => s + r.stock_value, 0), 4 * 80);
  // Startseite: aktuelle Flasche zählt wie eine volle, „offen“ ohne Spirituosen
  const home = stockTotals((await loadHomeData(db, null, new Date("2026-10-29T10:00:00Z"))).stock);
  assert.deepEqual([home.bottles, home.spiritBottles, home.open, home.paid], [4, 4, 0, 4 * 80]);
});

test("Offen-Reiter und Bot-Liste „offen“: keine Spirituosen", async () => {
  reset();
  await buy(LAGA, 2);
  net.tables.inventory_items.push({ id: newId(), wine_id: WINE, status: "open", quantity: 1, bottle_size_ml: 750 });
  const rows = net.tables.cellar_overview as { status: string; type: string; wine_id: string }[];
  assert.deepEqual(rows.filter(openWineRow).map((r) => r.wine_id), [WINE]);
  const { count: openCount } = await db.from("cellar_overview").select("inventory_item_id", { count: "exact", head: true }).eq("status", "open").or("type.is.null,type.neq.spirit");
  assert.equal(openCount, 1, "Zähler wie im Reiter");
  const tool = chatTools(db, []).find((t) => t.name === "list_open_bottles")!;
  const out = String(await tool.run({} as never));
  assert.match(out, /Pintia/);
  assert.doesNotMatch(out, /Lagavulin/);
});

test("Bot: „Lagavulin noch 30 %“ und „Lagavulin leer“ – Vorschlag, Ausführung, Antwort", async () => {
  reset();
  await buy(LAGA, 3);
  const pending: PendingProposal[] = [];
  const tool = chatTools(db, pending).find((t) => t.name === "propose_spirit_bottle")!;
  await tool.run({ query: "Lagavulin", action: "fill", percent: 30 } as never);
  assert.deepEqual(proposals(pending), [{ kind: "spiritFill", wineId: LAGA, percent: 30 }]);
  assert.deepEqual(await executeProposal(db, proposals(pending)[0]), { ok: true, text: "Aktuelle Flasche Lagavulin 16: noch 30 %." });
  assert.equal(currentFills(net.tables.cellar_overview as never).get(LAGA), 30);
  // Bestandsfrage: Anzahl und Füllstand
  const lagaInfo = (await loadCellar(db, null)).find((w) => w.wine_id === LAGA)!;
  assert.deepEqual([lagaInfo.sealed, (lagaInfo as { currentFill?: number }).currentFill], [3, 30]);

  pending.length = 0;
  await tool.run({ query: "Lagavulin", action: "empty" } as never);
  assert.deepEqual(proposals(pending), [{ kind: "spiritEmpty", wineId: LAGA }]);
  const done = await executeProposal(db, proposals(pending)[0]);
  assert.deepEqual(done.text, "Lagavulin 16 als getrunken gebucht – noch 2 Flaschen, neue aktuelle Flasche 100 %.");
  assert.equal((await currentBottles(db, LAGA))[0].fill, 100);
  await executeProposal(db, { kind: "spiritEmpty", wineId: LAGA });
  const last = await executeProposal(db, { kind: "spiritEmpty", wineId: LAGA });
  assert.equal(last.text, "Lagavulin 16 als getrunken gebucht – das war die letzte Flasche, nicht mehr im Bestand.");
  // Danach nicht mehr im Bestand – der Bot findet sie nicht mehr
  pending.length = 0;
  assert.match(String(await tool.run({ query: "Lagavulin", action: "empty" } as never)), /Keine Spirituose im Bestand/);
  assert.equal(pending.length, 0);
});

test("Bot: mehrere passende Spirituosen → je ein Vorschlag mit Knöpfen; 0 % = leer", async () => {
  reset();
  await buy(LAGA, 1);
  await buy(TALI, 2);
  const pending: PendingProposal[] = [];
  const tool = chatTools(db, pending).find((t) => t.name === "propose_spirit_bottle")!;
  const out = String(await tool.run({ query: "Islay", action: "fill", percent: 0 } as never));
  assert.match(out, /Mehrere passen/);
  assert.deepEqual(
    proposals(pending).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [{ kind: "spiritEmpty", wineId: LAGA }, { kind: "spiritEmpty", wineId: TALI }],
  );
  // „geöffnet“ bei einer Spirituose: kurze Erklärung statt Vorschlag
  const charge = net.tables.inventory_items.find((i) => i.wine_id === TALI && i.status === "sealed")!;
  const opened = await executeProposal(db, { kind: "open", itemId: String(charge.id) });
  assert.equal(opened.ok, false);
  assert.match(opened.text, /immer eine Flasche als aktuelle/);
});

test("Vorschläge: Kodierung für Telegram-Knöpfe", () => {
  for (const p of [{ kind: "spiritFill", wineId: LAGA, percent: 30 }, { kind: "spiritEmpty", wineId: LAGA }] as const) {
    const data = encodeProposal(p);
    assert.ok(data.length <= 64);
    assert.ok(isChatCallback(data));
    assert.deepEqual(decodeProposal(data), p);
  }
  assert.equal(decodeProposal(`cs:${LAGA}:101`), null);
});
