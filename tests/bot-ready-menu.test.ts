// Bot-Menü „⏰ Trinkreif“ mit Auswahl (Stufe → Weintyp → Liste) und Blättern in Offen, Bestand und
// Trinkreif: „◀︎ Vorherige“, „Weitere ▶︎“, „↩︎ Andere Auswahl“, „Seite 2 von 3“; „‹ Zurück“ im
// Wein-Menü führt auf dieselbe Seite. Zeitgrenze 10 Min. Supabase und Telegram per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { T } from "@/lib/bot/texts";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION, PAGE_SIZE, encodeMenu, type MenuAction } from "@/lib/chat/menu-view";
import { currentYear } from "@/lib/cellar/overview";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const y = currentYear();
type Row = Record<string, unknown>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// 25 rote trinkreife, 3 weisse trinkreife, 2 rote „noch lagern“, 1 roter ohne Fenster; nichts „über dem Höhepunkt“/„jetzt trinken“.
const summary: Row[] = [];
const rows: Row[] = [];
function add(n: number, name: string, type: string, from: number | null, until: number | null) {
  summary.push({ wine_id: id(n), name, producer: "P", country: null, region: null, type, grapes: [] });
  rows.push({ wine_id: id(n), vintage_year: 2018, drink_from_year: from, drink_until_year: until, sealed_bottles: 1, locations: [{ storage_room: "Weinkeller", sealed: 1, open: 0 }] });
}
for (let i = 1; i <= 25; i++) add(i, `Rot ${String(i).padStart(2, "0")}`, "red", y - 2, y + 6);
for (let i = 26; i <= 28; i++) add(i, `Weiss ${i}`, "white", y - 1, y + 4);
add(29, "Lager A", "red", y + 2, y + 9);
add(30, "Lager B", "red", y + 3, y + 10);
add(31, "Ohne Fenster", "red", null, null);

const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => { throw new Error("kein Claude erwartet"); } };
installNet(net);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset() {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    cellar_wine_summary: summary, cellar_wines: rows,
    wines: summary.map((w) => ({ id: w.wine_id, name: w.name, producer: w.producer, type: w.type })),
    cellar_overview: [], latest_wine_ratings: [], wine_vintages: [], inventory_items: [], wine_encounters: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }],
  };
  net.telegram.length = 0;
}
const screens = () => net.telegram.filter((t) => t.method === "sendMessage" || t.method === "editMessageText");
const text = () => String(screens().at(-1)?.body.text ?? "");
const buttons = () => ((screens().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const labels = () => buttons().map((b) => b.text);
const now = () => Math.floor(Date.now() / 1000);
const click = (data: string, date = now()) =>
  handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date } } } as never);
const press = (label: string | RegExp) => {
  const b = buttons().find((x) => (typeof label === "string" ? x.text === label : label.test(x.text)));
  assert.ok(b?.callback_data, `Knopf „${label}“ fehlt: ${labels().join(" | ")}`);
  return click(b.callback_data);
};
const show = (a: MenuAction) => click(encodeMenu(a));
const say = (t: string) => handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text: t } } as never);

test("⏰ Trinkreif: zuerst nur die Stufen mit Anzahl Flaschen, leere fehlen", async () => {
  reset();
  await say("⏰ Trinkreif");
  assert.match(text(), /^⏰ <b>Trinkreife<\/b> · 31 Fl\.\nWelche Flaschen möchtest du sehen\?$/);
  assert.deepEqual(labels(), ["✅ Trinkreif (28 Fl.)", "⏳ Noch lagern (2 Fl.)", "❔ Unbekannt (1 Fl.)"]);
  assert.ok(!labels().some((l) => /Über dem Höhepunkt|Jetzt trinken/.test(l)));
});

test("Stufe mit nur einem Typ: Typ-Schritt wird übersprungen; mehrere Typen: Auswahl mit „Alle“", async () => {
  reset();
  await say("⏰ Trinkreif");
  await press("⏳ Noch lagern (2 Fl.)");
  assert.match(text(), /^<b>⏳ Noch lagern<\/b> · 🍷 Rot · 2 Fl\./, "direkt die Liste");
  assert.match(text(), /⏳ 🍷 Lager A 2018 · \d{4}–\d{4} · 1 Fl\./);
  assert.deepEqual(labels().slice(-1), ["↩︎ Andere Auswahl"]);
  await press("↩︎ Andere Auswahl");
  assert.deepEqual(labels(), ["✅ Trinkreif (28 Fl.)", "⏳ Noch lagern (2 Fl.)", "❔ Unbekannt (1 Fl.)"], "zurück zu den Stufen");

  await press("✅ Trinkreif (28 Fl.)");
  assert.match(text(), /Welchen Typ möchtest du sehen\?/);
  assert.deepEqual(labels(), ["🍷 Rot (25)", "🥂 Weiss (3)", "Alle (28)", "↩︎ Andere Auswahl"]);
  await press("🥂 Weiss (3)");
  assert.match(text(), /^<b>✅ Trinkreif<\/b> · 🥂 Weiss · 3 Fl\.\n/);
  assert.doesNotMatch(text(), /Seite/, "nur eine Seite – keine Seitenzahl");
  assert.deepEqual(labels().slice(-1), ["↩︎ Andere Auswahl"], "kein Vor/Zurück");
  await press("↩︎ Andere Auswahl");
  assert.match(text(), /Welchen Typ möchtest du sehen\?/, "zurück zur Typ-Auswahl der Stufe");
});

test("Trinkreif blättern: Weitere, Vorherige (Seite 2 → Seite 1, nicht zur Auswahl), Andere Auswahl, Zurück aus dem Wein-Menü", async () => {
  reset();
  assert.equal(PAGE_SIZE, 10);
  await show({ op: "list", list: { kind: "readyStatus", status: "ready" }, offset: 0 });
  await press("🍷 Rot (25)");
  assert.match(text(), /· Seite 1 von 3\n/);
  assert.equal(labels().filter((l) => l.startsWith("✅ 🍷")).length, 10);
  assert.ok(!labels().includes("◀︎ Vorherige") && labels().includes("Weitere ▶︎") && labels().includes("↩︎ Andere Auswahl"));
  await press("Weitere ▶︎");
  assert.match(text(), /Seite 2 von 3/);
  assert.match(text(), /Rot 11 2018/);
  assert.ok(labels().includes("◀︎ Vorherige") && labels().includes("Weitere ▶︎"));
  // Wein-Menü von Seite 2 → „‹ Zurück“ landet wieder auf Seite 2
  await press(/Rot 12/);
  assert.match(text(), /Rot 12 2018/);
  await press("‹ Zurück");
  assert.match(text(), /Seite 2 von 3/);
  await press("◀︎ Vorherige");
  assert.match(text(), /Seite 1 von 3/, "eine Seite zurück, nicht zur Auswahl");
  await press("Weitere ▶︎");
  await press("Weitere ▶︎");
  assert.match(text(), /Seite 3 von 3/);
  assert.ok(!labels().includes("Weitere ▶︎"), "auf der letzten Seite kein „Weitere“");
  await press("↩︎ Andere Auswahl");
  assert.match(text(), /Welchen Typ möchtest du sehen\?/);
});

test("Bestand: gleiches Blättern (Vorherige statt zurück zur Typ-Auswahl)", async () => {
  reset();
  await say("📦 Bestand");
  await press("🍷 Rot (28)");
  assert.match(text(), /Seite 1 von 3/);
  assert.ok(!labels().includes("‹ Zurück") && !labels().includes("Mehr…"));
  await press("Weitere ▶︎");
  assert.match(text(), /Seite 2 von 3/);
  await press("◀︎ Vorherige");
  assert.match(text(), /Seite 1 von 3/, "Seite 2 → Seite 1");
  await press("Weitere ▶︎");
  await press(/Rot 15/);
  await press("‹ Zurück");
  assert.match(text(), /Seite 2 von 3/, "aus dem Wein-Menü zurück auf Seite 2");
  await press("↩︎ Andere Auswahl");
  assert.match(text(), /📦 Bestand/);
  assert.deepEqual(labels(), ["🍷 Rot (28)", "🥂 Weiss (3)"]);
});

test("Zeitgrenze 10 Minuten auch beim Blättern", async () => {
  reset();
  await show({ op: "list", list: { kind: "readyList", status: "ready", code: "r" }, offset: 0 });
  const next = buttons().find((b) => b.text === "Weitere ▶︎")!.callback_data!;
  net.telegram.length = 0;
  await click(next, now() - 11 * 60);
  assert.equal(text(), T.menuExpired);
  await click(next, now() - 9 * 60);
  assert.match(text(), /Seite 2 von 3/);
});

test("🍷 Offen: gleiches Blättern (Vorherige/Weitere, Seite x von y, ohne „Mehr…“), Zurück aus dem Wein-Menü auf dieselbe Seite", async () => {
  reset();
  // 23 offene Flaschen → 3 Seiten à 10
  net.tables.cellar_overview = Array.from({ length: 23 }, (_, i) => ({
    inventory_item_id: id(100 + i), wine_id: id(i + 1), producer: "P", name: `Offen ${String(i + 1).padStart(2, "0")}`, vintage_year: 2020,
    type: "red", status: "open", fill_level_percent: 50, date_opened: `2026-10-${String(i + 1).padStart(2, "0")}`, storage_room: "Weinkeller", bottle_size_ml: 750,
  }));
  await say("🍷 Offen");
  assert.match(text(), /^<b>🍷 Offene Flaschen \(23\)<\/b> · Seite 1 von 3\n/);
  assert.equal(labels().filter((l) => l.startsWith("🍷 Offen")).length, 10);
  assert.ok(!labels().includes("Mehr…") && !labels().includes("◀︎ Vorherige") && labels().includes("Weitere ▶︎"));
  assert.ok(!labels().includes("↩︎ Andere Auswahl"), "Offen hat keine Auswahl");
  await press("Weitere ▶︎");
  assert.match(text(), /Seite 2 von 3/);
  assert.match(text(), /Offen 11 2020/);
  assert.ok(labels().includes("◀︎ Vorherige") && labels().includes("Weitere ▶︎"));
  // Flaschen-Menü von Seite 2 → „‹ Zurück“ landet wieder auf Seite 2
  await press(/Offen 13/);
  assert.match(text(), /Offen 13 2020/);
  await press("‹ Zurück");
  assert.match(text(), /Seite 2 von 3/);
  await press("◀︎ Vorherige");
  assert.match(text(), /Seite 1 von 3/);
  await press("Weitere ▶︎");
  await press("Weitere ▶︎");
  assert.match(text(), /Seite 3 von 3/);
  assert.equal(labels().filter((l) => l.startsWith("🍷 Offen")).length, 3);
  assert.ok(!labels().includes("Weitere ▶︎"), "letzte Seite");
  // Liste kürzer geworden (z. B. ausgetrunken): eine Seite hinter dem Ende zeigt die letzte Seite
  net.tables.cellar_overview = net.tables.cellar_overview.slice(0, 12);
  await press("◀︎ Vorherige");
  assert.match(text(), /Seite 2 von 2/);
  // Nur eine Seite: keine Seitenzahl, keine Knöpfe zum Blättern
  net.tables.cellar_overview = net.tables.cellar_overview.slice(0, 4);
  await say("🍷 Offen");
  assert.doesNotMatch(text(), /Seite/);
  assert.ok(!labels().some((l) => /Vorherige|Weitere|Mehr/.test(l)));
});
