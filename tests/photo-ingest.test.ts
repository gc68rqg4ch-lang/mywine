// Integrationstest: Erfassung per Foto (Bot) – Album erkennen, Frage „gekauft oder nur
// verkostet?“ (ohne Bildtext), Recherche, Vorschlag, Jahrgang
// ist Pflicht (unsicher gelesen → Rückfrage), Kaufangaben per Knopf, Speichern mit Etikett-
// Fotos samt Vorschaubild. Claude, Telegram und Supabase (inkl. Storage) per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { saveJob } from "@/lib/ingest/flow";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import { callbackData } from "@/lib/ingest/messages";
import type { IngestState } from "@/lib/ingest/schema";
import { tastedData } from "@/lib/chat/tasted";
import { runLater } from "@/lib/later";

const net: Net = {
  tables: {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: null }],
    wines: [], inventory_items: [], ingest_jobs: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [],
  },
  telegram: [],
  rpc: { replace_grape_shares: () => [] },
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      // Etikett: Pintia, Jahrgang 2019 gelesen, aber nicht sicher; Foto 1 vorne, Foto 2 hinten.
      return claudeText({
        name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: null, appellation: null, type: "red",
        grape_shares: [], alcohol_content: null, bottle_size_ml: 750,
        confidence: 0.92, uncertain_notes: "Jahrgang teilweise verdeckt", vintage_certain: false, image_sides: ["front", "back"],
      });
    }
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", {
        producer: null, country: null, region: "Toro", appellation: "DO Toro", type: null, alcohol_content: 14.5,
        vintages: [{ vintage_year: 2019, drink_from_year: 2024, drink_until_year: 2032, grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true }],
        sources: ["https://pintia.example"],
      });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${JSON.stringify(tools)}`);
  },
  storage: new Map(),
};
installNet(net);

const JOB = jobIdFor(111, "album-1");
const label = (color: string) => sharp({ create: { width: 600, height: 900, channels: 3, background: color } }).jpeg().toBuffer();
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const lastText = () => String(net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.text ?? "").replace(/ /g, " ");
const cb = (data: string) => ({
  update_id: 2,
  callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } },
});

test("Album erkennen: Vorschlag mit Recherche, unsicherer Jahrgang wird vermerkt", async () => {
  // Zwei Fotos liegen im Ordner des Jobs; das Album ist ruhig (Ruhezeit vorbei).
  net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], updated_at: new Date(Date.now() - 60_000).toISOString() });
  net.storage!.set(`wine-photos/${photoFolder(JOB)}/10.jpg`, { bytes: await label("#802030"), type: "image/jpeg" });
  net.storage!.set(`wine-photos/${photoFolder(JOB)}/11.jpg`, { bytes: await label("#f0e0c0"), type: "image/jpeg" });

  await processJob(JOB, 111);
  // Ohne Bildtext: erst fragen, nie ungefragt einbuchen.
  assert.equal(state().step, "intent");
  assert.match(lastText(), /Pintia[\s\S]*2019\nHast du ihn gekauft \(Bestand\) oder nur verkostet\?/);
  const intentButtons = (net.telegram.at(-1)!.body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
  assert.deepEqual(intentButtons, ["🛒 Gekauft", "🍷 Nur verkostet"]);
  assert.equal(net.tables.inventory_items.length, 0);

  await handleUpdate(cb(tastedData(JOB, "buy")) as never);
  await runLater();
  assert.equal(job().status, "needs_review");
  assert.deepEqual(job().photo_paths, [`${photoFolder(JOB)}/10.jpg`, `${photoFolder(JOB)}/11.jpg`]);
  const s = state();
  assert.equal(s.step, "review");
  assert.equal(s.vintage_uncertain, true);
  assert.deepEqual([s.proposal.region, s.proposal.appellation, s.proposal.alcohol_content], ["Toro", "DO Toro", 14.5]);
  assert.deepEqual([s.drink_from_year, s.drink_until_year], [2024, 2032]);
  assert.deepEqual(s.proposal.grape_shares, [{ grape: "Tinta de Toro", percent: 100 }]);
  assert.match(lastText(), /Pintia/);
  assert.ok(net.telegram.some((t) => String(t.body.text).includes("2 Fotos erhalten")));
});

test("Jahrgang Pflicht: nach [Speichern] zuerst die Rückfrage zum Jahrgang", async () => {
  await handleUpdate(cb(callbackData("save", JOB)) as never);
  assert.equal(state().step, "vintage");
  assert.match(lastText(), /Jahrgang <b>2019<\/b> gelesen, bin mir aber nicht sicher/);
  const buttons = (net.telegram.filter((t) => t.method === "sendMessage").at(-1)!.body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat().map((b) => b.text);
  assert.deepEqual(buttons, ["✅ 2019 stimmt", "Ohne Jahrgang (NV)", "✖️ Abbrechen"]);

  await handleUpdate(cb(callbackData("vint", JOB, "2019")) as never);
  assert.equal(state().vintage_confirmed, true);
  assert.equal(state().step, "location");
});

test("Kaufangaben per Knopf, dann Speichern: Charge, Trinkfenster, Etikett-Fotos mit Vorschaubild", async () => {
  await handleUpdate(cb(callbackData("loc", JOB, "keller")) as never);
  assert.equal(state().step, "quantity");
  await handleUpdate(cb(callbackData("qty", JOB, "6")) as never);
  assert.equal(state().step, "price");
  await handleUpdate(cb(callbackData("skipprice", JOB)) as never);
  await handleUpdate(cb(callbackData("skipregular", JOB)) as never);
  assert.equal(state().step, "vendor");

  // [Überspringen] beim Händler stösst saveJob per after() an – hier direkt aufrufen.
  job().extracted = { ...state(), vendor_id: null, vendor_name: null, step: "saving" };
  await saveJob(job() as never, 111);
  assert.equal(job().status, "confirmed");
  assert.equal(net.tables.wines.length, 1);
  const item = net.tables.inventory_items[0];
  assert.deepEqual([item.quantity, item.vintage_year, item.storage_room, item.purchase_price], [6, 2019, "Weinkeller", null]);
  assert.deepEqual([net.tables.wine_vintages[0]?.drink_from_year, net.tables.wine_vintages[0]?.drink_until_year], [2024, 2032]);
  const media = net.tables.wine_media as { kind: string; thumb_path: string | null; vintage_year: number; inventory_item_id: string }[];
  assert.deepEqual(media.map((m) => m.kind), ["label_front", "label_back"]);
  assert.ok(media.every((m) => m.thumb_path?.endsWith(".thumb.webp") && net.storage!.has(`wine-photos/${m.thumb_path}`)), "Vorschaubilder gespeichert");
  assert.ok(media.every((m) => m.vintage_year === 2019 && m.inventory_item_id === item.id));
  assert.match(lastText(), /^✅ Ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht\./);
});
