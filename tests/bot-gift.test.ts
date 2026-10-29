// Einbuchen im Bot: „🎁 Geschenk“ bei der Preisfrage → Preis 0, „Von wem?“ (Freitext oder
// „Überspringen“); Geschenk aus Freitext/Bildtext direkt übernehmen; Bestätigung mit
// „🎁 Geschenk von <Name>“. Verkostet bleibt unverändert. Claude, Telegram und Supabase per Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { continuePhotoPurchase, nextPurchaseStep, processTextJob, saveJob } from "@/lib/ingest/flow";
import { cleanGiftFrom, giftInText, giftValueInText } from "@/lib/ingest/gift";
import { parseAmount } from "@/lib/format";
import { expireStale, MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { VARIANTS } from "@/lib/bot/texts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IngestState } from "@/lib/ingest/schema";

const JOB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
let parseResult: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: {},
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
function reset() {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_taste_profiles: [],
    cellar_overview: [], latest_wine_ratings: [], telegram_chat_messages: [],
    ingest_jobs: [
      { id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) },
      { id: JOB, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], created_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ],
  };
  net.telegram.length = 0;
}
const entry = (purchase: Record<string, unknown>) => ({
  name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: null, region: null, appellation: null, type: null,
  grape_shares: [], alcohol_content: null, bottle_size_ml: null,
  purchase: { quantity: 6, storage_room: "Weinkeller", price: 0, regular_price: 0, vendor: "", gift: false, gift_from: "", ...purchase },
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
/** [Ja] in der Zusammenfassung → Speichern (im Test direkt, statt nach der Antwort). */
async function confirmAndSave() {
  assert.equal(state().step, "confirm");
  job().extracted = { ...state(), step: "saving" };
  await saveJob(job() as never, 111);
}
const item = () => net.tables.inventory_items[0];

test("Bildtext/Freitext: Geschenk und Name erkennen", () => {
  assert.deepEqual(giftInText("Geschenk von Marc"), { from: "Marc" });
  assert.deepEqual(giftInText("Pintia 2019, 2 Flaschen – Geschenk von Anna Muster, Weinkeller"), { from: "Anna Muster" });
  assert.deepEqual(giftInText("von Sara geschenkt bekommen"), { from: "Sara" });
  assert.deepEqual(giftInText("Mitbringsel von Peter"), { from: "Peter" });
  assert.deepEqual(giftInText("ein Geschenk"), { from: null });
  assert.equal(giftInText("Pintia 2019, 6 Flaschen, 66 Franken"), null);
  assert.equal(cleanGiftFrom("   Marc    Muster  "), "Marc Muster");
  assert.equal(cleanGiftFrom("   "), null);
  assert.equal(VARIANTS.giftFrom.length, 3);
  assert.ok(VARIANTS.giftFrom.every((t) => /Von wem/.test(t) && !/ß/.test(t)));
});

test("„🎁 Geschenk“ → Name → Betrag 38: regular_price 38, purchase_price 0; Bestätigung mit Name und Normalpreis", async () => {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  assert.equal(state().step, "price");
  assert.deepEqual(buttons().map((b) => b.text), ["🎁", "🤷", "✖️ Abbrechen"]);
  await press("🎁");
  assert.deepEqual([state().step, state().is_gift, state().price, state().regular_price], ["gift_from", true, 0, undefined]);
  assert.match(lastText(), /Von wem/);
  assert.deepEqual(buttons().map((b) => b.text), ["Überspringen", "✖️ Abbrechen"]);
  await say("   Marc    Muster  ");
  assert.deepEqual([state().gift_from, state().step], ["Marc Muster", "regular_price"]);
  assert.ok(VARIANTS.giftValue.some((v) => lastText().startsWith(v)), lastText());
  assert.deepEqual(buttons().map((b) => b.text), ["🤷", "✖️ Abbrechen"]);
  await say("38");
  assert.equal(state().regular_price, 38);
  assert.match(lastText(), /Zusammenfassung[\s\S]*6 Flaschen · Weinkeller\n🎁 Geschenk von Marc Muster · Normalpreis CHF\s38\.00\n/);
  assert.doesNotMatch(lastText(), /bezahlt|bei /, "kein bezahlter Preis, kein Händler");
  await confirmAndSave();
  assert.deepEqual([item().is_gift, item().purchase_price, item().regular_price, item().vendor_id, item().gift_from], [true, 0, 38, null, "Marc Muster"]);
  assert.match(lastText(), /eingebucht\.\n🎁 Geschenk von Marc Muster · Normalpreis CHF\s38\.00\n/);
});

test("„🎁 Geschenk“ → „Überspringen“ → „🤷 Weiss ich nicht“: gift_from und regular_price NULL", async () => {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  await press("🎁");
  await press("Überspringen");
  assert.deepEqual([state().gift_from, state().step], [null, "regular_price"]);
  await say("–");
  assert.equal(state().regular_price, null);
  assert.match(lastText(), /\n🎁 Geschenk\n/);
  await confirmAndSave();
  assert.deepEqual([item().is_gift, item().purchase_price, item().regular_price, item().gift_from], [true, 0, null, null]);
  assert.match(lastText(), /eingebucht\.\n🎁 Geschenk\n/);
});

test("Normalpreis: 34.80 gespeichert; 0, -5, „keine Ahnung“ → freundlich nochmals fragen", async () => {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  await press("🎁");
  await press("Überspringen");
  for (const bad of ["0", "-5", "keine Ahnung"]) {
    await say(bad);
    assert.equal(state().step, "regular_price", bad);
    assert.equal(state().regular_price, undefined, bad);
    assert.ok(VARIANTS.giftValueRetry.some((v) => lastText().startsWith(v)), `${bad}: ${lastText()}`);
    assert.deepEqual(buttons().map((b) => b.text), ["🤷", "✖️ Abbrechen"]);
  }
  await say("34.80");
  assert.equal(state().regular_price, 34.8);
  await confirmAndSave();
  assert.equal(item().regular_price, 34.8);
  assert.equal(parseAmount("CHF 38.-"), 38);
  assert.equal(giftValueInText("Geschenk von Marc, Wert ca. 40 Franken"), 40);
  assert.equal(giftValueInText("Geschenk von Marc"), null);
  assert.ok([...VARIANTS.giftValue, ...VARIANTS.giftValueRetry].every((t) => !/ß/.test(t)));
});

test("Geschenk aus Freitext: mit Name nur die Normalpreis-Frage; mit Name und Wert keine Frage", async () => {
  // a) Name bekannt (Claude) → nur „Normalpreis?“
  reset();
  parseResult = entry({ gift: true, gift_from: "  Marc " });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, Geschenk von Marc");
  assert.equal(state().step, "regular_price");
  assert.ok(!texts().some((t) => /bezahlt\?|Von wem/.test(t)));
  assert.ok(VARIANTS.giftValue.some((v) => lastText().startsWith(v)));
  // b) Name und Wert bekannt (Claude meldet den Wert als Normalpreis) → keine Frage
  reset();
  parseResult = entry({ gift: true, gift_from: "Marc", regular_price: 40 });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, Geschenk von Marc, Wert 40 Franken");
  assert.equal(state().step, "confirm");
  assert.ok(!texts().some((t) => /bezahlt\?|Von wem|normalerweise|wert\?|Normalpreis pro/i.test(t.split("Zusammenfassung")[0])));
  await confirmAndSave();
  assert.deepEqual([item().is_gift, item().purchase_price, item().regular_price, item().gift_from], [true, 0, 40, "Marc"]);
  // c) nur im Text erkannt (Claude meldet nichts), Wert auch im Text → keine Frage
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller – Geschenk von Anna, Wert ca. 35 Franken");
  assert.deepEqual([state().step, state().gift_from, state().regular_price], ["confirm", "Anna", 35]);
  // d) Geschenk ohne Name → „Von wem?“, dann Normalpreis; keine Preisfrage
  reset();
  parseResult = entry({ gift: true });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, ein Geschenk");
  assert.equal(state().step, "gift_from");
  assert.ok(!texts().some((t) => /bezahlt\?/.test(t)));
});

test("Bildtext beim Foto: Geschenk direkt übernehmen; ohne Wert noch die Normalpreis-Frage", async () => {
  reset();
  job().source = "telegram";
  await continuePhotoPurchase(db, JOB, 111, { proposal: { ...entry({}), purchase: undefined } as never, vintageCertain: true, model: "x", confidence: 1, notes: null, imageSides: null } as never, "Geschenk von Sara");
  assert.deepEqual([state().is_gift, state().price, state().gift_from, state().regular_price], [true, 0, "Sara", undefined]);
  assert.equal(nextPurchaseStep({ ...state(), storage_room: "Weinkeller", quantity: 2 }), "regular_price", "nur noch der Normalpreis");
  assert.equal(nextPurchaseStep({ ...state(), gift_from: undefined, storage_room: "Weinkeller", quantity: 2 }), "gift_from");
  reset();
  job().source = "telegram";
  await continuePhotoPurchase(db, JOB, 111, { proposal: { ...entry({}), purchase: undefined } as never, vintageCertain: true, model: "x", confidence: 1, notes: null, imageSides: null } as never, "Geschenk von Sara, Wert 45");
  assert.equal(state().regular_price, 45);
  assert.equal(nextPurchaseStep({ ...state(), storage_room: "Weinkeller", quantity: 2 }), "saving", "keine Frage mehr");
});

test("Normalpreis-Frage beim Geschenk lässt sich abbrechen und läuft nach 10 Minuten ab", async () => {
  reset();
  parseResult = entry({ gift: true, gift_from: "Marc" });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, Geschenk von Marc");
  await press("✖️ Abbrechen");
  assert.equal(job().status, "discarded");
  reset();
  parseResult = entry({ gift: true, gift_from: "Marc" });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, Geschenk von Marc");
  job().updated_at = minutesAgo(11);
  await expireStale(db, 111);
  assert.equal(job().status, "discarded");
});

test("Normaler Preis wie bisher", async () => {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  await say("24.50");
  assert.deepEqual([state().step, state().price, state().is_gift], ["regular_price", 24.5, undefined]);
  await say("–");
  await press("Überspringen");
  await confirmAndSave();
  assert.deepEqual([item().is_gift, item().purchase_price, item().gift_from], [false, 24.5, null]);
  assert.match(lastText(), /Bezahlt CHF\s24\.50/);
});

test("„Von wem?“ läuft nach 10 Minuten ab und lässt sich abbrechen", async () => {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  await press("🎁");
  await press("✖️ Abbrechen");
  assert.equal(job().status, "discarded");
  assert.equal(net.tables.inventory_items.length, 0);

  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  await press("🎁");
  job().updated_at = minutesAgo(11);
  await expireStale(db, 111);
  assert.equal(job().status, "discarded");
  assert.match(lastText(), /Pintia 2019 lasse ich mal beiseite/);
});
