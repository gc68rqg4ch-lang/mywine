// Preis beim Einbuchen suchen („🔎 Such du“): Knöpfe bei „bezahlt?“, Normalpreis und Geschenk-Wert;
// der Ablauf läuft ohne Preis weiter („Preis: wird gesucht …“). Die Suche (Auftrag „price“) speichert
// einen Treffer mit gleichem Jahrgang und gleicher Grösse direkt (nur leere Felder), fragt bei
// anderem Jahrgang bzw. anderer Grösse nach und ohne Fund nach dem Preis. Nur CHF und Schweizer
// Händler; Aktions- vs. Normalpreis; von Hand eingegebene Preise bleiben. Stubs für alles.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { processTextJob, saveJob } from "@/lib/ingest/flow";
import { callbackData, giftValueKeyboard, parseCallbackData, priceKeyboard, regularPriceKeyboard } from "@/lib/ingest/messages";
import type { IngestState } from "@/lib/ingest/schema";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/research/jobs";
import { evaluatePrice, priceNoteHint, swissMerchantUrl, updateItemPrices, type PriceRaw } from "@/lib/research/price";
import { htmlPriceLines } from "@/lib/research/shops/adapters";
import { runLater } from "@/lib/later";

const JOB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const ID = "bbbbbbbb-0000-4000-8000-00000000000b";
let parseResult: Record<string, unknown> = {};
let priceAnswer: Record<string, unknown> = {};
let priceCalls = 0;

const offer = (o: Partial<PriceRaw> = {}): PriceRaw => ({
  found: true, same_wine: true, merchant: "Mövenpick", url: "https://www.moevenpick-wein.com/de/2019-pintia.html", currency: "CHF",
  price: 66, regular_price: 0, vintage: 2019, size_ml: 750, quote: "Pintia 2019, 75 cl, CHF 66.00", ...o,
});
const NOTHING = { found: false, same_wine: false, merchant: "", url: "", currency: "", price: 0, regular_price: 0, vintage: 0, size_ml: 0, quote: "" };

const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if ((body.output_config as { format?: unknown } | undefined)?.format) return claudeText(parseResult);
    if (tools.includes("report_price")) {
      priceCalls++;
      return claudeTool("report_price", priceAnswer);
    }
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5, vintages: [], sources: [] });
    }
    if (tools.includes("report_grape_shares")) return claudeTool("report_grape_shares", { grapes: [], percentages_for_vintage: false, sources: [] });
    if (tools.includes("report_taste_profile")) {
      return claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    }
    if (tools.includes("report_drink_window")) {
      return claudeTool("report_drink_window", { matches_wine: false, same_vintage: false, drink_from: 0, drink_until: 0, sources: [], quote: "", estimate_from: 0, estimate_until: 0, estimate_reason: "" });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset() {
  priceCalls = 0;
  priceAnswer = offer();
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [{ id: "v1", name: "Mövenpick", archived: false }], wine_vintages: [], wine_grape_shares: [], wine_media: [],
    wine_taste_profiles: [], cellar_overview: [], latest_wine_ratings: [], telegram_chat_messages: [], research_suggestions: [], research_jobs: [],
    ingest_jobs: [
      { id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) },
      { id: JOB, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], created_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ],
  };
  net.telegram.length = 0;
}
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const texts = () => sent().map((t) => String(t.body.text).replace(/ /g, " "));
const lastText = () => texts().at(-1) ?? "";
const buttons = () => ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (label: string) => {
  const b = buttons().find((x) => x.text === label);
  assert.ok(b?.callback_data, `Knopf „${label}“ fehlt: ${buttons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 2, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
};
const say = (text: string) => handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
const items = () => net.tables.inventory_items;
const item = () => items()[0];

/** Text-Erfassung bis zur Preisfrage (Händler Mövenpick schon genannt). */
async function start() {
  reset();
  parseResult = {
    name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: null, region: null, appellation: null, type: null,
    grape_shares: [], alcohol_content: null, bottle_size_ml: null,
    purchase: { quantity: 6, storage_room: "Weinkeller", price: 0, regular_price: 0, vendor: "Mövenpick", gift: false, gift_from: "" },
  };
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, bei Mövenpick");
  assert.equal(state().step, "price");
}
/** Zusammenfassung → speichern; gibt die Bestätigung zurück. */
async function save() {
  assert.equal(state().step, "confirm", JSON.stringify(state()));
  job().extracted = { ...state(), step: "saving" };
  await saveJob(job() as never, 111);
  return texts().find((t) => /eingebucht/.test(t)) ?? "";
}
/** Den eingeplanten Auftrag „price“ ausführen (wie der Worker). */
async function runPriceJob() {
  const row = net.tables.research_jobs.find((j) => j.kind === "price");
  assert.ok(row, "Auftrag „price“ angelegt");
  return runJob(db, row as never);
}

test("Knöpfe „🔎 Such du“ bei bezahlt, Normalpreis und Geschenk-Wert (callback ≤ 64 Bytes)", () => {
  const all = [priceKeyboard(ID), regularPriceKeyboard(ID, 20), regularPriceKeyboard(ID, null), giftValueKeyboard(ID)].map((k) => k.inline_keyboard.flat());
  const search = all.map((bs) => bs.find((b) => b.text === "🔎 Such du"));
  assert.deepEqual(search.map((b) => parseCallbackData((b as { callback_data: string }).callback_data)?.action), ["searchprice", "searchreg", "searchreg", "searchreg"]);
  for (const b of search) assert.ok(Buffer.byteLength((b as { callback_data: string }).callback_data) <= 64);
  // Rückfragen nach der Suche: ohne „Such du“
  assert.ok(!priceKeyboard(ID, false).inline_keyboard.flat().some((b) => b.text === "🔎 Such du"));
  assert.equal(parseCallbackData(callbackData("offeryes", ID))?.action, "offeryes");
});

test("„🔎 Such du“ bei „bezahlt?“: kein Normalpreis, weiter zum Speichern, „Preis: wird gesucht“; Treffer → beide Preise gespeichert", async () => {
  await start();
  await press("🔎 Such du");
  assert.deepEqual([state().price, state().regular_price, state().price_search], [null, null, "both"]);
  assert.match(lastText(), /Zusammenfassung[\s\S]*Preis: wird gesucht … · bei Mövenpick/);
  const booked = await save();
  assert.match(booked, /Preis: wird gesucht …/);
  assert.deepEqual([item().purchase_price, item().regular_price], [null, null]);
  assert.deepEqual(net.tables.research_jobs[0].params, { item_id: item().id, mode: "both", chat_id: 111 });

  await runPriceJob();
  assert.equal(priceCalls, 1);
  assert.deepEqual([item().purchase_price, item().regular_price, item().price_source], [66, 66, "research"]);
  assert.match(String(item().price_note), /^Mövenpick · 2019 · 75 cl · \d\d\.\d\d\.\d{4} · https:\/\/www\.moevenpick-wein\.com\//);
  assert.equal(lastText(), "💰 Preis gefunden: CHF 66.00 pro Flasche (Mövenpick, 2019, 75 cl) – gespeichert.");
  assert.deepEqual(buttons().map((b) => b.text), ["✏️ Ändern"]);
  assert.match(String(priceNoteHint(String(item().price_note))), /^Preis recherchiert: Mövenpick, \d\d\.\d\d\.\d{4}$/);

  // „✏️ Ändern“ → normale Preisfragen (ohne „Such du“), danach von Hand
  await press("✏️ Ändern");
  assert.match(lastText(), /[Ww]as hast du pro Flasche bezahlt\?/);
  assert.deepEqual(buttons().map((b) => b.text), ["🎁 Geschenk", "🤷 Weiss ich nicht", "✖️ Abbrechen"]);
  await say("70");
  await press("✅ Ja, gleich");
  await runLater();
  assert.equal(items().length, 1, "nichts neu eingebucht");
  assert.deepEqual([item().purchase_price, item().regular_price, item().price_source, item().price_note], [70, 70, "manual", null]);
  assert.match(lastText(), /✅ Gespeichert: CHF 70\.00\./);
});

test("„🔎 Such du“ beim Normalpreis: bezahlt bleibt, nur der Normalpreis wird gesucht (Aktion → Normalpreis)", async () => {
  await start();
  await say("38");
  await press("🔎 Such du");
  assert.deepEqual([state().price, state().regular_price, state().price_search], [38, null, "regular"]);
  assert.match(await save(), /Bezahlt CHF 38\.00 · Normalpreis: wird gesucht …/);
  priceAnswer = offer({ price: 39, regular_price: 45, quote: "CHF 39.00 statt 45.00" });
  await runPriceJob();
  assert.deepEqual([item().purchase_price, item().regular_price], [38, 45], "Normalpreis gilt, bezahlt bleibt");
  assert.equal(lastText(), "💰 Normalpreis gefunden: CHF 45.00 pro Flasche (Mövenpick, 2019, 75 cl) – gespeichert.");
});

test("Geschenk: „🔎 Such du“ beim Wert sucht nur den Normalpreis, bezahlt bleibt 0", async () => {
  await start();
  await press("🎁 Geschenk");
  await press("Überspringen");
  assert.equal(state().step, "regular_price");
  await press("🔎 Such du");
  assert.match(lastText(), /🎁 Geschenk · Normalpreis: wird gesucht …/);
  await save();
  await runPriceJob();
  assert.deepEqual([item().purchase_price, item().regular_price, item().is_gift], [0, 66, true]);
});

test("Nur anderer Jahrgang: nichts gespeichert, Rückfrage; Übernehmen / Selbst eingeben / Leer lassen", async () => {
  for (const choice of ["✅ Übernehmen", "✏️ Selbst eingeben", "Leer lassen"]) {
    await start();
    await press("🔎 Such du");
    await save();
    priceAnswer = offer({ vintage: 2020, price: 64, url: "https://www.moevenpick-wein.com/de/2020-pintia.html" });
    await runPriceJob();
    assert.deepEqual([item().purchase_price, item().regular_price], [null, null], "nichts gespeichert");
    assert.equal(lastText(), "Nur Jahrgang 2020 gefunden: CHF 64.00 (Mövenpick). Übernehmen?");
    assert.deepEqual(buttons().map((b) => b.text), ["✅ Übernehmen", "✏️ Selbst eingeben", "Leer lassen"]);
    await press(choice);
    if (choice === "✅ Übernehmen") {
      assert.deepEqual([item().purchase_price, item().regular_price, item().price_source], [64, 64, "research"]);
      assert.match(String(item().price_note), /^Mövenpick · 2020 · 75 cl/);
    } else if (choice === "Leer lassen") {
      assert.deepEqual([item().purchase_price, item().regular_price], [null, null]);
      assert.equal(lastText(), "Gut, der Preis bleibt leer.");
    } else {
      assert.match(lastText(), /[Ww]as hast du pro Flasche bezahlt\?/);
      await say("50");
      await press("🤷 Weiss ich nicht");
      await runLater();
      assert.deepEqual([item().purchase_price, item().regular_price, item().price_source], [50, null, "manual"]);
    }
    assert.equal(items().length, 1);
  }
  // Andere Grösse
  await start();
  await press("🔎 Such du");
  await save();
  priceAnswer = offer({ size_ml: 1500, price: 140 });
  await runPriceJob();
  assert.equal(lastText(), "Nur 150 cl gefunden: CHF 140.00 (Mövenpick). Übernehmen?");
});

test("Nichts gefunden: Antoine fragt nach dem Preis; ein Betrag läuft wie die normale Preisangabe", async () => {
  await start();
  await press("🔎 Such du");
  await save();
  priceAnswer = NOTHING;
  await runPriceJob();
  assert.equal(lastText(), "Keinen Preis bei Schweizer Händlern gefunden. Wie viel hast du bezahlt?");
  assert.deepEqual(buttons().map((b) => b.text), ["🎁 Geschenk", "🤷 Weiss ich nicht", "✖️ Abbrechen"]);
  await say("39");
  assert.match(lastText(), /Ist das auch der Normalpreis\?/, "Normalpreis-Frage wie gewohnt");
  await say("45");
  await runLater();
  assert.deepEqual([item().purchase_price, item().regular_price, item().price_source], [39, 45, "manual"]);
  assert.equal(items().length, 1);
});

test("Von Hand eingegebene Preise werden nie überschrieben", async () => {
  reset();
  net.tables.wines = [{ id: "w1", name: "Pintia", producer: "Vega Sicilia", type: "red", country: null, region: null, appellation: null }];
  net.tables.inventory_items = [{ id: ID, wine_id: "w1", vintage_year: 2019, bottle_size_ml: 750, quantity: 1, purchase_price: 30, regular_price: 40, is_gift: false, gift_from: null, price_source: null }];
  await runJob(db, { wine_id: "w1", kind: "price", params: { item_id: ID, mode: "regular", chat_id: 111 } } as never);
  assert.deepEqual([item().purchase_price, item().regular_price, priceCalls], [30, 40, 0], "nicht einmal gesucht");
  assert.equal(await updateItemPrices(db, ID, { purchase_price: 66, regular_price: 66 }, "research", "x", true), false);
  assert.deepEqual([item().purchase_price, item().regular_price], [30, 40]);
  // Nur ein Feld leer: nur dieses wird gefüllt
  item().regular_price = null;
  assert.equal(await updateItemPrices(db, ID, { purchase_price: 66, regular_price: 66 }, "research", "x", true), true);
  assert.deepEqual([item().purchase_price, item().regular_price], [30, 66]);
});

test("Nur CHF und Schweizer Händler; Aktions- vs. Normalpreis; Jahrgang und Grösse", () => {
  const want = { year: 2019, sizeMl: 750 };
  assert.equal(evaluatePrice(offer(), want).kind, "exact");
  assert.equal(evaluatePrice(offer({ currency: "EUR" }), want).kind, "none", "keine Euro");
  assert.equal(evaluatePrice(offer({ url: "https://www.vinatis.de/pintia" }), want).kind, "none", "kein ausländischer Shop");
  assert.equal(evaluatePrice(offer({ url: "http://www.weinshop.ch/pintia" }), want).kind, "none", "nur https");
  assert.equal(evaluatePrice(offer({ url: "https://www.ullrich.ch/de/pintia" }), want).kind, "exact");
  assert.equal(evaluatePrice(offer({ same_wine: false }), want).kind, "none");
  assert.equal(evaluatePrice(offer({ quote: "" }), want).kind, "none", "ohne Beleg nichts");
  assert.equal(evaluatePrice(offer({ price: 0 }), want).kind, "none");
  const promo = evaluatePrice(offer({ price: 49, regular_price: 66 }), want);
  assert.ok(promo.kind === "exact" && promo.amount === 66, "Normalpreis statt Aktionspreis");
  assert.equal(evaluatePrice(offer({ vintage: 2020 }), want).kind, "other");
  assert.equal(evaluatePrice(offer({ size_ml: 375 }), want).kind, "other");
  assert.equal(evaluatePrice(offer({ size_ml: 0 }), want).kind, "exact", "ohne Grösse: Standard 75 cl");
  assert.equal(evaluatePrice(offer({ size_ml: 0 }), { year: 2019, sizeMl: 700, type: "spirit" }).kind, "exact", "Spirituose: Standard 70 cl");
  assert.equal(evaluatePrice(offer({ vintage: 0 }), { year: null, sizeMl: 750 }).kind, "exact", "ohne Jahrgang");
  assert.equal(swissMerchantUrl("https://www.moevenpick-wein.com/de/x.html"), true);
  assert.equal(swissMerchantUrl("https://shop.example.com/x"), false);
});

test("Shop-Seiten liefern den Preis mit (Magento, schema.org)", () => {
  assert.deepEqual(htmlPriceLines('<span data-price-amount="66" data-price-type="finalPrice" class="price-wrapper">'), ["Preis: CHF 66.00"]);
  assert.deepEqual(
    htmlPriceLines('<span data-price-amount="49" data-price-type="finalPrice"></span><span data-price-amount="66" data-price-type="oldPrice"></span>'),
    ["Preis: CHF 49.00 (Aktion, statt CHF 66.00)"],
  );
  assert.deepEqual(htmlPriceLines('<meta itemprop="price" content="34.80">'), ["Preis: CHF 34.80"]);
  assert.deepEqual(htmlPriceLines("<p>kein Preis</p>"), []);
});
