// Likörweine: „offen gut bis“ = Öffnungsdatum + Haltbarkeit offen (wines.open_keep_days). Schätzung
// nach Stil (inkl. unbekannt), Rangfolge manual/research/estimate, Hinweise „bald trinken“ /
// „über der Zeit“, Likörweine bleiben beim Öffnen Wein (Offen, ohne volle Flaschen nicht im
// Bestand), Spirituosen unverändert. Claude und Supabase per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  KEEP_STYLES,
  decideKeep,
  estimateKeep,
  guessKeepStyle,
  keepDuration,
  keepLine,
  keepStatus,
  keepText,
  keepUntil,
} from "@/lib/fortified/keep";
import { evaluateOpenKeep, findAndStoreOpenKeep } from "@/lib/research/open-keep";
import { ensureOpenKeep, saveManualKeep } from "@/lib/fortified/store";
import { keepMissing, type WineGaps } from "@/lib/research/gaps";
import { buildCellarWines } from "@/lib/cellar/overview";
import { inStockRow, openWineRow } from "@/lib/spirits/tag";
import { openBottles, type StockItem } from "@/lib/home/summary";
import { DAILY_SYSTEM, dailyPrompt } from "@/lib/home/prompt";
import { noteContext } from "@/lib/home/compose";
import { openBottleLine } from "@/lib/chat/menu-view";
import { executeProposal } from "@/lib/chat/execute";
import { runLater } from "@/lib/later";

test("Gut bis = Öffnungsdatum + Tage; neues Öffnungsdatum rechnet neu", () => {
  assert.equal(keepUntil("2026-10-28", 28), "2026-11-25");
  assert.equal(keepUntil("2026-12-20", 21), "2027-01-10", "über den Jahreswechsel");
  assert.equal(keepUntil("2026-10-28", null), null);
  assert.equal(keepUntil(null, 28), null);
  assert.equal(keepStatus("2026-10-28", 28, "2026-10-29")?.text, "offen gut bis 25.11.");
  // Öffnungsdatum geändert → gut bis verschiebt sich mit
  assert.equal(keepStatus("2026-11-02", 28, "2026-11-03")?.text, "offen gut bis 30.11.");
});

test("Hinweise: ab 7 Tagen davor „bald trinken“, danach „X Tage über der Zeit“", () => {
  assert.deepEqual(keepStatus("2026-10-01", 28, "2026-10-21"), { until: "2026-10-29", text: "offen gut bis 29.10.", hint: null, status: "ok" });
  assert.equal(keepStatus("2026-10-01", 28, "2026-10-22")?.hint, "bald trinken", "7 Tage davor");
  assert.equal(keepStatus("2026-10-01", 28, "2026-10-29")?.status, "now", "am letzten Tag");
  assert.deepEqual(keepStatus("2026-10-01", 28, "2026-10-30"), { until: "2026-10-29", text: "offen gut bis 29.10.", hint: "1 Tag über der Zeit", status: "overdue" });
  assert.equal(keepLine(keepStatus("2026-10-01", 28, "2026-11-01")), "offen gut bis 29.10. · 3 Tage über der Zeit");
  assert.equal(keepLine(null), null);
});

test("Schätzung nach Stil (Tabelle), auch unbekannt; Stil aus dem Namen", () => {
  const days = Object.fromEntries(Object.entries(KEEP_STYLES).map(([k, v]) => [k, v.days]));
  assert.deepEqual(days, {
    fino_manzanilla: 7, amontillado: 21, oloroso_cream_px: 60, port_white_ruby_reserve: 28, port_lbv: 21, port_tawny: 42,
    port_tawny_aged: 60, port_vintage: 3, madeira: 365, marsala: 90, vermouth: 60, vdn: 30, unknown: 30,
    liqueur_cream: 180, liqueur_fruit: 365, liqueur_coffee: 365, liqueur_nut: 730, liqueur_herb: 730, liqueur: 365,
  });
  assert.deepEqual(estimateKeep("port_tawny"), { days: 42, source: "estimate", note: "Schätzung nach Stil: Tawny" });
  assert.deepEqual(estimateKeep(null), { days: 30, source: "estimate", note: "Schätzung nach Stil: Stil unbekannt" });
  const g = (name: string, extra: Record<string, string> = {}) => guessKeepStyle({ name, ...extra });
  assert.equal(g("Fine White", { producer: "Quinta do Estanho", country: "Portugal", region: "Douro" }), "port_white_ruby_reserve");
  assert.equal(g("Antica Formula", { producer: "Giuseppe B. Carpano", country: "Italien" }), "vermouth");
  assert.equal(g("Tio Pepe Fino"), "fino_manzanilla");
  assert.equal(g("Tawny 20 Years", { country: "Portugal" }), "port_tawny_aged");
  assert.equal(g("Tawny Port"), "port_tawny");
  assert.equal(g("LBV 2018 Port"), "port_lbv");
  assert.equal(g("Vintage Port 2017"), "port_vintage");
  assert.equal(g("Blandy's 10 Year Old Malmsey"), "madeira");
  assert.equal(g("Banyuls Rimage"), "vdn");
  assert.equal(g("Irgendwas"), "unknown");
  assert.equal(keepDuration(28), "ca. 4 Wochen");
  assert.equal(keepText(28, "research"), "offen ca. 4 Wochen");
  assert.equal(keepText(42, "estimate"), "offen ≈ 6 Wochen");
  assert.equal(keepText(365, "manual"), "offen ca. 1 Jahr");
  assert.equal(keepText(3, "estimate"), "offen ≈ 3 Tage");
});

test("Rangfolge: manual nie automatisch, research ersetzt estimate, estimate ersetzt nichts", () => {
  const research = { days: 35, source: "research" as const, note: "x" };
  const estimate = { days: 30, source: "estimate" as const, note: "y" };
  assert.equal(decideKeep(null, estimate), "set");
  assert.equal(decideKeep({ days: null, source: null }, research), "set");
  assert.equal(decideKeep({ days: 28, source: "estimate" }, research), "set");
  assert.equal(decideKeep({ days: 35, source: "estimate" }, research), "keep", "gleicher Wert");
  assert.equal(decideKeep({ days: 28, source: "estimate" }, estimate), "keep");
  assert.equal(decideKeep({ days: 28, source: "research" }, research), "keep");
  assert.equal(decideKeep({ days: 28, source: "research" }, estimate), "keep");
  assert.equal(decideKeep({ days: 10, source: "manual" }, research), "keep");
  assert.equal(decideKeep({ days: 10, source: null }, research), "keep", "ohne Herkunft = von Hand");
  assert.equal(decideKeep(null, { ...research, days: 0 }), "keep", "unplausibel");
});

test("Recherche-Antwort: Quelle mit Zitat → research, sonst Schätzung nach Stil (bzw. aus dem Namen)", () => {
  const wine = { name: "Fine White", producer: "Quinta do Estanho", country: "Portugal", region: "Douro", appellation: null };
  const raw = { matches_wine: true, style: "port_white_ruby_reserve" as const, keep_days: 35, sources: [{ url: "https://www.quintadoestanho.com/fine-white", title: "Fine White" }], quote: "Once opened, keep refrigerated and consume within 4–6 weeks." };
  assert.deepEqual(evaluateOpenKeep(raw, wine), { days: 35, source: "research", note: "quintadoestanho.com (Weisser Port/Ruby/Reserve)" });
  assert.deepEqual(evaluateOpenKeep({ ...raw, quote: "" }, wine), estimateKeep("port_white_ruby_reserve"));
  assert.deepEqual(evaluateOpenKeep({ ...raw, keep_days: 0, sources: [] , style: "unknown" }, wine), estimateKeep("port_white_ruby_reserve"), "Stil aus dem Namen");
  assert.deepEqual(evaluateOpenKeep(null, { ...wine, name: "X", producer: null, country: null, region: null }), estimateKeep("unknown"));
});

// --- Mit Stub: Speichern nach Rangfolge, Öffnen im Bot

const PORT = "11111111-1111-4111-8111-111111111111";
const RED = "22222222-2222-4222-8222-222222222222";
let answer: Record<string, unknown> = {};
let calls = 0;
const net: Net = {
  tables: {},
  telegram: [],
  rpc: {},
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name).filter(Boolean) ?? [];
    if (!tools.includes("report_open_keep")) throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
    calls++;
    return claudeTool("report_open_keep", answer);
  },
};
installNet(net);
const db = createAdminClient();
const SOURCE = { matches_wine: true, style: "port_white_ruby_reserve", keep_days: 35, sources: [{ url: "https://www.quintadoestanho.com/x", title: "x" }], quote: "Consume within 4–6 weeks of opening." };
const NOTHING = { matches_wine: false, style: "port_white_ruby_reserve", keep_days: 0, sources: [], quote: "" };

function reset(keep: Record<string, unknown> = {}) {
  calls = 0;
  answer = SOURCE;
  net.tables = {
    wines: [
      { id: PORT, name: "Fine White", producer: "Quinta do Estanho", type: "fortified", country: "Portugal", region: "Douro", appellation: null, alcohol_content: 19, open_keep_days: null, open_keep_source: null, open_keep_note: null, ...keep },
      { id: RED, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: 14.5, open_keep_days: null, open_keep_source: null, open_keep_note: null },
    ],
  };
}
const port = () => net.tables.wines.find((w) => w.id === PORT)!;

test("Speichern: leer → Quelle; Schätzung → durch Quelle ersetzt; von Hand bleibt; kein Likörwein → nichts", async () => {
  reset();
  assert.equal((await findAndStoreOpenKeep(db, PORT)).result, "set");
  assert.deepEqual([port().open_keep_days, port().open_keep_source], [35, "research"]);
  assert.equal((await findAndStoreOpenKeep(db, PORT)).result, "exists", "nach dem Einbuchen nur wenn leer");

  reset();
  answer = NOTHING;
  await findAndStoreOpenKeep(db, PORT);
  assert.deepEqual([port().open_keep_days, port().open_keep_source, port().open_keep_note], [28, "estimate", "Schätzung nach Stil: Weisser Port/Ruby/Reserve"]);
  answer = SOURCE;
  assert.equal((await findAndStoreOpenKeep(db, PORT, { onlyIfEmpty: false })).result, "set", "Quelle ersetzt Schätzung");
  assert.deepEqual([port().open_keep_days, port().open_keep_source], [35, "research"]);
  answer = NOTHING;
  assert.equal((await findAndStoreOpenKeep(db, PORT, { onlyIfEmpty: false })).result, "exists", "research bleibt");
  assert.equal(port().open_keep_days, 35);

  reset({ open_keep_days: 10, open_keep_source: "manual" });
  assert.equal((await findAndStoreOpenKeep(db, PORT, { onlyIfEmpty: false })).result, "exists");
  assert.deepEqual([port().open_keep_days, calls], [10, 0], "von Hand: nicht einmal gesucht");

  reset();
  assert.equal((await findAndStoreOpenKeep(db, RED)).result, "none");
  assert.equal(calls, 0);
});

test("Von Hand: Tage setzen → manual; nur bei Likörweinen", async () => {
  reset({ open_keep_days: 28, open_keep_source: "estimate", open_keep_note: "Schätzung" });
  assert.equal(await saveManualKeep(db, PORT, 21), true);
  assert.deepEqual([port().open_keep_days, port().open_keep_source, port().open_keep_note], [21, "manual", null]);
  assert.equal(await saveManualKeep(db, RED, 21), false);
});

test("„Haltbarkeit offen fehlt“: nur Likörweine ohne bzw. mit geschätzter Haltbarkeit", () => {
  const g = (id: string, type: string) => ({ wine: { id, type } }) as unknown as WineGaps;
  const keep = new Map([
    ["a", { days: 28, source: "estimate" }],
    ["b", { days: 28, source: "research" }],
    ["c", { days: 10, source: "manual" }],
  ]);
  assert.deepEqual(
    [g("a", "fortified"), g("b", "fortified"), g("c", "fortified"), g("d", "fortified"), g("e", "red"), g("f", "spirit")].map((x) => keepMissing(x, keep)),
    [true, false, false, true, false, false],
  );
});

test("Likörwein bleibt beim Öffnen Wein: unter Offen, ohne volle Flaschen nicht im Bestand; Spirituose unverändert", () => {
  const summary = (id: string, type: "fortified" | "spirit") => ({ wine_id: id, name: id, producer: null, country: null, region: null, type, grapes: [] });
  const row = (id: string) => ({ wine_id: id, vintage_year: null, bottle_size_ml: 750, avg_price: null, price_class: null, drink_status: "unknown" as const, drink_from_year: null, drink_until_year: null, locations: [{ storage_house: null, storage_room: "Keller", sealed: 0, open: 1 }] });
  const wines = buildCellarWines([summary("port", "fortified"), summary("whisky", "spirit")], [row("port"), row("whisky")], null);
  const portWine = wines.find((w) => w.wine_id === "port")!;
  const whisky = wines.find((w) => w.wine_id === "whisky")!;
  assert.deepEqual([portWine.sealed, portWine.open], [0, 1], "Likörwein: offen, keine volle");
  assert.deepEqual(wines.filter((w) => w.sealed > 0).map((w) => w.wine_id), ["whisky"], "Bestand: nur die Spirituose (aktuelle Flasche)");
  assert.deepEqual([whisky.sealed, whisky.open], [1, 0]);
  assert.equal(openWineRow({ status: "open", type: "fortified" }), true);
  assert.equal(inStockRow({ status: "open", type: "fortified" }), false);
  assert.equal(openWineRow({ status: "open", type: "spirit" }), false);
});

test("Startseite und Tagestext: offene Likörweine mit „gut bis“; Bot-Liste „Offen“ nennt das Datum", () => {
  const base = { name: "Fine White", producer: "Quinta do Estanho", year: null, quantity: 1, paid: null, regular: null, purchasedAt: null, drinkFrom: null, drinkUntil: null };
  const stock: StockItem[] = [
    { ...base, itemId: "i1", wineId: PORT, type: "fortified", status: "open", dateOpened: "2026-10-01", keepDays: 28 },
    { ...base, itemId: "i2", wineId: RED, name: "Pintia", type: "red", status: "open", dateOpened: "2026-10-27" },
  ];
  const open = openBottles(stock, "2026-10-29");
  assert.equal(keepLine(open.find((o) => o.wineId === PORT)!.keep), "offen gut bis 29.10. · bald trinken");
  assert.equal(open.find((o) => o.wineId === RED)!.keep, null);
  const ctx = noteContext({ stock, drunk: [], purchases: [], tastedThisMonth: 0, ratings: [], pendingSuggestions: 0, notes: null } as never, "Michel", new Date("2026-10-29T06:00:00Z"));
  const prompt = dailyPrompt({ ...ctx.prompt, person: "Michel", previous: [], refs: ctx.refs });
  assert.match(prompt, /Fine White.*offen seit 28 Tagen \(offen gut bis 29\.10\. · bald trinken\)/);
  assert.match(DAILY_SYSTEM, /Likörweine und Liköre, die offen bald über der Zeit sind/);
  assert.match(
    openBottleLine({ itemId: "i1", wineId: PORT, producer: null, name: "", year: null, type: "fortified", fill: 80, days: 28, room: null, keep: "offen gut bis 29.10. · bald trinken" }, "Fine White"),
    /Fine White · 80 % · .*28.* · offen gut bis 29\.10\. · bald trinken$/,
  );
});

test("Bot öffnet einen Likörwein: „offen gut bis TT.MM.“ – ohne Haltbarkeit erst geschätzt, dann recherchiert", async () => {
  reset();
  answer = SOURCE;
  const BATCH = "33333333-3333-4333-8333-333333333333";
  net.tables.inventory_items = [{ id: BATCH, wine_id: PORT, status: "sealed", quantity: 2, vintage_year: null }];
  net.tables.cellar_overview = [];
  net.rpc = {
    open_bottle: (args) => {
      const id = "44444444-4444-4444-8444-444444444444";
      net.tables.cellar_overview.push({ inventory_item_id: id, wine_id: PORT, producer: "Quinta do Estanho", name: "Fine White", vintage_year: null, status: "open", type: "fortified" });
      assert.equal(args.p_item_id, BATCH);
      return id;
    },
  };
  const result = await executeProposal(db, { kind: "open", itemId: BATCH });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const until = keepUntil(today, 28)!;
  assert.ok(result.ok);
  assert.ok(result.text.endsWith(`geöffnet – offen gut bis ${until.slice(8, 10)}.${until.slice(5, 7)}..`), result.text);
  assert.deepEqual([port().open_keep_days, port().open_keep_source], [28, "estimate"], "sofort geschätzt");
  await runLater();
  assert.deepEqual([port().open_keep_days, port().open_keep_source], [35, "research"], "Recherche ersetzt die Schätzung");
  // Schon bekannt: keine neue Suche
  calls = 0;
  assert.equal(await ensureOpenKeep(db, PORT), 35);
  assert.equal(calls, 0);
});
