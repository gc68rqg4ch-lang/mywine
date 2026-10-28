// „📷 Neuer Wein“ → Foto/Album bzw. Beschreibung ist die Antwort darauf: keine Meldung
// „Den angefangenen neuen Wein lasse ich mal beiseite.“, genau ein aktiver Ablauf, der normal
// weiterläuft. Nur Abläufe mit Inhalt (z. B. erkannter Wein) werden weiterhin gemeldet.
// Supabase, Storage, Telegram und Claude per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { runLater } from "@/lib/later";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
type Row = Record<string, unknown>;
const label = {
  name: "La Crée", producer: "Domaine Belleville", vintage_year: 2022, country: "Frankreich", region: "Bourgogne", appellation: "Rully", type: "white",
  grape_shares: [], alcohol_content: null, bottle_size_ml: 750, confidence: 0.95, uncertain_notes: null, vintage_certain: true, image_sides: ["front"],
};
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(), files: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
    }
    if (tools.includes("report_grape_shares")) return claudeTool("report_grape_shares", { grapes: [], percentages_for_vintage: false, sources: [] });
    if (JSON.stringify(body.messages).includes('"image"')) return claudeText(label);
    // Text-Erfassung („Neuer Wein“ → Beschreibung)
    return claudeText({ ...label, purchase: { quantity: 6, storage_room: "Weinkeller", price: 0, regular_price: 0, vendor: "", gift: false, gift_from: "" } });
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset(jobs: Row[] = []) {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_encounters: [], telegram_chat_messages: [],
    cellar_overview: [], latest_wine_ratings: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }, ...jobs],
  };
  net.telegram.length = 0;
  net.storage!.clear();
}
const texts = () => net.telegram.filter((t) => t.method === "sendMessage").map((t) => String(t.body.text));
const flows = () => net.tables.ingest_jobs.filter((j) => j.source !== MENU_SOURCE);
const active = () => flows().filter((j) => ["received", "processing", "needs_review"].includes(String(j.status)));
const say = (text: string) =>
  handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
let msgId = 20;
async function album(n: number, caption?: string) {
  const bytes = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#e0d090" } }).jpeg().toBuffer();
  const group = `album-${msgId}`;
  for (let i = 0; i < n; i++) {
    const fileId = `photo-${++msgId}`;
    net.files!.set(fileId, new Uint8Array(bytes));
    await handleUpdate({
      update_id: msgId,
      message: { message_id: msgId, media_group_id: group, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, ...(i === 0 && caption ? { caption } : {}), photo: [{ file_id: fileId, file_unique_id: fileId, width: 300, height: 450 }] },
    } as never);
  }
}
const BESIDE = /lasse ich mal beiseite/;

test("„📷 Neuer Wein“ → Album: keine Meldung „beiseite“, genau ein aktiver Ablauf, Erkennung läuft", async () => {
  reset();
  await say("📷 Neuer Wein");
  assert.match(texts().at(-1)!, /Vorder- und Rückseite/);
  assert.equal(active().length, 1);
  assert.equal((active()[0].extracted as { step: string }).step, "describe");

  await album(2, "gekauft");
  assert.ok(!texts().some((t) => BESIDE.test(t)), texts().join("\n---\n"));
  assert.equal(active().length, 1, "genau ein aktiver Ablauf (das Album)");
  assert.equal(active()[0].source, "telegram");
  await runLater(); // Ruhezeit des Albums, dann Erkennung
  assert.ok(texts().some((t) => /La Crée/.test(t)), "Erkennung läuft normal weiter");
  assert.ok(!texts().some((t) => BESIDE.test(t)));
  assert.equal(active().length, 1);
});

test("„📷 Neuer Wein“ → Beschreibung als Text: keine Meldung, derselbe Ablauf läuft weiter", async () => {
  reset();
  await say("📷 Neuer Wein");
  const describe = active()[0];
  await say("La Crée 2022 von Domaine Belleville, 6 Flaschen, Weinkeller, gekauft");
  await runLater();
  assert.ok(!texts().some((t) => BESIDE.test(t)), texts().join("\n---\n"));
  assert.equal(active().length, 1);
  assert.equal(active()[0].id, describe.id, "der wartende Ablauf wird weiterverwendet");
  assert.notEqual((active()[0].extracted as { step: string }).step, "describe");
});

test("Laufender Ablauf mit erkanntem Wein → neues Foto: Meldung „beiseite“ kommt weiterhin", async () => {
  reset([
    {
      id: "12121212-1212-4212-8212-121212121212", source: "telegram", telegram_chat_id: 111, status: "needs_review", photo_paths: [],
      created_at: minutesAgo(2), updated_at: minutesAgo(2),
      extracted: { step: "quantity", proposal: { name: "Pintia", vintage_year: 2019 }, storage_room: "Weinkeller", vintage_confirmed: true },
    },
  ]);
  await album(1, "gekauft");
  assert.ok(texts().includes("Den angefangenen Pintia 2019 lasse ich mal beiseite."), texts().join("\n---\n"));
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === "12121212-1212-4212-8212-121212121212")!.status, "discarded");
});
