// Spirituosen öffnet man von Hand: Einbuchen lässt alle Flaschen zu; Öffnen setzt Datum (heute)
// und 100 %, eine zweite fragt erst nach; „leer“ (auch 0 %) bucht getrunken, ohne dass eine nächste
// nachrückt; die letzte verschwindet aus dem Bestand. Offene bleiben im Bestand, nie unter „Offen“.
// Liköre (Kategorie Likör) bekommen „offen gut bis“, andere Spirituosen nicht.
// Supabase per fetch-Stub mit kleiner Nachbildung der Views. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { emptySpiritBottle, openSpiritBottles, setSpiritFill } from "@/lib/spirits/bottles";
import { buildCellarWines, cellarTotals, toSummaryWine, toVintageRow } from "@/lib/cellar/overview";
import { emptiedRest, inStockRow, openSpiritInfo, openWineRow, spiritOpenNote } from "@/lib/spirits/tag";
import { chatTools, type PendingProposal } from "@/lib/chat/tools";
import { executeProposal } from "@/lib/chat/execute";
import { decodeProposal, encodeProposal, isChatCallback } from "@/lib/chat/proposals";
import { stockTotals } from "@/lib/home/summary";
import { loadHomeData } from "@/lib/home/data";
import { ensureOpenKeep, loadOpenKeep } from "@/lib/fortified/store";
import { estimateKeep, keepApplies, keepStatus, keepUntil, liqueurStyle } from "@/lib/fortified/keep";
import { runLater } from "@/lib/later";

type Row = Record<string, unknown>;
const LAGA = "11111111-1111-4111-8111-111111111111";
const TALI = "22222222-2222-4222-8222-222222222222";
const WINE = "33333333-3333-4333-8333-333333333333";
const BAILEYS = "55555555-5555-4555-8555-555555555555";
const CAT_LIQUEUR = "c-likoer";
const CAT_CREAM = "c-sahne";
const CAT_WHISKY = "c-whisky";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

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
          sealed_bottles: sealed, open_bottles: open,
          locations: [{ storage_house: null, storage_room: "Keller", sealed, open }],
        };
      }),
  });
  return tables;
}

/** rpc: spirit_bottle_empty wie die neue DB-Funktion („new“), wie die alte („old“, öffnet die nächste) oder fehlt („missing“). */
function reset(fn: "new" | "old" | "missing" = "new") {
  net.tables = withViews({
    wines: [
      { id: LAGA, name: "Lagavulin 16", producer: "Lagavulin", type: "spirit", notes: "Islay, rauchig", spirit_category_id: CAT_WHISKY, open_keep_days: null, open_keep_source: null, open_keep_note: null },
      { id: TALI, name: "Talisker 10", producer: "Talisker", type: "spirit", notes: "Islay-Nachbar, Skye", spirit_category_id: CAT_WHISKY, open_keep_days: null, open_keep_source: null, open_keep_note: null },
      { id: WINE, name: "Pintia", producer: "Vega Sicilia", type: "red", notes: null, spirit_category_id: null, open_keep_days: null, open_keep_source: null, open_keep_note: null },
      { id: BAILEYS, name: "Baileys Original", producer: "Baileys", type: "spirit", notes: null, spirit_category_id: CAT_CREAM, open_keep_days: null, open_keep_source: null, open_keep_note: null, country: "Irland", region: null, appellation: null },
    ],
    spirit_categories: [
      { id: CAT_WHISKY, parent_id: null, name: "Whisky", sort_order: 1 },
      { id: CAT_LIQUEUR, parent_id: null, name: "Likör", sort_order: 2 },
      { id: CAT_CREAM, parent_id: CAT_LIQUEUR, name: "Sahne", sort_order: 1 },
    ],
    inventory_items: [],
    open_bottle_details: [],
  });
  const t = net.tables;
  net.rpc = {
    open_bottle: (args) => openBottle(t, args),
    spirit_bottle_empty:
      fn === "missing"
        ? () => ({ __status: 404, body: { code: "PGRST202", message: "Could not find the function" } })
        : (args) => {
            const item = t.inventory_items.find((i) => i.id === args.p_item_id && i.status === "open");
            if (!item) return { __status: 400, body: { code: "22023", message: "not open" } };
            item.status = "drunk";
            const d = t.open_bottle_details.find((o) => o.inventory_item_id === item.id);
            if (d) d.fill_level_percent = 0;
            // Alte Funktion: öffnet gleich die nächste volle Flasche (soll die App rückgängig machen).
            const batch = fn === "old" ? t.inventory_items.find((i) => i.wine_id === item.wine_id && i.status === "sealed" && Number(i.quantity) > 0) : null;
            const next = batch ? openBottle(t, { p_item_id: batch.id, p_fill_level_percent: 100, p_date_opened: today }) : null;
            return { next_id: next, remaining: 0 };
          },
  };
}

/** Einbuchen (wie saveJob): eine Charge, alle Flaschen zu. */
function buy(wineId: string, quantity: number) {
  const id = newId();
  net.tables.inventory_items.push({ id, wine_id: wineId, vintage_year: null, status: "sealed", quantity, bottle_size_ml: 700, purchased_at: `2026-10-${String(10 + (seq % 15)).padStart(2, "0")}` });
  return id;
}
const items = (wineId: string) => net.tables.inventory_items.filter((i) => i.wine_id === wineId);
const count = (wineId: string, status: string) => items(wineId).filter((i) => i.status === status).reduce((s, i) => s + (status === "sealed" ? Number(i.quantity) : 1), 0);
const proposals = (pending: PendingProposal[]) => pending.flatMap((p) => ("proposal" in p ? [p.proposal] : []));
const texts = (pending: PendingProposal[]) => pending.map((p) => p.text);
/** Bestandskarte wie auf /bestand: „2 Fl.“ und Zusatz. */
const card = (wineId: string) => {
  const total = count(wineId, "sealed") + count(wineId, "open");
  const note = spiritOpenNote(total, openSpiritInfo(net.tables.cellar_overview as never).get(wineId));
  return [`${total} Fl.`, note].filter(Boolean).join(" · ");
};

installNet(net);
const db = createAdminClient();

test("Einbuchen: alle Flaschen zu; Öffnen setzt heute und 100 %; Karte „2 Fl. · 1 offen“", async () => {
  reset();
  const batch = buy(LAGA, 2);
  assert.deepEqual([count(LAGA, "sealed"), count(LAGA, "open")], [2, 0]);
  assert.equal(card(LAGA), "2 Fl.");
  const opened = await executeProposal(db, { kind: "open", itemId: batch });
  assert.ok(opened.ok, opened.text);
  assert.match(opened.text, /geöffnet\.$/, "Whisky: kein „offen gut bis“");
  const [bottle] = await openSpiritBottles(db, LAGA);
  assert.deepEqual([bottle.fill, bottle.dateOpened], [100, today]);
  assert.equal(card(LAGA), "2 Fl. · 1 offen");
  await setSpiritFill(db, LAGA, 40);
  assert.equal(card(LAGA), "2 Fl. · 1 offen ~40 %");
});

test("Zweite öffnen: Rückfrage „Es ist schon eine offen (~40 %). Trotzdem eine weitere öffnen?“", async () => {
  reset();
  const batch = buy(LAGA, 2);
  await executeProposal(db, { kind: "open", itemId: batch });
  await setSpiritFill(db, LAGA, 40);
  const pending: PendingProposal[] = [];
  const tool = chatTools(db, pending).find((t) => t.name === "propose_open_bottle")!;
  await tool.run({ wine_id: LAGA, vintage_year: null } as never);
  assert.deepEqual(proposals(pending), [{ kind: "open", itemId: batch }]);
  assert.match(texts(pending)[0], /Es ist schon eine offen \(~40 %\)\. Trotzdem eine weitere öffnen\?$/);
  // Ohne offene: keine Rückfrage
  reset();
  const fresh = buy(LAGA, 1);
  const pending2: PendingProposal[] = [];
  await chatTools(db, pending2).find((t) => t.name === "propose_open_bottle")!.run({ wine_id: LAGA, vintage_year: null } as never);
  assert.deepEqual(proposals(pending2), [{ kind: "open", itemId: fresh }]);
  assert.doesNotMatch(texts(pending2)[0], /schon eine offen/);
});

for (const fn of ["new", "old", "missing"] as const) {
  test(`Leer (DB-Funktion ${fn}): getrunken, keine Flasche rückt nach; letzte → nicht mehr im Bestand`, async () => {
    reset(fn);
    const batch = buy(LAGA, 2);
    await executeProposal(db, { kind: "open", itemId: batch });
    const r1 = await emptySpiritBottle(db, LAGA);
    assert.ok(r1.ok);
    assert.deepEqual([r1.sealed, r1.open], [1, 0]);
    assert.deepEqual([count(LAGA, "drunk"), count(LAGA, "open"), count(LAGA, "sealed")], [1, 0, 1], "nichts automatisch geöffnet");
    assert.equal(card(LAGA), "1 Fl.");
    assert.equal(emptiedRest(r1.sealed, r1.open), "als getrunken gebucht – noch 1 Flasche (zu).");
    assert.equal((await emptySpiritBottle(db, LAGA)).ok, false, "keine offen → nichts geändert");

    const last = net.tables.inventory_items.find((i) => i.wine_id === LAGA && i.status === "sealed")!;
    await executeProposal(db, { kind: "open", itemId: String(last.id) });
    const done = await executeProposal(db, { kind: "drunk", itemId: (await openSpiritBottles(db, LAGA))[0].itemId });
    assert.equal(done.text, "Lagavulin 16 als getrunken gebucht – das war die letzte Flasche, nicht mehr im Bestand.");
    assert.equal(count(LAGA, "drunk"), 2, "beide unter Getrunken");
    assert.equal((net.tables.cellar_overview as { wine_id: string; status: string; type: string }[]).filter((r) => r.wine_id === LAGA && inStockRow(r)).length, 0);
  });
}

test("Füllstand 0 % gilt als leer; mehrere offene → welche?", async () => {
  reset();
  const batch = buy(LAGA, 3);
  await executeProposal(db, { kind: "open", itemId: batch });
  const r = await setSpiritFill(db, LAGA, 0);
  assert.ok(r.ok && r.emptied);
  assert.deepEqual([count(LAGA, "drunk"), count(LAGA, "open"), count(LAGA, "sealed")], [1, 0, 2]);
  await executeProposal(db, { kind: "open", itemId: batch });
  await executeProposal(db, { kind: "open", itemId: batch });
  const which = await emptySpiritBottle(db, LAGA);
  assert.equal(which.ok, false);
  assert.ok(!which.ok && which.choices?.length === 2, "zwei offene zur Auswahl");
  assert.equal(card(LAGA), "2 Fl. · offen", "nur offene");
});

test("Bestand: Spirituose bleibt drin (auch nur offene), zählt in Anzahl und Wert wie volle; Offen ohne Spirituosen", async () => {
  reset();
  await executeProposal(db, { kind: "open", itemId: buy(TALI, 1) });
  await setSpiritFill(db, TALI, 40);
  buy(LAGA, 2);
  net.tables.inventory_items.push({ id: newId(), wine_id: WINE, status: "open", quantity: 1, bottle_size_ml: 750 });
  const wines = buildCellarWines(
    net.tables.cellar_wine_summary.map((r) => toSummaryWine(r as never)!),
    net.tables.cellar_wines.map((r) => toVintageRow(r as never)!),
    null,
  );
  assert.deepEqual(wines.filter((w) => w.sealed > 0).map((w) => w.wine_id).sort(), [LAGA, TALI].sort(), "Pintia (nur offen) nicht im Bestand");
  assert.equal(cellarTotals(wines).bottles, 3);
  assert.equal(card(TALI), "1 Fl. · offen ~40 %");
  const rows = net.tables.cellar_overview as { status: string; type: string; stock_value: number; wine_id: string }[];
  assert.equal(rows.filter(inStockRow).reduce((s, r) => s + r.stock_value, 0), 3 * 80);
  assert.deepEqual(rows.filter(openWineRow).map((r) => r.wine_id), [WINE], "Offen: nur Wein");
  const { count: openCount } = await db.from("cellar_overview").select("inventory_item_id", { count: "exact", head: true }).eq("status", "open").or("type.is.null,type.neq.spirit");
  assert.equal(openCount, 1);
  const out = String(await chatTools(db, []).find((t) => t.name === "list_open_bottles")!.run({} as never));
  assert.match(out, /Pintia/);
  assert.doesNotMatch(out, /Talisker/);
  const home = stockTotals((await loadHomeData(db, null, new Date())).stock);
  assert.deepEqual([home.bottles, home.spiritBottles, home.open], [3, 3, 1], "offen: nur der Pintia");
});

test("Bot: „noch 30 %“ und „leer“ für die offene Flasche; mehrere offene → je ein Vorschlag (welche?)", async () => {
  reset();
  const batch = buy(LAGA, 3);
  const pending: PendingProposal[] = [];
  const tool = chatTools(db, pending).find((t) => t.name === "propose_spirit_bottle")!;
  assert.match(String(await tool.run({ query: "Lagavulin", action: "empty" } as never)), /keine Flasche offen/);
  assert.equal(pending.length, 0);

  await executeProposal(db, { kind: "open", itemId: batch });
  const [open] = await openSpiritBottles(db, LAGA);
  await tool.run({ query: "Lagavulin", action: "fill", percent: 30 } as never);
  assert.deepEqual(proposals(pending), [{ kind: "fill", itemId: open.itemId, percent: 30 }]);
  assert.ok((await executeProposal(db, proposals(pending)[0])).ok);
  assert.equal((await openSpiritBottles(db, LAGA))[0].fill, 30);

  pending.length = 0;
  await tool.run({ query: "Lagavulin", action: "empty" } as never);
  assert.deepEqual(proposals(pending), [{ kind: "drunk", itemId: open.itemId }]);
  assert.equal((await executeProposal(db, proposals(pending)[0])).text, "Lagavulin 16 als getrunken gebucht – noch 2 Flaschen (zu).");

  // Zwei offen: je ein Vorschlag, mit Öffnungsdatum und Füllstand zur Unterscheidung
  await executeProposal(db, { kind: "open", itemId: batch });
  await executeProposal(db, { kind: "open", itemId: batch });
  pending.length = 0;
  const many = String(await tool.run({ query: "Lagavulin", action: "fill", percent: 0 } as never));
  assert.match(many, /Mehrere offene Flaschen/);
  assert.equal(pending.length, 2);
  assert.ok(proposals(pending).every((p) => p.kind === "drunk"));
  assert.ok(texts(pending).every((t) => /geöffnet am \d\d\.\d\d\., ~100 %/.test(t)), texts(pending).join(" | "));
});

test("Bot: mehrere passende Spirituosen mit offener Flasche → je ein Vorschlag", async () => {
  reset();
  await executeProposal(db, { kind: "open", itemId: buy(LAGA, 1) });
  await executeProposal(db, { kind: "open", itemId: buy(TALI, 2) });
  const pending: PendingProposal[] = [];
  await chatTools(db, pending).find((t) => t.name === "propose_spirit_bottle")!.run({ query: "Islay", action: "empty" } as never);
  assert.equal(pending.length, 2);
  assert.deepEqual(texts(pending).map((t) => t.split(" ")[0]).sort(), ["Lagavulin", "Talisker"]);
});

test("Likör: Schätzung nach Unterkategorie, „offen gut bis“ beim Öffnen; Whisky ohne", async () => {
  assert.deepEqual(
    [["Likör", "Sahne"], ["Likör", "Frucht"], ["Likör", "Kaffee"], ["Likör", "Nuss"], ["Likör", "Kräuter"], ["Likör", null], ["Likoer", "Sahne"], ["Whisky", "Bourbon"], ["Kräuterschnaps / Bitter", null], [null, null]].map(
      ([main, sub]) => {
        const style = liqueurStyle(main, sub);
        return style ? estimateKeep(style).days : null;
      },
    ),
    [180, 365, 365, 730, 730, 365, 180, null, null, null],
  );
  assert.equal(keepApplies("spirit", "Likör"), true);
  assert.equal(keepApplies("spirit", "Whisky"), false);
  assert.equal(keepApplies("fortified", null), true);
  assert.equal(keepApplies("red", "Likör"), false);

  reset();
  const keep = await loadOpenKeep(db, [LAGA, BAILEYS, WINE]);
  assert.deepEqual([...keep.keys()], [BAILEYS], "nur der Likör");
  assert.equal(await ensureOpenKeep(db, LAGA), null, "Whisky: kein „gut bis“");
  const opened = await executeProposal(db, { kind: "open", itemId: buy(BAILEYS, 1) });
  const until = keepUntil(today, 180)!;
  assert.ok(opened.text.endsWith(`geöffnet – offen gut bis ${until.slice(8, 10)}.${until.slice(5, 7)}..`), opened.text);
  const baileys = net.tables.wines.find((w) => w.id === BAILEYS)!;
  assert.deepEqual([baileys.open_keep_days, baileys.open_keep_source, baileys.open_keep_note], [180, "estimate", "Schätzung nach Stil: Sahnelikör"]);
  await runLater().catch(() => undefined); // Recherche im Hintergrund (Stub ohne Claude: Fehler nur im Log)
  assert.equal(keepStatus("2026-01-01", 180, "2026-06-25")?.hint, "bald trinken");
  // Bestandsfrage: Anzahl, offen, Füllstand und „gut bis“
  const cellar = JSON.parse(String(await chatTools(db, []).find((t) => t.name === "search_cellar")!.run({ query: "Baileys" } as never)));
  const b = cellar.wines[0];
  assert.deepEqual([b.bottles_total, b.bottles_open, b.open_fill_percent], [1, 1, 100]);
  assert.match(b.open_good_until, /^offen gut bis \d\d\.\d\d\./);
});

test("Migration: Haltbarkeit auch bei Spirituosen, Trigger leert bei Wechsel zu Wein; kein Nachrücken", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261029145554_spirit_open_by_hand.sql", import.meta.url), "utf8");
  assert.match(sql, /type::text in \('fortified', 'spirit'\) or \(open_keep_days is null/);
  assert.match(sql, /if new\.type is null or new\.type::text not in \('fortified', 'spirit'\) then\s+new\.open_keep_days := null;/);
  assert.match(sql, /drop function if exists public\.ensure_spirit_current/);
  assert.doesNotMatch(sql.slice(sql.indexOf("spirit_bottle_empty"), sql.indexOf("drop function")), /open_bottle\(|ensure_spirit_current\(/);
});

test("Vorschläge: Kodierung für Telegram-Knöpfe (ältere Nachrichten)", () => {
  for (const p of [{ kind: "spiritFill", wineId: LAGA, percent: 30 }, { kind: "spiritEmpty", wineId: LAGA }] as const) {
    const data = encodeProposal(p);
    assert.ok(data.length <= 64);
    assert.ok(isChatCallback(data));
    assert.deepEqual(decodeProposal(data), p);
  }
});
