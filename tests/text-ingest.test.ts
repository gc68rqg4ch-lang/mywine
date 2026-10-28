// Integrationstest: Erfassung eines neuen Weins per Text (Bot) – Erkennung, Recherche,
// nur fehlende Rückfragen, Zusammenfassung, Speichern, Nachkauf. Claude, Telegram und
// Supabase sind per fetch-Stub ersetzt. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";

const W = "11111111-1111-4111-8111-111111111111";
const net: Net = {
  tables: {
    persons: [
      { id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: null },
      { id: "c7690541-4e68-4051-aa8f-6a2920fea55b", name: "Sara", sort_order: 1, telegram_user_id: null },
    ],
    wines: [], inventory_items: [], ingest_jobs: [], vendors: [], wine_vintages: [], wine_grape_shares: [],
  },
  telegram: [],
  rpc: {},
  claude: () => { throw new Error("unerwarteter Claude-Aufruf"); },
};
const rpcCalls: Record<string, unknown>[] = [];
net.rpc.replace_grape_shares = (args) => { rpcCalls.push(args); return []; };
let parseResult: Record<string, unknown> = {};
const claudeCalls: string[] = [];
const enrichPrompts: string[] = [];
net.claude = (body) => {
  const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
  if ((body.output_config as { format?: unknown } | undefined)?.format) { claudeCalls.push("parse"); return claudeText(parseResult); }
  if (tools.includes("report_wine_details")) {
    claudeCalls.push("enrich");
    enrichPrompts.push(String((body.messages as { content: string }[])[0].content));
    // Ein Durchgang: Stammdaten und je Jahrgang Trinkfenster und Rebsorten mit %
    const vintage = (year: number) => ({ vintage_year: year, drink_from_year: 2024, drink_until_year: 2032, grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true });
    return claudeTool("report_wine_details", { producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type: "red", alcohol_content: 14.5, vintages: [2019, 2018, 2017, 0].map(vintage), sources: ["https://pintia.example"] });
  }
  if (tools.includes("report_grape_shares")) {
    claudeCalls.push("grapes");
    return claudeTool("report_grape_shares", { grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true, sources: [] });
  }
  throw new Error(`Claude-Aufruf ohne passendes Ziel: ${JSON.stringify(tools)}`);
};
installNet(net);

import type { IngestState } from "@/lib/ingest/schema";
import { handleUpdate } from "@/lib/ingest/bot";
import { processTextJob, saveJob, nextPurchaseStep } from "@/lib/ingest/flow";

const empty = (purchase: Record<string, unknown>, wine: Record<string, unknown>) => ({
  name: null, producer: null, vintage_year: null, country: null, region: null, appellation: null, type: null,
  grape_shares: [], alcohol_content: null, bottle_size_ml: null, ...wine,
  purchase: { quantity: 0, storage_room: "", price: 0, regular_price: 0, vendor: "", ...purchase },
});
const job = (id: string) => net.tables.ingest_jobs.find((j) => j.id === id)!;
const state = (id: string) => job(id).extracted as IngestState;
const lastText = () => String(net.telegram.at(-1)?.body.text ?? "");
const msg = (text: string) => ({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } });
const cb = (data: string) => ({ update_id: 2, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } } });
const newJob = (id: string) => net.tables.ingest_jobs.push({ id, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], updated_at: new Date().toISOString() });

let st: IngestState;

test("Reine Schrittfolge: nur Fehlendes, am Ende Zusammenfassung (Text) bzw. Speichern (Foto)", async () => {
  const s0 = { source: "text", proposal: { vintage_year: 2019 } } as IngestState;
  assert.equal(nextPurchaseStep(s0), "location");

  // Jahrgang ist Pflicht: fehlt er oder ist er unsicher, kommt er zuerst – ausser schon bestätigt (auch NV)
  assert.equal(nextPurchaseStep({ ...s0, proposal: { vintage_year: null } } as IngestState), "vintage");
  assert.equal(nextPurchaseStep({ ...s0, vintage_uncertain: true }), "vintage");
  assert.equal(nextPurchaseStep({ ...s0, proposal: { vintage_year: null }, vintage_confirmed: true } as IngestState), "location");
  assert.equal(nextPurchaseStep({ ...s0, storage_room: "Weinkeller", quantity: 6, price: 66 }), "regular_price");
  assert.equal(nextPurchaseStep({ ...s0, storage_room: "Weinkeller", quantity: 6, price: 66, regular_price: null, vendor_name: "X" }), "confirm");
  assert.equal(nextPurchaseStep({ ...s0, source: undefined, storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null }), "saving");
});

test("A) Neuer Wein: Produzent, Herkunft, Trinkreife und Rebsorten per Recherche; nur Normalpreis fehlt", async () => {
  parseResult = empty({ quantity: 6, storage_room: "Weinkeller", price: 66, vendor: "Mövenpick" }, { name: "Pintia", vintage_year: 2019 });
  newJob("aaaaaaaa-0000-4000-8000-00000000000a");
  await processTextJob("aaaaaaaa-0000-4000-8000-00000000000a", 111, "Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick");
  st = state("aaaaaaaa-0000-4000-8000-00000000000a");
  assert.deepEqual(claudeCalls, ["parse", "enrich"], "Stammdaten, Trinkfenster und Rebsorten in einem Durchgang");
  assert.equal(job("aaaaaaaa-0000-4000-8000-00000000000a").status, "needs_review"); assert.equal(st.step, "regular_price");
  assert.equal(st.proposal.producer, "Vega Sicilia"); assert.equal(st.proposal.country, "Spanien"); assert.equal(st.proposal.type, "red");
  assert.deepEqual(st.proposal.grape_shares, [{ grape: "Tinta de Toro", percent: 100 }]);
  assert.deepEqual([st.drink_from_year, st.drink_until_year], [2024, 2032]);
  assert.deepEqual([st.storage_room, st.quantity, st.price, st.vendor_name, st.restock], ["Weinkeller", 6, 66, "Mövenpick", undefined]);
  const texts = net.telegram.map((t) => String(t.body.text));
  assert.ok(texts.some((t) => t.includes("Vega Sicilia – Pintia 2019") && t.includes("Trinkreife 2024–2032")), texts.join("\n---\n"));
  assert.match(lastText(), /^Und was kostet er normalerweise\?/, "nur die fehlende Angabe wird gefragt");

  await handleUpdate(msg("72") as never);
  st = state("aaaaaaaa-0000-4000-8000-00000000000a");
  assert.equal(st.step, "confirm"); assert.equal(st.regular_price, 72);
  const summary = lastText().replace(/ /g, " ");
  assert.match(summary, /Zusammenfassung[\s\S]*6 Flaschen · Weinkeller[\s\S]*bezahlt CHF 66.00 · Normalpreis CHF 72.00 · bei Mövenpick[\s\S]*so speichern\?/);
  const keyboard = net.telegram.at(-1)!.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
  assert.deepEqual(keyboard.inline_keyboard[0].map((b) => b.text), ["✅ Ja", "✖️ Nein"]);

  // Speichern: [Ja] setzt den Schritt auf „saving" und ruft saveJob über after() auf
  job("aaaaaaaa-0000-4000-8000-00000000000a").extracted = { ...st, step: "saving" };
  await saveJob(job("aaaaaaaa-0000-4000-8000-00000000000a") as never, 111);
  assert.equal(net.tables.wines.length, 1); assert.equal(net.tables.wines[0].producer, "Vega Sicilia");
  assert.equal(net.tables.vendors[0]?.name, "Mövenpick", "Händler erst beim Speichern angelegt");
  const item = net.tables.inventory_items[0];
  assert.deepEqual([item.quantity, item.purchase_price, item.regular_price, item.storage_room, item.vendor_id, item.vintage_year], [6, 66, 72, "Weinkeller", net.tables.vendors[0].id, 2019]);
  assert.deepEqual([net.tables.wine_vintages[0]?.drink_from_year, net.tables.wine_vintages[0]?.drink_until_year], [2024, 2032]);
  assert.equal(rpcCalls.length, 1, "Rebsorten gespeichert");
  assert.equal(job("aaaaaaaa-0000-4000-8000-00000000000a").status, "confirmed");
});

test("Bestätigung in der Ich-Form, darunter gleich das Wein-Menü dieses Weins und Jahrgangs", async () => {
  assert.match(lastText(), /^✅ Ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht\.\n.*\nMöchtest du gleich eine öffnen oder bewerten\?$/);
  type Kb = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
  const menu = net.telegram.at(-1)!.body.reply_markup as Kb;
  const buttons = menu.inline_keyboard.flat();
  for (const label of ["🍾 Öffnen", "⭐ Bewerten", "⭐ für Sara", "📝 Verkostung", "ℹ️ Details", "📷 Foto", "✏️ Bearbeiten"]) {
    assert.ok(buttons.some((b) => b.text === label), `Knopf ${label} fehlt: ${buttons.map((b) => b.text).join(", ")}`);
  }
  const savedItem = net.tables.inventory_items[0];
  const openButton = buttons.find((b) => b.text === "🍾 Öffnen")!;
  assert.equal(openButton.callback_data, `Q:${savedItem.id}:-`, "Öffnen mit der eben gespeicherten Charge vorausgewählt");

  // Öffnen aus diesem Menü: wie im normalen Menü über open_bottle, danach die offene Flasche
  const openCalls: Record<string, unknown>[] = [];
  net.rpc.open_bottle = (args) => {
    openCalls.push(args);
    const src = net.tables.inventory_items.find((r) => r.id === args.p_item_id)!;
    src.quantity = (src.quantity as number) - 1;
    const openId = "0b0b0b0b-0000-4000-8000-000000000001";
    net.tables.inventory_items.push({ ...src, id: openId, quantity: 1, status: "open" });
    (net.tables.cellar_overview ??= []).push({
      inventory_item_id: openId, wine_id: src.wine_id, producer: "Vega Sicilia", name: "Pintia", vintage_year: 2019, type: "red",
      status: "open", fill_level_percent: args.p_fill_level_percent, date_opened: args.p_date_opened, bottle_size_ml: 750,
    });
    return openId;
  };
  await handleUpdate(cb(openButton.callback_data!) as never);
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0].p_item_id, savedItem.id); assert.equal(openCalls[0].p_fill_level_percent, 100);
  assert.match(String(openCalls[0].p_date_opened), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(savedItem.quantity, 5);
  const edited = net.telegram.filter((t) => t.method === "editMessageText").at(-1)!;
  assert.match(String(edited.body.text), /Geöffnet/);
  assert.ok((edited.body.reply_markup as Kb).inline_keyboard.flat().some((b) => b.text === "🥃 1 Glas"), "danach das Menü der offenen Flasche");
});

test("B) Nachkauf: Wein + Jahrgang liegt schon im Bestand → Rückfrage, keine Recherche der Stammdaten", async () => {
  net.tables.wines.push({ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5, grapes: [] });
  net.tables.inventory_items.push({ id: "old", wine_id: W, vintage_year: 2018, status: "sealed", quantity: 2 });
  net.tables.inventory_items.push({ id: "old2", wine_id: W, vintage_year: 2018, status: "open", quantity: 1 });
  net.tables.wines.splice(0, 1); // Wein aus A entfernen, damit „Pintia“ eindeutig ist
  claudeCalls.length = 0;
  parseResult = empty({ quantity: 3 }, { name: "Pintia", vintage_year: 2018 });
  newJob("bbbbbbbb-0000-4000-8000-00000000000b");
  await processTextJob("bbbbbbbb-0000-4000-8000-00000000000b", 111, "Pintia 2018, 3 Flaschen");
  st = state("bbbbbbbb-0000-4000-8000-00000000000b");
  assert.deepEqual(claudeCalls, ["parse", "enrich"], "bekannter Wein: ein Durchgang nur für seine Lücken");
  const knownPrompt = enrichPrompts.at(-1)!;
  assert.match(knownPrompt, /Produzent, Land, Region, Appellation, Typ, Alkohol/, "die Recherche liefert immer alles");
  assert.match(knownPrompt, /Jahrgang 2018: Trinkfenster ab\/bis, Rebsorten mit Prozent/);

  // Bei der Erfassung gehen Etikett bzw. bekannter Wein vor: nur Leeres (Appellation) übernommen
  const known = state("bbbbbbbb-0000-4000-8000-00000000000b").proposal;
  assert.deepEqual([known.region, known.alcohol_content, known.appellation], ["Toro", 14.5, "DO Toro"]);
  assert.equal(st.step, "restock"); assert.equal(job("bbbbbbbb-0000-4000-8000-00000000000b").matched_wine_id, W);
  assert.match(lastText(), /Hast du nachgekauft\?/);
  await handleUpdate(cb("restock:bbbbbbbb-0000-4000-8000-00000000000b") as never);
  st = state("bbbbbbbb-0000-4000-8000-00000000000b");
  assert.equal(st.restock, true); assert.equal(st.step, "location", "Lagerort fehlt noch, Anzahl nicht");
  await handleUpdate(cb("loc:bbbbbbbb-0000-4000-8000-00000000000b:wohnzimmer") as never);
  assert.equal(state("bbbbbbbb-0000-4000-8000-00000000000b").step, "price"); assert.match(lastText(), /3 Flaschen\. Was hast du pro Flasche bezahlt\?/);
});

test("C) „Neuer Wein“ in der Menüleiste: wartet auf eine Beschreibung", async () => {
  await handleUpdate(msg("📷 Neuer Wein") as never);
  const describe = net.tables.ingest_jobs.find((j) => (j.extracted as IngestState).step === "describe")!;
  assert.equal(describe.source, "text"); assert.equal(describe.status, "needs_review");
  assert.match(lastText(), /beschreib den Wein/);
});

test("D) Ohne Jahrgang: Rückfrage (Zahl oder „Ohne Jahrgang (NV)“), Jahrgang steht in der Zusammenfassung", async () => {
  parseResult = empty({ quantity: 2, storage_room: "Weinkeller", price: 30, regular_price: 30, vendor: "Coop" }, { name: "Pintia", producer: "Vega Sicilia" });
  newJob("dddddddd-0000-4000-8000-00000000000d");
  await processTextJob("dddddddd-0000-4000-8000-00000000000d", 111, "Pintia, 2 Flaschen, Weinkeller, 30 Franken bei Coop");
  st = state("dddddddd-0000-4000-8000-00000000000d");
  assert.equal(st.step, "vintage");
  assert.ok(net.telegram.some((t) => String(t.body.text).includes("📅 Jahrgang: fehlt noch")), "Zusammenfassung nennt den fehlenden Jahrgang");
  assert.match(lastText(), /Welcher Jahrgang/);
  const vintageButtons = (net.telegram.at(-1)!.body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
  assert.ok(vintageButtons.includes("Ohne Jahrgang (NV)"));
  await handleUpdate(msg("irgendwann") as never);
  assert.match(lastText(), /Eine Jahreszahl wie/);
  await handleUpdate(msg("2017") as never);
  st = state("dddddddd-0000-4000-8000-00000000000d");
  assert.equal(st.proposal.vintage_year, 2017); assert.equal(st.vintage_confirmed, true);
  assert.equal(st.step, "confirm", "danach direkt die Zusammenfassung – alles andere stand im Text");
  assert.match(lastText(), /📅 Jahrgang: 2017/);

  newJob("eeeeeeee-0000-4000-8000-00000000000e");
  await processTextJob("eeeeeeee-0000-4000-8000-00000000000e", 111, "Pintia, 2 Flaschen, Weinkeller, 30 Franken bei Coop");
  await handleUpdate(cb("vint:eeeeeeee-0000-4000-8000-00000000000e:nv") as never);
  st = state("eeeeeeee-0000-4000-8000-00000000000e");
  assert.equal(st.proposal.vintage_year, null); assert.equal(st.step, "confirm");
  assert.match(lastText(), /📅 Jahrgang: ohne \(NV\)/);
});
