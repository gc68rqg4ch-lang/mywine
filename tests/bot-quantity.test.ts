// Einbuchen im Bot: Anzahl Flaschen – feste Knöpfe, „✏️ Andere Zahl“ (Zahl als Text, nur ganze
// Zahlen ab 1), Zahl direkt tippen, Anzahl aus Bild-/Freitext ohne Frage; Ablauf nach 10 Min.
// und ✖️ Abbrechen. Claude, Telegram und Supabase per Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { continuePhotoPurchase, nextPurchaseStep, processTextJob, saveJob } from "@/lib/ingest/flow";
import { parseQuantity, quantityInText } from "@/lib/ingest/messages";
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


test("Anzahl prüfen: ganze Zahl ab 1; im Bild-/Freitext erkennen", () => {
  assert.equal(parseQuantity("24"), 24);
  assert.equal(parseQuantity(" 3 Flaschen"), 3);
  for (const bad of ["0", "-3", "zwei", "2.5", "2,5", "1000", ""]) assert.equal(parseQuantity(bad), null, bad);
  assert.equal(quantityInText("Pintia 2019, 6 Flaschen, Weinkeller"), 6);
  assert.equal(quantityInText("12 Fl. im Keller"), 12);
  assert.equal(quantityInText("1 Flasche Geschenk von Marc"), 1);
  assert.equal(quantityInText("Pintia 2019, 66 Franken"), null);
  assert.equal(quantityInText("0.75 l Flasche"), null);
  assert.equal(VARIANTS.quantityOther.length, 3);
  assert.equal(VARIANTS.quantityRetry.length, 3);
  assert.ok([...VARIANTS.quantityOther, ...VARIANTS.quantityRetry].every((t) => !/ß/.test(t)));
});

async function askQuantity(text = "Pintia 2019, Weinkeller") {
  reset();
  parseResult = entry({ quantity: 0 });
  await processTextJob(JOB, 111, text);
}

test("Bestehende Knöpfe wie bisher, dazu „✏️ Andere Zahl“", async () => {
  await askQuantity();
  assert.equal(state().step, "quantity");
  assert.deepEqual(buttons().map((b) => b.text), ["1", "2", "3", "6", "12", "✏️ Andere Zahl", "✖️ Abbrechen"]);
  await press("6");
  assert.deepEqual([state().step, state().quantity], ["price", 6]);
});

test("„✏️ Andere Zahl“ + 24 → 24 gespeichert; 0, -3, zwei, 2.5 → freundlich nochmals fragen", async () => {
  await askQuantity();
  await press("✏️ Andere Zahl");
  assert.ok(VARIANTS.quantityOther.includes(lastText() as never), lastText());
  assert.deepEqual(buttons().map((b) => b.text), ["✖️ Abbrechen"]);
  for (const bad of ["0", "-3", "zwei", "2.5"]) {
    await say(bad);
    assert.equal(state().step, "quantity", bad);
    assert.equal(state().quantity, undefined, bad);
    assert.ok(VARIANTS.quantityRetry.includes(lastText() as never), `${bad}: ${lastText()}`);
  }
  await say("24");
  assert.deepEqual([state().step, state().quantity], ["price", 24]);
  await press("🤷");
  await press("🤷");
  await press("Überspringen");
  await confirmAndSave();
  assert.equal(item().quantity, 24);
  assert.match(lastText(), /ich habe 24 Flaschen Pintia 2019/);
});

test("Zahl direkt getippt (ohne Knopf) → übernommen", async () => {
  await askQuantity();
  await say("24");
  assert.deepEqual([state().step, state().quantity], ["price", 24]);
});

test("Anzahl im Freitext oder Bildtext → keine Frage", async () => {
  // Freitext: Claude meldet sie …
  reset();
  parseResult = entry({ quantity: 6 });
  await processTextJob(JOB, 111, "Pintia 2019, 6 Flaschen, Weinkeller");
  assert.deepEqual([state().step, state().quantity], ["price", 6]);
  assert.ok(!texts().some((t) => /Wie viele Flaschen/.test(t)));
  // … oder nur der Text enthält sie
  reset();
  parseResult = entry({ quantity: 0 });
  await processTextJob(JOB, 111, "Pintia 2019, 3 Flaschen, Weinkeller");
  assert.deepEqual([state().step, state().quantity], ["price", 3]);
  // Bildtext beim Foto
  reset();
  job().source = "telegram";
  await continuePhotoPurchase(db, JOB, 111, { proposal: { ...entry({}), purchase: undefined } as never, vintageCertain: true, model: "x", confidence: 1, notes: null, imageSides: null } as never, "12 Flaschen für den Keller");
  assert.equal(state().quantity, 12);
  assert.equal(nextPurchaseStep({ ...state(), storage_room: "Weinkeller" }), "price", "keine Frage nach der Anzahl");
});

test("Rückfrage lässt sich abbrechen und läuft nach 10 Minuten ab", async () => {
  await askQuantity();
  await press("✏️ Andere Zahl");
  await press("✖️ Abbrechen");
  assert.equal(job().status, "discarded");

  await askQuantity();
  await press("✏️ Andere Zahl");
  job().updated_at = minutesAgo(11);
  await expireStale(db, 111);
  assert.equal(job().status, "discarded");
  assert.match(lastText(), /Pintia 2019 lasse ich mal beiseite/);
});
