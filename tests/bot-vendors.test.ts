// Händler-Auswahl im Bot: die 8 meistgenutzten zuerst (Anzahl Chargen, bei Gleichstand zuletzt
// benutzt), „📋 Alle Händler“ zeigt alle alphabetisch (ab 25 seitenweise mit „Weiter“); getippter
// Name mit anderer Schreibweise → „Meinst du …?“ statt doppelt anlegen. Stubs, ohne Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { processTextJob } from "@/lib/ingest/flow";
import { rankVendors, similarVendor, vendorKey } from "@/lib/ingest/wines";
import { VENDORS_PER_PAGE } from "@/lib/ingest/messages";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import type { IngestState } from "@/lib/ingest/schema";

const JOB = "aaaaaaaa-0000-4000-8000-00000000000b";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
let parseResult: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if ((body.output_config as { format?: unknown } | undefined)?.format) return claudeText(parseResult);
    if (tools.includes("report_wine_details")) return claudeTool("report_wine_details", { producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5, vintages: [], sources: [] });
    if (tools.includes("report_grape_shares")) return claudeTool("report_grape_shares", { grapes: [], percentages_for_vintage: false, sources: [] });
    if (tools.includes("report_taste_profile")) return claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);

/** 20 Händler; Chargen je Händler (Napa Wine 13 …), Casa Lusitania unbenutzt. */
const USE: [string, number, string?][] = [
  ["Mövenpick", 9], ["Napa Wine", 13], ["Otto's", 4, "2026-10-01"], ["Turicum", 4, "2026-09-01"], ["Urs Hecht", 3], ["Villa Contea", 5],
  ["Coop", 2], ["Denner", 1], ["Drinks.ch", 6], ["Flaschenpost", 2, "2026-10-20"], ["Gerstl", 1], ["Globus", 1], ["Casa Lusitania", 0],
  ["Smith & Smith", 2, "2026-01-01"], ["Galaxus", 1], ["Manor", 1], ["Bindella", 1], ["Caratello", 1], ["Lidl", 1], ["Aldi", 1],
];
const vid = (i: number) => `00000000-0000-4000-9000-${String(i + 1).padStart(12, "0")}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset(extraVendors = 0) {
  const vendors = [...USE.map(([name], i) => ({ id: vid(i), name, archived: false })), ...Array.from({ length: extraVendors }, (_, i) => ({ id: vid(100 + i), name: `Weinhandlung ${String(i).padStart(2, "0")}`, archived: false }))];
  vendors.push({ id: vid(999), name: "Alt & Archiviert", archived: true });
  const items = USE.flatMap(([, n, last], i) => Array.from({ length: n }, (_, k) => ({ id: `it-${i}-${k}`, vendor_id: vid(i), purchased_at: k === 0 && last ? last : "2025-01-01", created_at: "2025-01-01T00:00:00Z" })));
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: items, vendors, wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_taste_profiles: [],
    cellar_overview: [], latest_wine_ratings: [], telegram_chat_messages: [],
    ingest_jobs: [
      { id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) },
      { id: JOB, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], created_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ],
  };
  net.telegram.length = 0;
}
const entry = () => ({
  name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: null, region: null, appellation: null, type: null,
  grape_shares: [], alcohol_content: null, bottle_size_ml: 750,
  purchase: { quantity: 6, storage_room: "Weinkeller", price: 30, regular_price: 35, vendor: "", gift: false, gift_from: "" },
});
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const lastText = () => String(sent().at(-1)?.body.text ?? "");
const buttons = () => ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const names = () => buttons().map((b) => b.text).filter((t) => !/Alle Händler|Neuer Händler|Überspringen|Abbrechen|Weiter/.test(t));
const press = (label: string) => {
  const b = buttons().find((x) => x.text === label);
  assert.ok(b?.callback_data, `Knopf „${label}“ fehlt: ${buttons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 2, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
};
const say = (text: string) => handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
async function toVendorStep() {
  parseResult = entry();
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, 30 Franken");
  assert.equal(state().step, "vendor");
}

test("Reihenfolge: Anzahl Chargen, bei Gleichstand zuletzt benutzt, dann alphabetisch", () => {
  const v = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }];
  const uses = [
    { vendor_id: "b", purchased_at: "2025-01-01", created_at: "x" }, { vendor_id: "c", purchased_at: "2026-01-01", created_at: "x" },
    { vendor_id: "d", purchased_at: null, created_at: "2024-01-01" }, { vendor_id: "d", purchased_at: null, created_at: "2024-01-02" },
  ];
  assert.deepEqual(rankVendors(v, uses, 8).map((x) => x.name), ["D", "C", "B", "A"]);
  assert.deepEqual(rankVendors(v, uses, 2).map((x) => x.name), ["D", "C"]);
});

test("20 Händler → die 8 häufigsten + «📋 Alle Händler»; unbenutzte fehlen", async () => {
  reset();
  await toVendorStep();
  assert.deepEqual(names(), ["Napa Wine", "Mövenpick", "Drinks.ch", "Villa Contea", "Otto's", "Turicum", "Urs Hecht", "Flaschenpost"]);
  assert.ok(buttons().some((b) => b.text === "📋 Alle Händler"));
  assert.ok(!names().includes("Casa Lusitania"));
  await press("Napa Wine");
  assert.deepEqual([state().vendor_name, state().vendor_id], ["Napa Wine", vid(1)]);
});

test("«📋 Alle Händler» zeigt alle aktiven alphabetisch; Auswahl gilt", async () => {
  reset();
  await toVendorStep();
  await press("📋 Alle Händler");
  assert.equal(names().length, 20, "alle aktiven, ohne archivierte");
  assert.deepEqual(names(), [...names()].sort((a, b) => a.localeCompare(b, "de")));
  assert.ok(names().includes("Casa Lusitania") && !names().includes("Alt & Archiviert"));
  assert.ok(!buttons().some((b) => b.text === "Weiter ▶️"), "bis 24: eine Seite");
  await press("Casa Lusitania");
  assert.equal(state().vendor_name, "Casa Lusitania");
});

test("Mehr als 24 Händler: Seiten mit «Weiter»", async () => {
  reset(10);
  await toVendorStep();
  await press("📋 Alle Händler");
  assert.equal(names().length, VENDORS_PER_PAGE);
  assert.match(lastText(), /Seite 1 von 2/);
  await press("Weiter ▶️");
  assert.equal(names().length, 30 - VENDORS_PER_PAGE);
  assert.match(lastText(), /Seite 2 von 2/);
  const last = names().at(-1)!;
  await press(last);
  assert.equal(state().vendor_name, last);
});

test("Schreibweisen: Gross/Klein, Akzente, Apostroph, Domain-Endung", () => {
  assert.equal(vendorKey("Otto's"), vendorKey("Otto‘s"));
  assert.equal(vendorKey("Otto's"), vendorKey("OTTOS"));
  assert.equal(vendorKey("Drinks.ch"), vendorKey("Drinks"));
  assert.equal(vendorKey("Mövenpick"), vendorKey("Movenpick"));
  const list = [{ id: "1", name: "Otto's" }, { id: "2", name: "Drinks.ch" }];
  assert.equal(similarVendor(list, "Otto‘s")?.name, "Otto's");
  assert.equal(similarVendor(list, "drinks")?.name, "Drinks.ch");
  assert.equal(similarVendor(list, "Otto's"), null, "gleicher Name: keine Rückfrage");
  assert.equal(similarVendor(list, "Ottobock"), null);
});

test("Ähnliche Schreibweise getippt → «Meinst du …?» statt neuem Händler; Ja nimmt den bestehenden", async () => {
  reset();
  await toVendorStep();
  const before = net.tables.vendors.length;
  await say("Otto‘s");
  assert.match(lastText(), /Meinst du <b>Otto&#39;s<\/b>|Meinst du <b>Otto's<\/b>/);
  assert.equal(net.tables.vendors.length, before, "nichts angelegt");
  await press("✅ Ja, Otto's");
  assert.deepEqual([state().vendor_name, state().vendor_id], ["Otto's", vid(2)]);
  assert.equal(net.tables.vendors.length, before);
});

test("«Meinst du …?» – Nein legt den getippten Namen neu an; exakter Name ohne Rückfrage; neuer Name direkt", async () => {
  reset();
  await toVendorStep();
  await say("drinks");
  await press("➕ Nein, «drinks» neu anlegen");
  assert.equal(state().vendor_name, "drinks");
  assert.ok(net.tables.vendors.some((v) => v.name === "drinks"));

  reset();
  await toVendorStep();
  await say("napa wine");
  assert.deepEqual([state().vendor_name, state().vendor_id], ["Napa Wine", vid(1)], "gleicher Name (Gross/Klein): ohne Rückfrage");

  reset();
  await toVendorStep();
  await say("Weinhaus Neu");
  assert.equal(state().vendor_name, "Weinhaus Neu");
  assert.ok(net.tables.vendors.some((v) => v.name === "Weinhaus Neu"));
});
