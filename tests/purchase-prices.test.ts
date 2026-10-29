// Einbuchen im Bot: zwei Preise nacheinander – a) bezahlt (→ purchase_price), b) Normalpreis
// (→ regular_price, „Gleich wie bezahlt“ nur mit Betrag bei a). Preise aus Bild-/Freitext: ein
// Preis = bezahlt, „49 statt 66“ = beide, „Normalpreis 66“ = nur der. Zusammenfassung und
// Bestätigung: gleich → „CHF 34.80“, verschieden → „Bezahlt … · Normalpreis …“. Stubs für alles.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { continuePhotoPurchase, processTextJob, saveJob, textPurchasePrices } from "@/lib/ingest/flow";
import { callbackData, priceLine } from "@/lib/ingest/messages";
import { pricesInText } from "@/lib/ingest/prices";
import { normalizeProposal, type IngestState } from "@/lib/ingest/schema";
import { T } from "@/lib/bot/texts";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { createAdminClient } from "@/lib/supabase/admin";

const JOB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
let parseResult: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if ((body.output_config as { format?: unknown } | undefined)?.format) return claudeText(parseResult);
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5, vintages: [], sources: [] });
    }
    if (tools.includes("report_grape_shares")) return claudeTool("report_grape_shares", { grapes: [], percentages_for_vintage: false, sources: [] });
    if (tools.includes("report_taste_profile")) {
      return claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset(source: "text" | "telegram" = "text") {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [{ id: "v1", name: "Coop", archived: false }], wine_vintages: [], wine_grape_shares: [], wine_media: [],
    wine_taste_profiles: [], cellar_overview: [], latest_wine_ratings: [], telegram_chat_messages: [], research_suggestions: [],
    ingest_jobs: [
      { id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) },
      { id: JOB, source, telegram_chat_id: 111, status: "processing", extracted: { step: source === "text" ? "researching" : "received", source: source === "text" ? "text" : undefined }, photo_paths: [], created_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ],
  };
  net.telegram.length = 0;
}
const entry = (purchase: Record<string, unknown>) => ({
  name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: null, region: null, appellation: null, type: null,
  grape_shares: [], alcohol_content: null, bottle_size_ml: null,
  purchase: { quantity: 6, storage_room: "Weinkeller", price: 0, regular_price: 0, vendor: "Coop", gift: false, gift_from: "", ...purchase },
});
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const texts = () => net.telegram.filter((t) => t.method === "sendMessage").map((t) => String(t.body.text));
const lastText = () => texts().at(-1) ?? "";
const buttons = () => ((net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (label: string) => {
  const b = buttons().find((x) => x.text === label);
  assert.ok(b?.callback_data, `Knopf „${label}“ fehlt: ${buttons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 2, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
};
const say = (text: string) => handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
const item = () => net.tables.inventory_items[0];
async function text(message: string, purchase: Record<string, unknown> = {}) {
  reset();
  parseResult = entry(purchase);
  await processTextJob(JOB, 111, message);
}
/** Zusammenfassung → speichern; gibt die Bestätigung zurück. */
async function confirmAndSave() {
  assert.equal(state().step, "confirm", JSON.stringify(state()));
  job().extracted = { ...state(), step: "saving" };
  await saveJob(job() as never, 111);
  return texts().find((t) => /eingebucht/.test(t)) ?? "";
}
/** Alle Varianten der Frage 1. */
const VARIANTS_PRICE = [0, 0.4, 0.9].map((r) => T.pricePaid("6 Flaschen", () => r));
const summary = () => lastText().replace(/ /g, " ");

test("Preise im Text: ein Preis = bezahlt, „statt“ bzw. bezahlt/normal = beide, nur Normalpreis = der", () => {
  assert.deepEqual(pricesInText("Pintia 2019, 6 Flaschen, 66 Franken bei Mövenpick"), { paid: 66, regular: null });
  assert.deepEqual(pricesInText("CHF 24.50"), { paid: 24.5, regular: null });
  assert.deepEqual(pricesInText("Aktion 49 statt 66"), { paid: 49, regular: 66 });
  assert.deepEqual(pricesInText("bezahlt 49, normal 66"), { paid: 49, regular: 66 });
  assert.deepEqual(pricesInText("29.80 statt CHF 34.80"), { paid: 29.8, regular: 34.8 });
  assert.deepEqual(pricesInText("Normalpreis 66"), { paid: null, regular: 66 });
  assert.deepEqual(pricesInText("Pintia 2019, 6 Flaschen, Weinkeller"), { paid: null, regular: null }, "Anzahl und Jahrgang sind keine Preise");
  assert.deepEqual(pricesInText("1'250 Franken"), { paid: 1250, regular: null });
  // Erkennung legt einen einzelnen Preis als Normalpreis ab → gilt trotzdem als bezahlt
  assert.deepEqual(textPurchasePrices("6 Flaschen für 66", { price: 0, regular_price: 66 }), { paid: 66, regular: null });
  assert.deepEqual(textPurchasePrices("normal 66", { price: 0, regular_price: 66 }), { paid: null, regular: 66 });
  assert.deepEqual(textPurchasePrices("66 Franken", { price: 66, regular_price: 66 }), { paid: 66, regular: null });
});

test("Zeile in Zusammenfassung und Bestätigung", () => {
  const n = (s: string | null) => s?.replace(/ /g, " ");
  assert.equal(n(priceLine(34.8, 34.8)), "CHF 34.80");
  assert.equal(n(priceLine(29.8, 34.8)), "Bezahlt CHF 29.80 · Normalpreis CHF 34.80");
  assert.equal(n(priceLine(29.8, null)), "Bezahlt CHF 29.80");
  assert.equal(n(priceLine(null, 34.8)), "Normalpreis CHF 34.80");
  assert.equal(priceLine(null, null), null);
});

const SAME = ["✅ Ja, gleich", "🤷", "✖️ Abbrechen"];

test("Frage 1: Hinweis zum Eintippen, nur Knöpfe 🎁 und 🤷 – kein „Überspringen“, kein 🔎", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  assert.equal(state().step, "price");
  assert.match(lastText(), /^6 Flaschen\. 💰 .*[Ww]as hast du pro Flasche bezahlt\? Betrag schreiben \(z\. B\. <i>29\.90<\/i>\), «–» für leer, 🎁 Geschenk, 🤷 dann suche ich ihn\.$/);
  assert.deepEqual(buttons().map((b) => b.text), ["🎁", "🤷", "✖️ Abbrechen"]);
  for (const v of VARIANTS_PRICE) assert.match(v, /«–» für leer/);
});

test("„38“ → „✅ Ja, gleich“ → 38/38, Anzeige „CHF 38.00“", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  await say("38");
  assert.equal(state().step, "regular_price");
  assert.match(lastText(), /Ist das auch der Normalpreis\? Sonst Betrag schreiben .*«–» für leer, 🤷 dann suche ich ihn\.$/);
  assert.deepEqual(buttons().map((b) => b.text), SAME);
  await press("✅ Ja, gleich");
  assert.match(summary(), /\nCHF 38\.00 · bei Coop\n/);
  const booked = await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [38, 38]);
  assert.match(booked.replace(/\u00a0/g, " "), /\nCHF 38\.00 · bei Coop\n/);
});

test("„38“ → anderen Betrag „45“ einfach tippen (kein „✏️ Anderer Betrag“) → 38/45", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  await say("38");
  assert.ok(!buttons().some((b) => b.text === "✏️ Anderer Betrag"));
  await say("0");
  assert.match(lastText(), /Den Betrag verstehe ich nicht ganz/);
  assert.deepEqual(buttons().map((b) => b.text), SAME, "Knöpfe bleiben");
  await say("45");
  assert.match(summary(), /Bezahlt CHF 38\.00 · Normalpreis CHF 45\.00 · bei Coop/);
  const booked = await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [38, 45]);
  assert.match(booked.replace(/\u00a0/g, " "), /Bezahlt CHF 38\.00 · Normalpreis CHF 45\.00/);
});

test("„38“ → „–“ → 38/NULL (Normalpreis bewusst leer)", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  await say("38");
  await say("–");
  assert.match(summary(), /\nBezahlt CHF 38\.00 · bei Coop\n/);
  await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [38, null]);
});

test("„–“, „-“, „—“, „leer“, „nichts“ bei Frage 1 → beide Preise leer, keine Normalpreis-Frage, keine Suche", async () => {
  for (const empty of ["–", "-", "—", "leer", "Nichts"]) {
    await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
    await say(empty);
    assert.deepEqual([state().step, state().price, state().regular_price, state().price_search], ["confirm", null, null, undefined], empty);
    assert.ok(!/normalerweise/.test(texts().at(-1) ?? ""), empty);
    const booked = await confirmAndSave();
    assert.deepEqual([item().purchase_price, item().regular_price], [null, null], empty);
    assert.doesNotMatch(booked, /Bezahlt|wird gesucht/);
  }
});

test("Alter Knopf (skipprice) aus früheren Nachrichten: Frage 3 → „45“ → NULL/45", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  await handleUpdate({ update_id: 3, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: callbackData("skipprice", JOB), message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } } } as never);
  assert.deepEqual([state().step, state().price], ["regular_price", null]);
  assert.match(lastText(), /[Ww]eisst du, was eine Flasche normalerweise kostet\? Betrag schreiben/);
  assert.deepEqual(buttons().map((b) => b.text), ["🤷", "✖️ Abbrechen"]);
  await say("keine Ahnung");
  assert.deepEqual(buttons().map((b) => b.text), ["🤷", "✖️ Abbrechen"], "Knöpfe bleiben");
  await say("45");
  assert.match(summary(), /\nNormalpreis CHF 45\.00 · bei Coop\n/);
  const booked = await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [null, 45]);
  assert.doesNotMatch(booked, /Bezahlt/);
});

test("Freitext „66 Franken“ → bezahlt 66, nur noch Frage 2 (auch wenn die Erkennung ihn als Normalpreis liest)", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Coop", { regular_price: 66 });
  assert.deepEqual([state().step, state().price, state().regular_price], ["regular_price", 66, undefined]);
  assert.ok(!texts().some((t) => /pro Flasche bezahlt/.test(t)), "Frage 1 entfällt");
  assert.match(lastText(), /Ist das auch der Normalpreis\? Sonst Betrag schreiben .*«–» für leer, 🤷 dann suche ich ihn\.$/);
  await press("✅ Ja, gleich");
  await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [66, 66]);
});

test("Freitext „Aktion 49 statt 66“ → 49/66, keine Preisfrage", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, Aktion 49 statt 66 bei Coop");
  assert.equal(state().step, "confirm");
  assert.ok(!texts().some((t) => /pro Flasche bezahlt|normalerweise/.test(t)));
  assert.match(summary(), /Bezahlt CHF 49\.00 · Normalpreis CHF 66\.00 · bei Coop/);
  await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [49, 66]);
});

test("Freitext nur „Normalpreis 66“ → nur noch Frage a", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, Normalpreis 66, bei Coop", { regular_price: 66 });
  assert.deepEqual([state().step, state().price, state().regular_price], ["price", undefined, 66]);
  await say("55");
  assert.equal(state().step, "confirm", "Normalpreis ist schon bekannt");
  await confirmAndSave();
  assert.deepEqual([item().purchase_price, item().regular_price], [55, 66]);
});

test("Foto mit Bildtext „66 Franken“ → bezahlt 66", async () => {
  reset("telegram");
  const proposal = normalizeProposal({ name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: "Toro", appellation: null, type: "red", grape_shares: [], alcohol_content: 14.5, bottle_size_ml: 750 });
  await continuePhotoPurchase(db, JOB, 111, { proposal, model: "x", confidence: 0.95, notes: null, imageSides: null, vintageCertain: true }, "66 Franken");
  assert.deepEqual([state().price, state().regular_price], [66, undefined]);
});

test("Geschenk-Ablauf unverändert: 🎁 → Von wem? → Normalpreis; purchase_price 0", async () => {
  await text("Pintia 2019, 6 Flaschen, Weinkeller, bei Coop");
  await press("🎁");
  assert.equal(state().step, "gift_from");
  await say("Marc");
  assert.equal(state().step, "regular_price");
  assert.deepEqual(buttons().map((b) => b.text), ["🤷", "✖️ Abbrechen"]);
  await say("38");
  assert.match(summary(), /🎁 Geschenk von Marc · Normalpreis CHF 38\.00/);
  await confirmAndSave();
  assert.deepEqual([item().is_gift, item().purchase_price, item().regular_price, item().gift_from, item().vendor_id], [true, 0, 38, "Marc", null]);
});
