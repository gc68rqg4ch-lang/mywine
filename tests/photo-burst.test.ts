// Vorder- und Rückseite als zwei einzelne Nachrichten (nicht als Album): beide Fotos gehören in
// denselben Ablauf, solange er noch sammelt, erkannt wird oder vor der ersten Antwort steht
// (innert 15 s). Eine Erkennung mit allen Fotos, eine Rückfrage; auch bei gleichzeitigen
// Webhook-Aufrufen (Unique-Index in der DB, hier nachgebildet). Alben wie bisher; ein Foto nach
// dem Zeitfenster startet einen neuen Ablauf. Telegram, Claude und Supabase per Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { saveJob } from "@/lib/ingest/flow";
import { PHOTO_JOIN_MS, jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import type { IngestState } from "@/lib/ingest/schema";
import { tastedData } from "@/lib/chat/tasted";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { runLater } from "@/lib/later";
import { T } from "@/lib/bot/texts";

const CHAT = 111;
const recognitions: number[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: { replace_grape_shares: () => [] }, storage: new Map(), files: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      const content = (body.messages as { content: { type: string }[] }[])[0].content;
      const images = content.filter((b) => b.type === "image").length;
      recognitions.push(images);
      return claudeText({
        name: "Heida", producer: "Provins", vintage_year: 2022, country: "Schweiz", region: "Wallis", appellation: null, type: "white",
        grape_shares: [], alcohol_content: null, bottle_size_ml: 750,
        confidence: 0.95, uncertain_notes: null, vintage_certain: true, image_sides: images === 2 ? ["front", "back"] : ["front"].slice(0, images),
      });
    }
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
installNet(net);

// Nachbildung des Unique-Index „höchstens ein sammelnder Foto-Ablauf pro Chat“.
net.fail = (method, table, body) => {
  if (method !== "POST" || table !== "ingest_jobs") return null;
  const row = (Array.isArray(body) ? body[0] : body) as Record<string, unknown>;
  if (row?.source !== "telegram" || row.status !== "received") return null;
  const other = net.tables.ingest_jobs.find((j) => j.id !== row.id && j.source === "telegram" && j.status === "received" && j.telegram_chat_id === row.telegram_chat_id);
  if (other) conflicts++;
  return other ? { status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint \"ingest_jobs_one_received_photo_job\"" } } : null;
};

let conflicts = 0;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
async function reset() {
  net.tables = {
    persons: [{ id: "p1", name: "Sara", sort_order: 0, telegram_user_id: CHAT }],
    wines: [], inventory_items: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_taste_profiles: [],
    research_suggestions: [], telegram_chat_messages: [], wine_encounters: [], places: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: CHAT, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: ago(999_000), updated_at: ago(999_000) }],
  };
  net.telegram.length = 0;
  net.storage!.clear();
  recognitions.length = 0;
  for (const [id, color] of [["front", "#c0d080"], ["back", "#f0f0e0"], ["third", "#202020"]]) {
    net.files!.set(id, await sharp({ create: { width: 300, height: 450, channels: 3, background: color } }).jpeg().toBuffer());
  }
}
const photo = (messageId: number, fileId: string, extra: Record<string, unknown> = {}) => ({
  update_id: messageId,
  message: { message_id: messageId, from: { id: CHAT, is_bot: false, first_name: "S" }, chat: { id: CHAT, type: "private" }, date: Math.floor(Date.now() / 1000), photo: [{ file_id: fileId, file_unique_id: fileId, width: 300, height: 450 }], ...extra },
});
const cb = (data: string) => ({ update_id: 900, callback_query: { id: "cb", from: { id: CHAT, is_bot: false, first_name: "S" }, data, message: { message_id: 9, chat: { id: CHAT, type: "private" }, date: 0 } } });
const photoJobs = () => net.tables.ingest_jobs.filter((j) => j.source === "telegram");
const texts = () => net.telegram.filter((t) => t.method === "sendMessage").map((t) => String(t.body.text));
const questions = () => texts().filter((t) => t.includes(T.boughtOrTasted));
/** Ruhezeit vorbei: Erkennung starten (wie nach ALBUM_QUIET_MS), ohne zu warten. */
async function recognize(jobId: string, parallel = 1) {
  for (const j of net.tables.ingest_jobs) if (j.id === jobId) j.updated_at = ago(10_000);
  await Promise.all(Array.from({ length: parallel }, () => processJob(jobId, CHAT)));
}
async function buyAndSave(jobId: string) {
  await handleUpdate(cb(tastedData(jobId, "buy")) as never);
  await runLater().catch(() => undefined);
  const job = net.tables.ingest_jobs.find((j) => j.id === jobId)!;
  assert.equal((job.extracted as IngestState).step, "review", JSON.stringify(job.extracted));
  job.extracted = { ...(job.extracted as IngestState), step: "saving", storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null };
  await saveJob(job as never, CHAT);
}

test("Zwei Einzelfotos 1 s auseinander → ein Ablauf, eine Erkennung mit beiden, eine Rückfrage; beide Fotos beim Wein", async () => {
  await reset();
  await handleUpdate(photo(586, "front") as never);
  await handleUpdate(photo(587, "back") as never);
  assert.equal(photoJobs().length, 1, "ein Ablauf");
  const jobId = photoJobs()[0].id as string;
  assert.equal(jobId, jobIdFor(CHAT, "m586"));
  assert.deepEqual([...net.storage!.keys()].filter((k) => k.includes(photoFolder(jobId))).sort(), [`wine-photos/${photoFolder(jobId)}/586.jpg`, `wine-photos/${photoFolder(jobId)}/587.jpg`]);

  await recognize(jobId);
  assert.deepEqual(recognitions, [2], "eine Erkennung mit beiden Fotos");
  assert.equal(questions().length, 1, "eine Rückfrage");
  await buyAndSave(jobId);
  const media = net.tables.wine_media.map((m) => [String(m.storage_path).split("/").pop(), m.kind, m.sort_order]);
  assert.deepEqual(media, [["586.jpg", "label_front", 0], ["587.jpg", "label_back", 1]]);
});

test("Gleichzeitig verarbeitet (zwei Webhook-Aufrufe parallel, zwei Erkennungs-Starts) → ein Ablauf, eine Rückfrage", async () => {
  await reset();
  conflicts = 0;
  // Jede Anfrage etwas verzögert, damit beide Aufrufe wirklich ineinander laufen.
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 3));
    return base(input, init);
  }) as typeof fetch;
  try {
    await Promise.all([handleUpdate(photo(586, "front") as never), handleUpdate(photo(587, "back") as never)]);
  } finally {
    globalThis.fetch = base;
  }
  assert.equal(photoJobs().length, 1, "die DB lässt nur einen sammelnden Ablauf zu");
  assert.ok(conflicts >= 1, "beide wollten einen neuen Ablauf anlegen – der Unique-Index hat entschieden");
  const jobId = photoJobs()[0].id as string;
  const folder = [...net.storage!.keys()].filter((k) => k.startsWith("wine-photos/telegram/"));
  assert.equal(folder.length, 2);
  assert.ok(folder.every((k) => k.includes(photoFolder(jobId))), "beide Fotos im selben Ablauf");
  await recognize(jobId, 2);
  assert.deepEqual(recognitions, [2]);
  assert.equal(questions().length, 1, "nur eine Rückfrage");
});

test("Album wie bisher: ein Ablauf über media_group_id, beide Fotos", async () => {
  await reset();
  await handleUpdate(photo(600, "front", { media_group_id: "album-7" }) as never);
  await handleUpdate(photo(601, "back", { media_group_id: "album-7" }) as never);
  assert.deepEqual(photoJobs().map((j) => j.id), [jobIdFor(CHAT, "album-7")]);
  await recognize(jobIdFor(CHAT, "album-7"));
  assert.deepEqual(recognitions, [2]);
  assert.equal(questions().length, 1);
});

test("Foto nach dem Zeitfenster → neuer Ablauf (der alte wird wie bisher beiseitegelegt)", async () => {
  await reset();
  await handleUpdate(photo(586, "front") as never);
  const first = photoJobs()[0];
  await recognize(first.id as string);
  assert.equal((first.extracted as IngestState).step, "intent");
  first.updated_at = ago(PHOTO_JOIN_MS + 5_000);
  await handleUpdate(photo(590, "back") as never);
  assert.equal(photoJobs().length, 2);
  const second = photoJobs().find((j) => j.id !== first.id)!;
  assert.equal(second.id, jobIdFor(CHAT, "m590"));
  assert.equal(second.status, "received");
  assert.equal(first.status, "discarded", "wie bisher: neues Foto = neues Anliegen");
});

test("Foto kurz nach der ersten Frage → kommt zum selben Wein, keine zweite Frage; nach einer Antwort nicht mehr", async () => {
  await reset();
  await handleUpdate(photo(586, "front") as never);
  const job = photoJobs()[0];
  await recognize(job.id as string);
  assert.equal(questions().length, 1);
  await handleUpdate(photo(587, "back") as never);
  assert.equal(photoJobs().length, 1);
  assert.deepEqual(job.photo_paths, [`${photoFolder(job.id as string)}/586.jpg`, `${photoFolder(job.id as string)}/587.jpg`]);
  assert.equal(questions().length, 1, "keine zweite Rückfrage");
  assert.match(texts().at(-1)!, /Foto (lege ich zum selben Wein|nehme ich gleich zu diesem Wein dazu)/);
  await buyAndSave(job.id as string);
  assert.deepEqual(net.tables.wine_media.map((m) => [String(m.storage_path).split("/").pop(), m.sort_order]), [["586.jpg", 0], ["587.jpg", 1]]);
  assert.equal(photoJobs().length, 1, "kein verlorener zweiter Ablauf");
});

test("Kann ein Foto keinem Ablauf zugeordnet werden, sagt Antoine es", async () => {
  await reset();
  // Ein anderer Ablauf sammelt (Unique-Index greift), ist aber beim erneuten Lesen schon zu alt.
  net.tables.ingest_jobs.push({ id: "other", source: "telegram", telegram_chat_id: CHAT, status: "received", extracted: { step: "received" }, photo_paths: [], telegram_message_ids: [], created_at: ago(60_000), updated_at: ago(60_000) });
  await handleUpdate(photo(700, "front") as never);
  assert.equal(texts().at(-1), T.photoNotAssigned);
});
