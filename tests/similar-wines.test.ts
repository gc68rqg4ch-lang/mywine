// Bot Antoine: vollständige Weinnamen („Reserva“ + „Legaris“ → „Legaris Reserva“) und bestehende
// Weine trotz anderer Schreibweise erkennen („Reserva“ + „Quinta da La Rosa“ ≈ „Quinta de la Rosa
// Reserva“) – Rückfrage „Meinst du …?“ beim Einbuchen (Text, Foto) und bei „Nur verkostet“.
// Claude, Telegram und Supabase per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { completeWineName, isGenericName, similarWines, wineKey } from "@/lib/ingest/wine-names";
import { normalizeProposal, type IngestState, type WineProposal } from "@/lib/ingest/schema";
import { continuePhotoPurchase, processTextJob, saveJob } from "@/lib/ingest/flow";
import { handleUpdate } from "@/lib/ingest/bot";
import { TASTED_SOURCE, processTastedText } from "@/lib/chat/tasted";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { runLater } from "@/lib/later";
import { createAdminClient } from "@/lib/supabase/admin";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const ROSA = "11111111-1111-4111-8111-111111111111";
const PINTIA = "22222222-2222-4222-8222-222222222222";
const JOB = "aaaaaaaa-0000-4000-8000-00000000000a";

let parseResult: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    if ((body.output_config as { format?: unknown } | undefined)?.format) return claudeText(parseResult);
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
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

const rosa = { id: ROSA, name: "Quinta de la Rosa Reserva", producer: "Quinta de la Rosa", type: "red", country: "Portugal", region: "Douro", appellation: null, alcohol_content: 14, grapes: [], want_to_buy: false };
function reset() {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [{ ...rosa }, { id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: 14.5, grapes: [], want_to_buy: false }],
    inventory_items: [{ id: "i1", wine_id: ROSA, vintage_year: 2019, status: "sealed", quantity: 2 }],
    vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_encounters: [], wine_ratings: [], places: [],
    wine_taste_profiles: [], research_suggestions: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION } }],
  };
  net.telegram.length = 0;
}
const job = (id = JOB) => net.tables.ingest_jobs.find((j) => j.id === id)!;
const state = (id = JOB) => job(id).extracted as IngestState;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage").map((m) => String(m.body.text));
const lastButtons = () =>
  ((net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (text: string) => {
  const b = lastButtons().find((x) => x.text === text);
  assert.ok(b?.callback_data, `Knopf „${text}“ fehlt: ${lastButtons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
};
const textEntry = (wine: Record<string, unknown>) => ({
  name: null, producer: null, vintage_year: 2019, country: null, region: null, appellation: null, type: null, grape_shares: [], alcohol_content: null, bottle_size_ml: 750, ...wine,
  purchase: { quantity: 6, storage_room: "Weinkeller", price: 24, regular_price: 29, vendor: "Coop", gift: false, gift_from: "" },
});
async function textIngest(wine: Record<string, unknown>) {
  parseResult = textEntry(wine);
  net.tables.ingest_jobs.push({ id: JOB, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], updated_at: new Date().toISOString() });
  await processTextJob(JOB, 111, "6 Flaschen Reserva");
}
async function saveText() {
  assert.equal(state().step, "confirm", JSON.stringify(state()));
  await press("✅ Ja");
  await runLater();
}

test("Regeln: nur Stufe → Marke davor; Abgleich ohne Akzente, Füllwörter und Zusätze", () => {
  assert.equal(completeWineName("Reserva", "Legaris"), "Legaris Reserva");
  assert.equal(completeWineName("Gran Reserva", "Bodegas Protos"), "Protos Gran Reserva");
  assert.equal(completeWineName("Cuvée", "Château X"), "Château X Cuvée");
  assert.equal(completeWineName("Pintia", "Vega Sicilia"), "Pintia", "eigener Name bleibt");
  assert.equal(completeWineName("Reserva", null), "Reserva", "ohne Produzent unverändert");
  for (const n of ["Reserva", "Gran Reserva", "Grande Reserva", "Riserva", "Crianza", "Reserve", "Grand Vin", "Cuvée", "Tinto", "Rosso"]) assert.ok(isGenericName(n), n);
  assert.ok(!isGenericName("Legaris Reserva"));
  assert.equal(normalizeProposal({ name: "Reserva", producer: "Legaris", grape_shares: [] } as unknown as WineProposal).name, "Legaris Reserva");

  assert.equal(wineKey("Reserva", "Quinta da La Rosa"), wineKey("Quinta de la Rosa Reserva", "Quinta de la Rosa"));
  const wines = [rosa, { id: "x", name: "Legaris Reserva", producer: "Legaris" }, { id: "y", name: "Protos Reserva", producer: "Bodegas Protos" }];
  assert.deepEqual(similarWines("Reserva", "Quinta da La Rosa", wines).map((w) => w.id), [ROSA]);
  assert.deepEqual(similarWines("Quinta de la Rosa Reserva", null, wines).map((w) => w.id), [ROSA], "Name mit Produzent, ohne Produzent-Feld");
  assert.deepEqual(similarWines("Reserva", "Protos", wines).map((w) => w.id), ["y"], "Bodegas egal");
  assert.deepEqual(similarWines("Crianza", "Legaris", wines), [], "andere Stufe");
  assert.deepEqual(similarWines("Reserva", "Pago de los Capellanes", wines), [], "anderer Produzent");
});

test("Text: Etikett „Reserva“, Produzent „Legaris“ → Name „Legaris Reserva“, neuer Wein ohne Rückfrage", async () => {
  reset();
  await textIngest({ name: "Reserva", producer: "Legaris" });
  assert.equal(state().proposal.name, "Legaris Reserva");
  assert.ok(!sent().some((t) => /[Mm]einst du/.test(t)));
  await saveText();
  assert.ok(net.tables.wines.some((w) => w.name === "Legaris Reserva" && w.producer === "Legaris"));
});

test("Text: „Reserva“ + „Quinta da La Rosa“ → „Meinst du …?“; Ja bucht als Nachkauf auf den bestehenden Wein", async () => {
  reset();
  await textIngest({ name: "Reserva", producer: "Quinta da La Rosa" });
  assert.equal(state().step, "similar");
  assert.match(sent().at(-1)!, /[Mm]einst du <b>Quinta de la Rosa Reserva \(Quinta de la Rosa\)<\/b>\?/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ Ja, dieser", "➕ Nein, neuer Wein", "✖️ Abbrechen"]);
  await press("✅ Ja, dieser");
  assert.equal(job().matched_wine_id, ROSA);
  assert.deepEqual([state().proposal.name, state().proposal.producer, state().restock], ["Quinta de la Rosa Reserva", "Quinta de la Rosa", true]);
  assert.match(sent().at(-1)!, /\(Nachkauf\)[\s\S]*neue Charge zum bestehenden Wein/);
  await saveText();
  assert.equal(net.tables.wines.length, 2, "kein neuer Wein");
  assert.deepEqual(net.tables.inventory_items.map((i) => [i.wine_id, i.quantity]), [[ROSA, 2], [ROSA, 6]]);
  assert.ok(sent().some((t) => /nachgekauft und eingebucht/.test(t)), sent().slice(-3).join("\n---\n"));
});

test("Text: „Nein, neuer Wein“ → neuer Wein wie bisher", async () => {
  reset();
  await textIngest({ name: "Reserva", producer: "Quinta da La Rosa" });
  await press("➕ Nein, neuer Wein");
  assert.equal(state().new_wine, true);
  assert.equal(job().matched_wine_id, null);
  await saveText();
  assert.equal(net.tables.wines.length, 3);
  const created = net.tables.wines.at(-1)!;
  assert.deepEqual([created.name, created.producer], ["Quinta da La Rosa Reserva", "Quinta da La Rosa"]);
});

test("Klar anderer Wein → keine Rückfrage; exakter Treffer → wie bisher ohne Rückfrage", async () => {
  reset();
  await textIngest({ name: "Crianza", producer: "Quinta de la Rosa" });
  assert.notEqual(state().step, "similar");
  assert.ok(!sent().some((t) => /[Mm]einst du/.test(t)));
  assert.equal(job().matched_wine_id, null);

  reset();
  await textIngest({ name: "quinta de la rosa reserva", producer: "Quinta de la Rosa" });
  assert.equal(state().step, "restock", "exakter Treffer: wie bisher Nachkauf-Frage");
  assert.equal(job().matched_wine_id, ROSA);
  assert.ok(!sent().some((t) => /[Mm]einst du/.test(t)));
});

test("Foto: ähnlicher Wein → Rückfrage, Ja → Vorschlag zum bestehenden Wein, gespeichert ohne neuen Wein", async () => {
  reset();
  net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "processing", extracted: { step: "received" }, photo_paths: [], updated_at: new Date().toISOString() });
  const proposal = normalizeProposal({ name: "Reserva", producer: "Quinta da La Rosa", vintage_year: 2019, country: null, region: null, appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750 });
  await continuePhotoPurchase(createAdminClient(), JOB, 111, { proposal, model: "x", confidence: 0.9, notes: null, imageSides: null, vintageCertain: true });
  assert.equal(state().step, "similar");
  assert.match(sent().at(-1)!, /[Mm]einst du <b>Quinta de la Rosa Reserva \(Quinta de la Rosa\)<\/b>\?/);
  await press("✅ Ja, dieser");
  assert.equal(state().step, "review");
  assert.equal(job().matched_wine_id, ROSA);
  assert.equal(state().proposal.name, "Quinta de la Rosa Reserva");
  job().extracted = { ...state(), step: "saving", storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null };
  await saveJob(job() as never, 111);
  assert.equal(net.tables.wines.length, 2);
  assert.equal(net.tables.inventory_items.at(-1)!.wine_id, ROSA);
});

test("Nur verkostet: ähnlicher Wein → „Meinst du …?“; Ja hängt den Eintrag an den bestehenden Wein", async () => {
  reset();
  parseResult = {
    name: "Reserva", producer: "Quinta da La Rosa", vintage_year: 2019, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 4, want_to_buy: false },
  };
  const T_JOB = "99999999-9999-4999-8999-999999999999";
  net.tables.ingest_jobs.push({ id: T_JOB, source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText(T_JOB, 111, "Gestern einen Reserva von Quinta da La Rosa probiert, 4 Sterne");
  assert.match(sent().at(-1)!, /[Mm]einst du <b>Quinta de la Rosa Reserva \(Quinta de la Rosa\)<\/b>\?/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ Ja, dieser", "➕ Nein, neuer Wein", "✖️ Abbrechen"]);
  await press("✅ Ja, dieser");
  await press("✅ Ja, speichern");
  assert.equal(net.tables.wines.length, 2, "kein neuer Wein");
  assert.equal(net.tables.wine_encounters[0]?.wine_id, ROSA);

  // Nein → neuer Wein
  reset();
  net.tables.ingest_jobs.push({ id: T_JOB, source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText(T_JOB, 111, "Gestern einen Reserva von Quinta da La Rosa probiert, 4 Sterne");
  await press("➕ Nein, neuer Wein");
  await press("✅ Ja, speichern");
  assert.equal(net.tables.wines.length, 3);
  assert.equal(net.tables.wines.at(-1)!.name, "Quinta da La Rosa Reserva");
});
