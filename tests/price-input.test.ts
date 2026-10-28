// Strenge Prüfung aller Preis-Eingaben im Bot (eine gemeinsame Funktion parseAmount): Kaufpreis,
// Normalpreis, Normalpreis nach „🎁 Geschenk“ (💰 Preis bei Verkostet: tasted-bot.test.ts).
// Gültig: Betrag über 0 in den bisherigen Schreibweisen; 0, negativ, ohne Zahl → nochmals fragen;
// Kaufpreis „0“ → Hinweis auf „🎁 Geschenk“. Claude, Telegram und Supabase per Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { processTextJob } from "@/lib/ingest/flow";
import { isZeroAmount, parseAmount, parsePrice, positiveAmount } from "@/lib/format";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { VARIANTS } from "@/lib/bot/texts";
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


const GOOD: [string, number][] = [
  ["38", 38], ["34.80", 34.8], ["34,80", 34.8], ["CHF 38", 38], ["38 Franken", 38], ["38.–", 38], ["38.-", 38],
  ["Fr. 38", 38], ["CHF 24.-", 24], ["1'250", 1250], ["24.50 CHF", 24.5], ["ca. 40", 40],
];
const BAD = ["0", "-5", "keine Ahnung", "0.00", "CHF -5", "− 5", ""];

test("Gemeinsame Prüfung: bisherige Schreibweisen bleiben gültig; 0, negativ, ohne Zahl ungültig", () => {
  for (const [text, value] of GOOD) {
    assert.equal(parsePrice(text), value, `${text} ging schon bisher`);
    assert.equal(parseAmount(text), value, text);
  }
  for (const text of BAD) assert.equal(parseAmount(text), null, text);
  assert.equal(isZeroAmount("0"), true);
  assert.equal(isZeroAmount("CHF 0.00"), true);
  assert.equal(isZeroAmount("-5"), false);
  // Preise aus Bild-/Freitext (Claude): 0 oder negativ = kein Preis
  assert.equal(positiveAmount(0), null);
  assert.equal(positiveAmount(-5), null);
  assert.equal(positiveAmount(Number.NaN), null);
  assert.equal(positiveAmount(34.8), 34.8);
  assert.equal(VARIANTS.priceZero.length, 2);
  assert.ok(VARIANTS.priceZero.every((t) => t.includes("🎁 Geschenk") && !/ß/.test(t)));
});

async function toPrice() {
  reset();
  parseResult = entry({});
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  assert.equal(state().step, "price");
}

test("Kaufpreis: 38, 34.80, 34,80 gültig; 0 → Hinweis auf „🎁 Geschenk“; -5, keine Ahnung → nochmals fragen", async () => {
  for (const [text, value] of [["38", 38], ["34.80", 34.8], ["34,80", 34.8]] as const) {
    await toPrice();
    await say(text);
    assert.deepEqual([state().step, state().price], ["regular_price", value], text);
  }
  await toPrice();
  await say("0");
  assert.equal(state().step, "price");
  assert.ok(VARIANTS.priceZero.includes(lastText() as never), lastText());
  assert.deepEqual(buttons().map((b) => b.text), ["🎁 Geschenk", "🤷 Weiss ich nicht", "✖️ Abbrechen"], "Knöpfe bleiben");
  for (const bad of ["-5", "keine Ahnung"]) {
    await say(bad);
    assert.deepEqual([state().step, state().price], ["price", undefined], bad);
    assert.match(lastText(), /[Ww]as hast du pro Flasche bezahlt\? Schreib mir einfach den Betrag/);
  }
  // „🤷 Weiss ich nicht“ statt „Überspringen“
  await press("🤷 Weiss ich nicht");
  assert.deepEqual([state().step, state().price], ["regular_price", null]);
  await toPrice();
  await say("0");
  await press("🎁 Geschenk");
  assert.deepEqual([state().is_gift, state().price], [true, 0], "Geschenk setzt 0 über den Knopf");
});

test("Normalpreis: 38, 34.80, 34,80 gültig; 0, -5, keine Ahnung → nochmals fragen; Knöpfe bleiben", async () => {
  for (const [text, value] of [["38", 38], ["34.80", 34.8], ["34,80", 34.8]] as const) {
    await toPrice();
    await say("30");
    await say(text);
    assert.equal(state().regular_price, value, text);
  }
  await toPrice();
  await say("30");
  for (const bad of ["0", "-5", "keine Ahnung"]) {
    await say(bad);
    assert.deepEqual([state().step, state().regular_price], ["regular_price", undefined], bad);
    assert.match(lastText(), /was kostet eine Flasche normalerweise\? Bitte einen Betrag über 0/);
    assert.deepEqual(buttons().map((b) => b.text), ["✅ Ja, gleich", "✏️ Anderer Betrag", "🤷 Weiss ich nicht", "✖️ Abbrechen"]);
  }
  await press("✅ Ja, gleich");
  assert.equal(state().regular_price, 30);
});

test("Normalpreis nach „🎁 Geschenk“: 38, 34.80, 34,80 gültig; 0, -5, keine Ahnung → nochmals fragen", async () => {
  const toValue = async () => {
    await toPrice();
    await press("🎁 Geschenk");
    await press("Überspringen");
    assert.equal(state().step, "regular_price");
  };
  for (const [text, value] of [["38", 38], ["34.80", 34.8], ["34,80", 34.8]] as const) {
    await toValue();
    await say(text);
    assert.equal(state().regular_price, value, text);
  }
  await toValue();
  for (const bad of ["0", "-5", "keine Ahnung"]) {
    await say(bad);
    assert.equal(state().regular_price, undefined, bad);
    assert.ok(VARIANTS.giftValueRetry.includes(lastText() as never), `${bad}: ${lastText()}`);
  }
  await press("🤷 Weiss ich nicht");
  assert.equal(state().regular_price, null);
});

test("Preise aus dem Freitext: 0 oder negativ gilt als „kein Preis“ → Antoine fragt nach", async () => {
  reset();
  parseResult = entry({ price: 0, regular_price: -5 });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, 0 Franken");
  assert.equal(state().step, "price");
  assert.equal(state().price, undefined);
  reset();
  parseResult = entry({ price: 24.5, regular_price: 0 });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller, 24.50");
  assert.deepEqual([state().step, state().price, state().regular_price], ["regular_price", 24.5, undefined]);
});
