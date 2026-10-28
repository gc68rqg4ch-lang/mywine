// Offene Rückfragen im Bot: Ablauf nach 10 Minuten (ab der letzten Antwort), neues Anliegen
// verwirft den alten Ablauf, Abbrechen (Knopf und /abbrechen), Werte aus dem Bildtext werden
// nicht nochmals gefragt, Jahrgang vom Etikett wartet auf die Antwort, Ergänzungs-Knöpfe nach
// dem Speichern, neue Menüleiste einmal pro Chat. Supabase, Telegram, Claude per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import { TASTED_SOURCE } from "@/lib/chat/tasted";
import { EXPIRED_ERROR, MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { runLater } from "@/lib/later";
import { VARIANTS } from "@/lib/bot/texts";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const SARA = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const JOB = "12121212-1212-4212-8212-121212121212";
type Row = Record<string, unknown>;
let captionReply: Row = {};

const net: Net = {
  tables: {},
  telegram: [],
  rpc: {},
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
    }
    if (JSON.stringify(body.messages).includes('"image"')) {
      return claudeText({
        name: "La Crée", producer: "Domaine Belleville", vintage_year: 2022, country: "Frankreich", region: "Bourgogne", appellation: "Rully", type: "white",
        grape_shares: [], alcohol_content: null, bottle_size_ml: 750, confidence: 0.95, uncertain_notes: null, vintage_certain: true, image_sides: ["front"],
      });
    }
    return claudeText(captionReply);
  },
  storage: new Map(),
};
installNet(net);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const purchaseJob = (updatedMinutesAgo: number, step = "quantity", createdMinutesAgo = updatedMinutesAgo): Row => ({
  id: JOB, source: "telegram", telegram_chat_id: 111, status: "needs_review", photo_paths: [],
  created_at: minutesAgo(createdMinutesAgo), updated_at: minutesAgo(updatedMinutesAgo),
  extracted: {
    step, proposal: { name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: null, region: null, appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750 },
    recognition: { model: "x", confidence: 1, notes: null, enriched_fields: [], sources: [] }, storage_room: "Weinkeller", vintage_confirmed: true,
  },
});

function reset(jobs: Row[] = []) {
  net.tables = {
    persons: [
      { id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 },
      { id: SARA, name: "Sara", sort_order: 1, telegram_user_id: 222 },
    ],
    wines: [], inventory_items: [], wine_encounters: [], wine_ratings: [], wine_tastings: [], wine_media: [], wine_vintages: [], wine_grape_shares: [],
    places: [{ id: "p1", name: "Kronenhalle" }, { id: "p2", name: "Napa Grill" }],
    vendors: [], telegram_chat_messages: [],
    // Die neue Menüleiste kennt dieser Chat schon (eigener Test weiter unten).
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }, ...jobs],
  };
  net.telegram.length = 0;
  captionReply = {
    name: null, producer: null, vintage_year: null, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: -1, want_to_buy: false },
  };
}

const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const texts = () => sent().map((m) => String(m.body.text));
const lastText = () => texts().at(-1) ?? "";
const lastButtons = () =>
  ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const job = (id = JOB) => net.tables.ingest_jobs.find((j) => j.id === id)!;
const tasted = () => net.tables.ingest_jobs.filter((j) => j.source === TASTED_SOURCE).at(-1)!;
const say = (text: string, from = 111) =>
  handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: from, is_bot: false, first_name: "M" }, chat: { id: from, type: "private" }, date: 0, text } } as never);
const press = (text: string) => {
  const b = lastButtons().find((x) => x.text === text);
  assert.ok(b?.callback_data, `Knopf „${text}“ fehlt: ${lastButtons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({
    update_id: 1,
    callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } },
  } as never);
};

async function photoAlbum(key: string, caption: string) {
  const id = jobIdFor(111, key);
  net.tables.ingest_jobs.push({ id, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], extracted: { step: "received", caption }, created_at: minutesAgo(1), updated_at: minutesAgo(1) });
  const bytes = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#e0d090" } }).jpeg().toBuffer();
  net.storage!.set(`wine-photos/${photoFolder(id)}/10.jpg`, { bytes, type: "image/jpeg" });
  await processJob(id, 111);
}

test("Abgelaufene Rückfrage (älter als 10 Min.): verworfen, gemeldet, neue Nachricht normal verarbeitet", async () => {
  reset([purchaseJob(95, "quantity", 99)]);
  await say("Wir verkosten gerade einen Wein");
  assert.equal(job().status, "discarded");
  assert.equal(job().error, EXPIRED_ERROR);
  assert.equal(texts()[0], "Den angefangenen Pintia 2019 lasse ich mal beiseite.");
  // Die neue Nachricht wird nicht als „Anzahl“ abgefangen.
  assert.ok(!texts().some((t) => t.includes("Anzahl zwischen 1 und 999")));
  assert.match(lastText(), /notiere ihn als verkostet/);
  assert.equal((tasted().extracted as { step: string }).step, "t_armed");
});

test("Die 10 Minuten laufen ab der letzten Antwort, nicht ab dem Start", async () => {
  // Vor 2 Stunden begonnen, letzte Antwort vor 8 Minuten: noch offen.
  reset([purchaseJob(8, "quantity", 120)]);
  await say("6");
  assert.equal(job().status, "needs_review");
  assert.equal((job().extracted as { step: string; quantity: number }).quantity, 6);
  assert.equal((job().extracted as { step: string }).step, "price");
  assert.ok(Date.parse(String(job().updated_at)) > Date.now() - 60_000, "updated_at neu gesetzt");
  assert.ok(!texts().some((t) => t.includes("abgelaufen")));
  // Auch eine unpassende kurze Antwort zählt als Antwort (Rückfrage, Zeit neu).
  job().updated_at = minutesAgo(9);
  await say("teuer");
  assert.match(lastText(), /Was hast du pro Flasche bezahlt\?/);
  assert.ok(Date.parse(String(job().updated_at)) > Date.now() - 60_000);
  assert.deepEqual(lastButtons().map((b) => b.text), ["🎁 Geschenk", "Überspringen", "✖️ Abbrechen"], "Knöpfe der Preisfrage bleiben");
});

test("Neues Anliegen verwirft den alten Ablauf (Text mit neuem Wein, Menü-Knopf, Befehl)", async () => {
  reset([purchaseJob(2)]);
  await say("Wir probieren jetzt einen Rotwein");
  assert.equal(job().status, "discarded");
  assert.equal(texts()[0], "Den angefangenen Pintia 2019 lasse ich mal beiseite.");
  assert.match(lastText(), /notiere ihn als verkostet/);

  reset([purchaseJob(2)]);
  await say("🍽 Verkostet");
  assert.equal(job().status, "discarded");
  assert.match(texts()[0], /lasse ich mal beiseite/);
  assert.match(lastText(), /Verkostet/);

  reset([purchaseJob(2, "vintage")]);
  await say("/id");
  assert.equal(job().status, "discarded");
  assert.match(lastText(), /Deine Telegram-ID/);
});

test("Abbrechen: Knopf unter jeder Rückfrage und /abbrechen", async () => {
  reset([purchaseJob(2)]);
  await say("x"); // erneute Rückfrage mit „✖️ Abbrechen“
  await press("✖️ Abbrechen");
  assert.equal(job().status, "discarded");
  assert.ok((VARIANTS.cancelled as readonly string[]).includes(lastText()), lastText());

  reset([purchaseJob(2, "price")]);
  await say("/abbrechen");
  assert.equal(job().status, "discarded");
  assert.equal(lastText(), "Gut, den angefangenen Pintia 2019 lasse ich bleiben.");
  await say("/abbrechen");
  assert.match(lastText(), /Es ist gerade nichts offen/);
});

test("Foto mit Bildtext „… Vier von fünf Sternen“: Sterne nicht fragen; Jahrgang vom Etikett wartet; danach Ergänzungs-Knöpfe", async () => {
  reset();
  captionReply = {
    name: null, producer: null, vintage_year: null, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "Top Wine!", rating: 4, want_to_buy: false },
  };
  await photoAlbum("la-cree", "Den hatten wir gerade im Restaurant probiert. Top Wine! Vier von fünf Sternen.");
  // Nur die Jahrgangsfrage – und dann warten (nichts gespeichert, keine Sterne-Frage).
  assert.equal((tasted().extracted as { step: string }).step, "t_vintage");
  assert.match(lastText(), /Ist es der Jahrgang <b>2022<\/b>\?/);
  assert.equal(net.tables.wine_encounters.length, 0, "wartet auf die Antwort");
  assert.ok(!texts().some((t) => t.includes("Wie viele Sterne")), "Sterne stehen im Bildtext");

  await press("✅ 2022 stimmt");
  assert.ok(!texts().some((t) => t.includes("Wie viele Sterne")));
  assert.equal(net.tables.wine_encounters.length, 1);
  assert.deepEqual(net.tables.wine_ratings.map((r) => [r.person_id, r.rating]), [[MICHEL, 4]]);
  assert.equal(net.tables.wine_encounters[0].note, "Top Wine!");

  // Ergänzungs-Knöpfe erscheinen und warten auf eine Wahl.
  assert.match(lastText(), /Möchtest du noch etwas ergänzen\?/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["📍 Ort", "💰 Preis", "🎉 Anlass", "👥 Begleitung", "🛒 Kaufen?", "📝 Notiz", "⭐ für Sara", "✅ Fertig"]);
  assert.equal(tasted().status, "needs_review");
  assert.equal((tasted().extracted as { step: string }).step, "t_extras");
  await runLater();

  // 📍 Ort: die letzten Orte zur Auswahl
  net.tables.wine_encounters.push({ id: "old", wine_id: "w", tasted_on: "2026-10-01", place_id: "p2", created_at: minutesAgo(9999) });
  await press("📍 Ort");
  assert.deepEqual(lastButtons().map((b) => b.text), ["📍 Napa Grill", "✖️ Abbrechen"]);
  await press("📍 Napa Grill");
  const mine = net.tables.wine_encounters.find((e) => e.id !== "old")!;
  assert.equal(mine.place_id, "p2");
  assert.equal((tasted().extracted as { step: string }).step, "t_extras");
  await press("✅ Fertig");
  assert.equal(tasted().status, "confirmed");
});

test("Neues Foto während Ergänzungen: alter Verkostet-Ablauf wird still abgeschlossen (nichts doppelt)", async () => {
  reset();
  await photoAlbum("erstes", "im Restaurant probiert, 4 Sterne");
  await press("✅ 2022 stimmt");
  await press("4 ★");
  const first = tasted();
  assert.equal((first.extracted as { step: string }).step, "t_extras");
  await runLater();
  // Ein neues Foto ist ein neues Anliegen (der Webhook-Pfad ruft supersede auf).
  const { supersede } = await import("@/lib/chat/pending");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  await supersede(createAdminClient(), 111, "photo");
  assert.equal(first.status, "confirmed", "gespeicherter Eintrag bleibt, Ablauf beendet");
  assert.ok(!lastText().includes("verworfen"), "kein „verworfen“ für schon Gespeichertes");
  // Eine Ankündigung („wir verkosten einen Wein“) wartet gerade auf dieses Foto – sie bleibt.
  await say("Wir verkosten gerade einen Wein");
  await supersede(createAdminClient(), 111, "photo");
  assert.equal(tasted().status, "needs_review");
  assert.equal((tasted().extracted as { step: string }).step, "t_armed");
});

test("Neue Menüleiste: einmal pro Chat mitschicken, Version gemerkt", async () => {
  reset();
  net.tables.ingest_jobs = []; // noch kein Merker
  await say("/id", 222);
  assert.match(texts()[0], /Menüleiste gibt es jetzt auch/);
  assert.ok((sent()[0].body.reply_markup as { keyboard?: { text: string }[][] }).keyboard!.flat().some((b) => b.text === "🍽 Verkostet"));
  net.telegram.length = 0;
  await say("/id", 222);
  assert.ok(!texts().some((t) => t.includes("Menüleiste")), "nur einmal");
});

test("Schnelle Chat-Vorschläge (Ja/Nein im Knopf) laufen nach 10 Minuten ab", async () => {
  reset();
  await handleUpdate({
    update_id: 1,
    callback_query: {
      id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: "co:22222222-2222-4222-8222-222222222222",
      message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) - 11 * 60, text: "❓ Pintia öffnen?" },
    },
  } as never);
  assert.equal(lastText(), "Meinen Vorschlag „Pintia öffnen“ lasse ich mal beiseite – frag mich einfach nochmals.");
});
