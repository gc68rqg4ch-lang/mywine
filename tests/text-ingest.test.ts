// Integrationstest: Erfassung eines neuen Weins per Text (Bot) – Erkennung, Recherche,
// nur fehlende Rückfragen, Zusammenfassung, Speichern, Nachkauf. Claude, Telegram und
// Supabase sind per fetch-Stub ersetzt. Ausführen: npm test
import assert from "node:assert/strict";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  SUPABASE_SECRET_KEY: "stub",
  TELEGRAM_BOT_TOKEN: "stub",
  TELEGRAM_WEBHOOK_SECRET: "stub",
  TELEGRAM_ALLOWED_USER_ID: "111",
  ANTHROPIC_API_KEY: "stub",
});

const W = "11111111-1111-4111-8111-111111111111";
const net: Net = {
  tables: {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: null }],
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
net.claude = (body) => {
  const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
  if ((body.output_config as { format?: unknown } | undefined)?.format) { claudeCalls.push("parse"); return claudeText(parseResult); }
  if (tools.includes("report_wine_details")) {
    claudeCalls.push("enrich");
    return claudeTool("report_wine_details", { producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type: "red", alcohol_content: 14.5, drink_from_year: 2024, drink_until_year: 2032, sources: ["https://pintia.example"] });
  }
  if (tools.includes("report_grape_shares")) {
    claudeCalls.push("grapes");
    return claudeTool("report_grape_shares", { grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true, sources: [] });
  }
  throw new Error(`Claude-Aufruf ohne passendes Ziel: ${JSON.stringify(tools)}`);
};
installNet(net);

import type { IngestState } from "@/lib/ingest/schema";

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

(async () => {
  // Erst nach den Umgebungsvariablen laden (die Supabase-Konfiguration wird beim Import gelesen).
  const { processTextJob, saveJob, nextPurchaseStep } = await import("@/lib/ingest/flow");
  const { handleUpdate } = await import("@/lib/ingest/bot");

  // Reine Schrittfolge: nur Fehlendes, am Ende Zusammenfassung (Text) bzw. Speichern (Foto)
  const s0 = { source: "text" } as IngestState;
  assert.equal(nextPurchaseStep(s0), "location");
  assert.equal(nextPurchaseStep({ ...s0, storage_room: "Weinkeller", quantity: 6, price: 66 }), "regular_price");
  assert.equal(nextPurchaseStep({ ...s0, storage_room: "Weinkeller", quantity: 6, price: 66, regular_price: null, vendor_name: "X" }), "confirm");
  assert.equal(nextPurchaseStep({ storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null } as IngestState), "saving");

  // A) Neuer Wein: Produzent, Herkunft, Trinkreife und Rebsorten per Recherche; nur Normalpreis fehlt
  parseResult = empty({ quantity: 6, storage_room: "Weinkeller", price: 66, vendor: "Mövenpick" }, { name: "Pintia", vintage_year: 2019 });
  newJob("aaaaaaaa-0000-4000-8000-00000000000a");
  await processTextJob("aaaaaaaa-0000-4000-8000-00000000000a", 111, "Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick");
  let st = state("aaaaaaaa-0000-4000-8000-00000000000a");
  assert.deepEqual(claudeCalls, ["parse", "enrich", "grapes"]);
  assert.equal(job("aaaaaaaa-0000-4000-8000-00000000000a").status, "needs_review"); assert.equal(st.step, "regular_price");
  assert.equal(st.proposal.producer, "Vega Sicilia"); assert.equal(st.proposal.country, "Spanien"); assert.equal(st.proposal.type, "red");
  assert.deepEqual(st.proposal.grape_shares, [{ grape: "Tinta de Toro", percent: 100 }]);
  assert.deepEqual([st.drink_from_year, st.drink_until_year], [2024, 2032]);
  assert.deepEqual([st.storage_room, st.quantity, st.price, st.vendor_name, st.restock], ["Weinkeller", 6, 66, "Mövenpick", undefined]);
  const texts = net.telegram.map((t) => String(t.body.text));
  assert.ok(texts.some((t) => t.includes("Vega Sicilia – Pintia 2019") && t.includes("Trinkreife 2024–2032")), texts.join("\n---\n"));
  assert.match(lastText(), /^Normalpreis\?/, "nur die fehlende Angabe wird gefragt");

  await handleUpdate(msg("72") as never);
  st = state("aaaaaaaa-0000-4000-8000-00000000000a");
  assert.equal(st.step, "confirm"); assert.equal(st.regular_price, 72);
  const summary = lastText().replace(/ /g, " ");
  console.log(summary + "\n");
  assert.match(summary, /Zusammenfassung[\s\S]*6 Flaschen · Weinkeller[\s\S]*bezahlt CHF 66.00 · Normalpreis CHF 72.00 · bei Mövenpick[\s\S]*Speichern\?/);
  const keyboard = net.telegram.at(-1)!.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
  assert.deepEqual(keyboard.inline_keyboard[0].map((b) => b.text), ["✅ Ja", "✖️ Nein"]);

  // Speichern: [Ja] setzt den Schritt auf „saving“ und ruft saveJob über after() auf
  job("aaaaaaaa-0000-4000-8000-00000000000a").extracted = { ...st, step: "saving" };
  await saveJob(job("aaaaaaaa-0000-4000-8000-00000000000a") as never, 111);
  assert.equal(net.tables.wines.length, 1); assert.equal(net.tables.wines[0].producer, "Vega Sicilia");
  assert.equal(net.tables.vendors[0]?.name, "Mövenpick", "Händler erst beim Speichern angelegt");
  const item = net.tables.inventory_items[0];
  assert.deepEqual([item.quantity, item.purchase_price, item.regular_price, item.storage_room, item.vendor_id, item.vintage_year], [6, 66, 72, "Weinkeller", net.tables.vendors[0].id, 2019]);
  assert.deepEqual([net.tables.wine_vintages[0]?.drink_from_year, net.tables.wine_vintages[0]?.drink_until_year], [2024, 2032]);
  assert.equal(rpcCalls.length, 1, "Rebsorten gespeichert");
  assert.equal(job("aaaaaaaa-0000-4000-8000-00000000000a").status, "confirmed");
  assert.match(lastText(), /^✅ Gespeichert: 6 Flaschen/);

  // B) Nachkauf: Wein + Jahrgang liegt schon im Keller → Rückfrage, keine Recherche der Stammdaten
  net.tables.wines.push({ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: 14.5, grapes: [] });
  net.tables.inventory_items.push({ id: "old", wine_id: W, vintage_year: 2018, status: "sealed", quantity: 2 });
  net.tables.inventory_items.push({ id: "old2", wine_id: W, vintage_year: 2018, status: "open", quantity: 1 });
  net.tables.wines.splice(0, 1); // Wein aus A entfernen, damit „Pintia“ eindeutig ist
  claudeCalls.length = 0;
  parseResult = empty({ quantity: 3 }, { name: "Pintia", vintage_year: 2018 });
  newJob("bbbbbbbb-0000-4000-8000-00000000000b");
  await processTextJob("bbbbbbbb-0000-4000-8000-00000000000b", 111, "Pintia 2018, 3 Flaschen");
  st = state("bbbbbbbb-0000-4000-8000-00000000000b");
  assert.deepEqual(claudeCalls, ["parse", "grapes"], "bekannter Wein: keine Stammdaten-Recherche");
  assert.equal(st.step, "restock"); assert.equal(job("bbbbbbbb-0000-4000-8000-00000000000b").matched_wine_id, W);
  assert.match(lastText(), /Nachkauf zu bestehendem Wein\?/);
  await handleUpdate(cb("restock:bbbbbbbb-0000-4000-8000-00000000000b") as never);
  st = state("bbbbbbbb-0000-4000-8000-00000000000b");
  assert.equal(st.restock, true); assert.equal(st.step, "location", "Lagerort fehlt noch, Anzahl nicht");
  await handleUpdate(cb("loc:bbbbbbbb-0000-4000-8000-00000000000b:wohnzimmer") as never);
  assert.equal(state("bbbbbbbb-0000-4000-8000-00000000000b").step, "price"); assert.match(lastText(), /3 Flaschen\. Was hast du bezahlt\?/);

  // C) „Neuer Wein“ in der Menüleiste: wartet auf eine Beschreibung
  await handleUpdate(msg("📷 Neuer Wein") as never);
  const describe = net.tables.ingest_jobs.find((j) => (j.extracted as IngestState).step === "describe")!;
  assert.equal(describe.source, "text"); assert.equal(describe.status, "needs_review");
  assert.match(lastText(), /beschreib den Wein/);
  console.log("text ingest tests ok");
})().catch((e) => { console.error(e); process.exit(1); });
