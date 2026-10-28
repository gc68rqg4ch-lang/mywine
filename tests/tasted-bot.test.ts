// Integrationstest: „Verkostet“ im Bot – Absicht erkennen (Foto mit/ohne Hinweis, Ankündigung),
// Schnellablauf (Etikett → Jahrgang → ⭐ → gespeichert → freiwillige Angaben), Freitext in
// einem Schritt, Abgleich ohne Produzent (mehrere Treffer → Auswahl), alles oder nichts,
// Menü „Verkostet“ und Löschen des letzten Eintrags („Auch den Wein löschen?“).
// Claude, Telegram und Supabase (inkl. Storage) per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import { TASTED_SOURCE, nextTastedStep, processTastedText } from "@/lib/chat/tasted";
import { announcesTasting, parseEncounterPrice, tastedIntent } from "@/lib/chat/tasted-text";
import { runLater } from "@/lib/later";
import { tastedListScreen } from "@/lib/chat/menu";
import { MAIN_KEYBOARD, MENU_TEXT, menuKeyFor } from "@/lib/chat/menu-view";
import { editTools } from "@/lib/chat/edit-tools";
import { sendEditProposal } from "@/lib/chat/edits";
import { wouldLeaveEmptyWine } from "@/lib/edit/encounters";
import type { PendingProposal } from "@/lib/chat/tools";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const SARA = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const PINTIA = "11111111-1111-4111-8111-111111111111";
const CAB_A = "33333333-3333-4333-8333-333333333333";
const CAB_B = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
let tastedReply: Row = {};
let recognized: Row = {};

const net: Net = {
  tables: {},
  telegram: [],
  rpc: {},
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", {
        producer: null, country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5,
        vintages: [], sources: [],
      });
    }
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      const content = JSON.stringify(body.messages);
      return claudeText(content.includes('"image"') ? recognized : tastedReply);
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${JSON.stringify(tools)}`);
  },
  storage: new Map(),
};

function reset() {
  net.tables = {
    persons: [
      { id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 },
      { id: SARA, name: "Sara", sort_order: 1, telegram_user_id: 222 },
    ],
    wines: [{ id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", want_to_buy: false }],
    inventory_items: [], wine_encounters: [], wine_ratings: [], wine_tastings: [], places: [], ingest_jobs: [], wine_media: [],
    wine_vintages: [], wine_grape_shares: [], telegram_chat_messages: [], vendors: [],
  };
  net.telegram.length = 0;
  net.fail = undefined;
  net.storage = new Map();
  // Bildtext ohne weitere Angaben (nur „probiert“)
  tastedReply = {
    name: null, producer: null, vintage_year: null, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: -1, want_to_buy: false },
  };
  recognized = {
    name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: null, appellation: null, type: "red",
    grape_shares: [], alcohol_content: null, bottle_size_ml: 750, confidence: 0.95, uncertain_notes: null, vintage_certain: true, image_sides: ["front"],
  };
}
installNet(net);
const db = createAdminClient();

const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const lastText = () => String(sent().at(-1)?.body.text ?? "").replace(/ /g, " ");
const lastButtons = () =>
  ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (text: string) => {
  const b = lastButtons().find((x) => x.text === text);
  assert.ok(b?.callback_data, `Knopf „${text}“ fehlt: ${lastButtons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({
    update_id: 1,
    callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } },
  } as never);
};
const say = (text: string) =>
  handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
const tastedJob = () => net.tables.ingest_jobs.filter((j) => j.source === TASTED_SOURCE).at(-1)!;
const step = () => (tastedJob().extracted as { step: string }).step;

async function photoAlbum(key: string, extracted: Row | null) {
  const id = jobIdFor(111, key);
  net.tables.ingest_jobs.push({ id, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], extracted, updated_at: new Date(Date.now() - 60_000).toISOString() });
  const bytes = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#802030" } }).jpeg().toBuffer();
  net.storage!.set(`wine-photos/${photoFolder(id)}/10.jpg`, { bytes, type: "image/jpeg" });
  await processJob(id, 111);
  return id;
}

test("Absicht erkennen: Bildtext/Nachricht, Ankündigung, Preis", () => {
  for (const t of ["Im Restaurant probiert", "verkosten gerade", "trinken gerade bei Freunden", "Heute im Kronenhalle den Pintia probiert, 120 Franken die Flasche"]) {
    assert.equal(tastedIntent(t), "tasted", t);
  }
  for (const t of ["Gekauft bei Mövenpick", "6 Flaschen für den Weinkeller", "nachgekauft"]) assert.equal(tastedIntent(t), "bought", t);
  for (const t of ["", "Pintia 2019", "Schau mal", "im Restaurant probiert und 6 Flaschen gekauft"]) assert.equal(tastedIntent(t), null, t);
  assert.ok(announcesTasting("Wir verkosten gerade einen Wein"));
  assert.ok(announcesTasting("Wir verkosten einen Wein!"));
  assert.ok(announcesTasting("ich probiere gleich einen"));
  assert.ok(!announcesTasting("Heute im Kronenhalle den Pintia 2019 probiert"));
  assert.ok(announcesTasting("Wir probieren jetzt einen Rotwein"));
  assert.ok(!announcesTasting("Welche Rioja habe ich noch?"));
  assert.ok(!announcesTasting("Ich trinke gerade den Palermo"));
  assert.deepEqual(parseEncounterPrice("120"), { price: 120, unit: "bottle", currency: "CHF" });
  assert.deepEqual(parseEncounterPrice("14 Glas"), { price: 14, unit: "glass", currency: "CHF" });
  assert.deepEqual(parseEncounterPrice("65 AED pro Glas"), { price: 65, unit: "glass", currency: "AED" });
  assert.deepEqual(parseEncounterPrice("90 €"), { price: 90, unit: "bottle", currency: "EUR" });
  assert.equal(parseEncounterPrice("teuer"), null);
  // Schnellablauf: Wein klären → Jahrgang → ⭐ → speichern (Text vorher Zusammenfassung)
  assert.equal(nextTastedStep({ origin: "photo" }), "t_match");
  assert.equal(nextTastedStep({ origin: "photo", wineId: null }), "t_vintage");
  assert.equal(nextTastedStep({ origin: "photo", wineId: null, vintageConfirmed: true }), "t_rate");
  assert.equal(nextTastedStep({ origin: "photo", wineId: null, vintageConfirmed: true, rating: null }), "t_saving");
  assert.equal(nextTastedStep({ origin: "text", wineId: PINTIA, vintageConfirmed: true, rating: 4 }), "t_confirm");
});

test("Foto ohne Hinweis: zuerst Frage „Gekauft“ / „Nur verkostet“ – nichts eingebucht", async () => {
  reset();
  await photoAlbum("ohne", null);
  assert.match(lastText(), /Hast du ihn gekauft \(Bestand\) oder nur verkostet\?/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["🛒 Gekauft", "🍷 Nur verkostet", "✖️ Abbrechen"]);
  assert.equal(net.tables.inventory_items.length + net.tables.wine_encounters.length, 0);
  await press("🍷 Nur verkostet");
  assert.equal(step(), "t_vintage", "weiter im Schnellablauf");
  assert.match(lastText(), /Jahrgang <b>2019<\/b> – stimmt das\?/);
});

test("Schnellablauf: Foto „im Restaurant probiert“ → Jahrgang → ⭐ → gespeichert, danach freiwillige Angaben", async () => {
  reset();
  const photoJob = await photoAlbum("restaurant", { step: "received", caption: "Im Restaurant probiert" });
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === photoJob)!.status, "confirmed", "Foto-Eintrag geht als verkostet weiter");
  // Bestehender Wein (Name + Produzent) – kein neuer Wein, keine Fragen zu Lagerort/Anzahl/Händler.
  assert.equal((tastedJob().extracted as { wineId: string }).wineId, PINTIA);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ 2019 stimmt", "Ohne Jahrgang (NV)", "✖️ Abbrechen"]);
  await press("✅ 2019 stimmt");
  assert.match(lastText(), /⭐ Wie viele Sterne gibst du dem Vega Sicilia – Pintia 2019, Michel\?/);
  await press("4½ ★");

  // Sofort gespeichert: Eintrag mit Bewertung von Michel am bestehenden Wein.
  assert.equal(net.tables.wines.length, 1);
  assert.equal(net.tables.inventory_items.length, 0, "nicht im Bestand");
  const [enc] = net.tables.wine_encounters;
  assert.deepEqual([enc.wine_id, enc.vintage_year, enc.person_id, enc.source], [PINTIA, 2019, MICHEL, "bot"]);
  assert.deepEqual(net.tables.wine_ratings.map((r) => [r.person_id, r.rating, r.encounter_id]), [[MICHEL, 4.5, enc.id]]);
  assert.match(lastText(), /^✅ Ich habe <b>Vega Sicilia – Pintia<\/b> 2019 als verkostet gespeichert mit ⭐ 4½\./);
  assert.deepEqual(lastButtons().map((b) => b.text), ["📍 Ort", "💰 Preis", "🎉 Anlass", "👥 Begleitung", "🛒 Kaufen?", "📝 Notiz", "⭐ für Sara", "✅ Fertig"]);
  await runLater(); // Ergänzungen erst nach dem Speichern (Websuche)

  // Ort und Preis per Text
  await press("📍 Ort");
  assert.equal(step(), "t_input");
  await say("Kronenhalle");
  assert.equal(net.tables.places[0].name, "Kronenhalle");
  assert.equal(net.tables.wine_encounters[0].place_id, net.tables.places[0].id);
  await press("💰 Preis");
  await say("14 Glas");
  assert.deepEqual([enc.price, enc.price_unit, enc.currency], [14, "glass", "CHF"]);
  assert.match(lastText(), /📍 Kronenhalle · 💰 CHF\s14\.00 \/ Glas/);

  // Kaufen? und ⭐ für Sara
  await press("🛒 Kaufen?");
  assert.equal(net.tables.wines[0].want_to_buy, true);
  await press("⭐ für Sara");
  assert.match(lastText(), /Wie viele Sterne gibt Sara\?/);
  await press("4 ★");
  assert.deepEqual(net.tables.wine_ratings.map((r) => [r.person_id, r.rating]), [[MICHEL, 4.5], [SARA, 4]]);
  await press("✅ Fertig");
  assert.equal(tastedJob().status, "confirmed");
  assert.match(lastText(), /^👍 Fertig/);
});

test("Ankündigung „wir verkosten einen Wein“: die nächste Nachricht gilt als verkostet (Freitext in einem Schritt)", async () => {
  reset();
  await say("Wir verkosten gerade einen Wein");
  assert.equal(step(), "t_armed");
  assert.match(lastText(), /erfasse ihn als verkostet/);

  tastedReply = {
    name: "Pintia", producer: null, vintage_year: 2019, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "Kronenhalle", price: 120, price_unit: "bottle", currency: "CHF", occasion: "", companions: "Sara", note: "", rating: 4.5, want_to_buy: true },
  };
  await say("Heute im Kronenhalle den Pintia 2019 probiert, 120 Franken die Flasche, mit Sara, 4,5 Sterne, würd ich kaufen");
  await runLater();
  // Alles erkannt, nur noch die Zusammenfassung mit Ja/Nein; ohne Produzent über den Namen gefunden.
  assert.equal(step(), "t_confirm");
  assert.match(lastText(), /Verkostet – Zusammenfassung/);
  assert.match(lastText(), /Diesen Wein kenne ich schon/);
  assert.match(lastText(), /⭐ Michel: 4½ ★/);
  assert.match(lastText(), /📍 Kronenhalle · 💰 CHF\s120\.00 \/ Flasche · 👥 Sara · 🛒 Kaufen\? vorgemerkt/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ Ja, speichern", "✖️ Nein"]);
  assert.equal(net.tables.wine_encounters.length, 0, "vor dem Ja nichts gespeichert");

  await press("✅ Ja, speichern");
  assert.equal(net.tables.wines.length, 1, "kein neuer Wein");
  const [enc] = net.tables.wine_encounters;
  assert.deepEqual([enc.wine_id, enc.price, enc.price_unit, enc.companions], [PINTIA, 120, "bottle", "Sara"]);
  assert.equal(net.tables.wines[0].want_to_buy, true);
  assert.deepEqual(net.tables.wine_ratings.map((r) => r.rating), [4.5]);
  await runLater();
});

test("Freitext ohne Jahrgang und Sterne: nur Fehlendes fragen; [Nein] speichert nichts", async () => {
  reset();
  tastedReply = {
    name: "Clos Mogador", producer: null, vintage_year: null, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: -1, want_to_buy: false },
  };
  net.tables.ingest_jobs.push({ id: "99999999-9999-4999-8999-999999999999", source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText("99999999-9999-4999-8999-999999999999", 111, "Clos Mogador probiert");
  assert.equal(step(), "t_vintage");
  await say("2016");
  assert.equal(step(), "t_rate");
  await say("4,5");
  assert.equal(step(), "t_confirm");
  assert.match(lastText(), /Neuer Wein – ich lege ihn an/);
  await press("✖️ Nein");
  assert.equal(tastedJob().status, "discarded");
  assert.equal(net.tables.wines.length + net.tables.wine_encounters.length, 1, "nur Pintia, kein Eintrag");
});

test("Abgleich ohne Produzent: mehrere Weine heissen so → Auswahl; der gewählte bekommt den Eintrag", async () => {
  reset();
  net.tables.wines.push(
    { id: CAB_A, name: "Cabernet Sauvignon", producer: "Produzent A", type: "red", country: "USA", want_to_buy: false },
    { id: CAB_B, name: "Cabernet Sauvignon", producer: "Produzent B", type: "red", country: "Chile", want_to_buy: false },
  );
  tastedReply = {
    name: "Cabernet Sauvignon", producer: null, vintage_year: 2020, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 3, want_to_buy: false },
  };
  net.tables.ingest_jobs.push({ id: "88888888-8888-4888-8888-888888888888", source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText("88888888-8888-4888-8888-888888888888", 111, "Cabernet Sauvignon 2020 probiert, 3 Sterne");
  assert.equal(step(), "t_match");
  assert.deepEqual(lastButtons().map((b) => b.text), [
    "Produzent A – Cabernet Sauvignon · USA",
    "Produzent B – Cabernet Sauvignon · Chile",
    "➕ Neuer Wein „Cabernet Sauvignon“",
    "✖️ Abbrechen",
  ]);
  await press("Produzent B – Cabernet Sauvignon · Chile");
  assert.equal(step(), "t_confirm");
  await press("✅ Ja, speichern");
  assert.equal(net.tables.wines.length, 3, "kein neuer Wein");
  assert.equal(net.tables.wine_encounters[0].wine_id, CAB_B);
  await runLater();
});

test("Alles oder nichts: schlägt die Bewertung fehl, bleibt weder Wein noch Eintrag zurück", async () => {
  reset();
  tastedReply = {
    name: "Neuer Wein", producer: "Weingut X", vintage_year: 2021, type: "white", country: null, region: null,
    tasting: { tasted_on: "", place: "Bar Y", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 4, want_to_buy: false },
  };
  net.tables.ingest_jobs.push({ id: "77777777-7777-4777-8777-777777777777", source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText("77777777-7777-4777-8777-777777777777", 111, "Neuer Wein 2021 in der Bar Y probiert, 4 Sterne");
  net.fail = (method, table) => (method === "POST" && table === "wine_ratings" ? { status: 500, body: { message: "boom" } } : null);
  const original = console.error;
  console.error = () => undefined;
  try {
    await press("✅ Ja, speichern");
  } finally {
    console.error = original;
  }
  assert.deepEqual(net.tables.wines.map((w) => w.name), ["Pintia"], "neuer Wein zurückgenommen");
  assert.equal(net.tables.wine_encounters.length, 0);
  assert.equal(net.tables.places.length, 0, "neuer Ort zurückgenommen");
  assert.match(lastText(), /Ich habe nichts gespeichert\.$/);
  assert.equal(tastedJob().status, "failed");
});

test("Menüleiste „Verkostet“: letzte Einträge, 🛒 bei Merker", async () => {
  reset();
  assert.equal(menuKeyFor("🍽 Verkostet"), "tasted");
  assert.ok(MAIN_KEYBOARD.keyboard.flat().some((b) => b.text === MENU_TEXT.tasted));
  net.tables.wines[0].want_to_buy = true;
  net.tables.wine_encounters.push({ id: "e1", wine_id: PINTIA, vintage_year: 2019, tasted_on: "2026-10-12", place_id: "p1", created_at: "2026-10-12T20:00:00Z" });
  net.tables.places.push({ id: "p1", name: "Kronenhalle" });
  net.tables.wine_ratings.push({ id: "r1", wine_id: PINTIA, encounter_id: "e1", person_id: MICHEL, rating: 4.5 });
  const screen = await tastedListScreen(db);
  assert.match(screen.text, /Verkostet/);
  assert.deepEqual(screen.keyboard.inline_keyboard.flat().map((b) => b.text), ["🛒 🍷 Pintia 2019 · 12.10.2026 · Kronenhalle · ⭐ 4½"]);
});

test("Letzten Eintrag löschen: Wein bliebe leer → „Nur Eintrag“ / „Eintrag und Wein“ / „Abbrechen“", async () => {
  reset();
  const LONE = "55555555-5555-4555-8555-555555555555";
  const ENC = "66666666-6666-4666-8666-666666666666";
  net.tables.wines.push({ id: LONE, name: "Einzelstück", producer: null, type: "white", want_to_buy: false });
  net.tables.wine_encounters.push({ id: ENC, wine_id: LONE, vintage_year: 2022, tasted_on: "2026-10-01", created_at: "2026-10-01T12:00:00Z" });
  net.tables.wine_ratings.push({ id: "r1", wine_id: LONE, encounter_id: ENC, person_id: MICHEL, rating: 3 });
  net.rpc.delete_wine = (args) => {
    for (const [name, rows] of Object.entries(net.tables)) net.tables[name] = rows.filter((r) => (name === "wines" ? r.id : r.wine_id) !== args.p_wine_id);
    return [];
  };
  assert.equal(await wouldLeaveEmptyWine(db, ENC), true);
  // Mit einer Flasche (oder einer weiteren Bewertung) bliebe der Wein nicht leer.
  net.tables.inventory_items.push({ id: "i1", wine_id: LONE, status: "sealed", quantity: 1 });
  assert.equal(await wouldLeaveEmptyWine(db, ENC), false);
  net.tables.inventory_items.length = 0;

  const pending: PendingProposal[] = [];
  const tool = editTools(db, pending, { personId: MICHEL, name: "Michel" }).find((t) => t.name === "propose_delete_encounter")!;
  await (tool as unknown as { run: (input: unknown) => Promise<string> }).run({ encounter_id: ENC });
  const p = pending[0];
  assert.ok(p && "edit" in p && p.alternative);
  await sendEditProposal(db, 111, p.edit, p.preview, p.alternative);
  assert.match(lastText(), /Der Wein bleibt sonst leer zurück\. Auch den Wein löschen\?/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["Nur Eintrag", "Eintrag und Wein", "Abbrechen"]);

  // Abbrechen: nichts passiert
  await press("Abbrechen");
  assert.equal(net.tables.wine_encounters.length, 1);
  // Nochmals, dann „Eintrag und Wein“
  await sendEditProposal(db, 111, p.edit, p.preview, p.alternative);
  await press("Eintrag und Wein");
  assert.ok(!net.tables.wines.some((w) => w.id === LONE), "Wein gelöscht");
  assert.equal(net.tables.wine_encounters.length, 0);

  // Wein mit einem weiteren Eintrag: nur Ja/Nein wie bisher.
  reset();
  net.tables.wine_encounters.push(
    { id: ENC, wine_id: PINTIA, vintage_year: 2019, tasted_on: "2026-10-01", created_at: "2026-10-01T12:00:00Z" },
    { id: "e2", wine_id: PINTIA, vintage_year: 2019, tasted_on: "2026-09-01", created_at: "2026-09-01T12:00:00Z" },
  );
  const pending2: PendingProposal[] = [];
  const tool2 = editTools(db, pending2, { personId: MICHEL, name: "Michel" }).find((t) => t.name === "propose_delete_encounter")!;
  await (tool2 as unknown as { run: (input: unknown) => Promise<string> }).run({ encounter_id: ENC });
  assert.ok(pending2[0] && "edit" in pending2[0] && !pending2[0].alternative);
  await sendEditProposal(db, 111, pending2[0].edit, pending2[0].preview);
  await press("🗑 Löschen");
  assert.deepEqual(net.tables.wine_encounters.map((e) => e.id), ["e2"]);
  assert.equal(net.tables.wines.length, 1, "Wein bleibt");
});
