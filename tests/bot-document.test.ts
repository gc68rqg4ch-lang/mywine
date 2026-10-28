// Dokumente (PDF) über den Bot: Vorschläge aus Dateiname/Bildtext, „🔎 Anderen Wein suchen“,
// „📎 Dokument“ im Wein-Menü (nächstes PDF ohne Rückfrage), falscher Dateityp, zu gross,
// Abbrechen, Zeitgrenze 10 Minuten, ℹ️ Details. Gespeichert wie in der App (wine-documents,
// wine_media). Supabase, Storage und Telegram per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { T } from "@/lib/bot/texts";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION, encodeMenu } from "@/lib/chat/menu-view";
import { matchWines, yearInText } from "@/lib/media/doc-match";
import { DOCUMENT_BUCKET } from "@/lib/media/documents";
import { HELP_TEXT } from "@/lib/ingest/messages";
import { savedMessage } from "@/lib/ingest/flow";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const HYPE = "11111111-1111-4111-8111-111111111111";
const HYPE_RES = "22222222-2222-4222-8222-222222222222";
const PINTIA = "33333333-3333-4333-8333-333333333333";
type Row = Record<string, unknown>;

const net: Net = { tables: {}, telegram: [], rpc: {}, storage: new Map(), files: new Map(), claude: () => { throw new Error("kein Claude erwartet"); } };
installNet(net);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function reset() {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [
      { id: HYPE, name: "The Hype", producer: "Cave Hype", type: "red" },
      { id: HYPE_RES, name: "The Hype Reserve", producer: "Cave Hype", type: "red" },
      { id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red" },
    ],
    inventory_items: [
      { id: "i1", wine_id: HYPE, vintage_year: 2020, status: "sealed", quantity: 3 },
      { id: "i2", wine_id: PINTIA, vintage_year: 2019, status: "sealed", quantity: 6 },
    ],
    wine_encounters: [], wine_media: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }],
  };
  net.telegram.length = 0;
  net.storage!.clear();
}
const sent = () => net.telegram.filter((t) => t.method === "sendMessage" || t.method === "editMessageText").map((m) => String(m.body.text));
const lastButtons = () =>
  ((net.telegram.filter((t) => t.method === "sendMessage" || t.method === "editMessageText").at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (text: string, date = Math.floor(Date.now() / 1000)) => {
  const b = lastButtons().find((x) => x.text === text);
  assert.ok(b?.callback_data, `Knopf „${text}“ fehlt: ${lastButtons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date } } } as never);
};
const sendDoc = (document: Row, caption?: string) =>
  handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, document, caption } } as never);
const say = (text: string) =>
  handleUpdate({ update_id: 1, message: { message_id: 6, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);
const pdf = (name: string, size = 120_000) => ({ file_id: `f-${name}`, file_unique_id: "u", file_name: name, mime_type: "application/pdf", file_size: size });
const docJob = () => net.tables.ingest_jobs.filter((j) => j.source === "telegram_document").at(-1)!;
const media = () => net.tables.wine_media;

test("Abgleich aus Dateiname und Bildtext: „2020-the-hype-cabernet…“ → The Hype 2020", () => {
  const wines = [
    { id: HYPE, name: "The Hype", producer: "Cave Hype", years: [2020, 2021] },
    { id: HYPE_RES, name: "The Hype Reserve", producer: "Cave Hype", years: [2019] },
    { id: PINTIA, name: "Pintia", producer: "Vega Sicilia", years: [2019] },
  ];
  assert.equal(yearInText("2020-the-hype-cabernet-sauvignon.pdf"), 2020);
  const m = matchWines("2020-the-hype-cabernet-sauvignon.pdf", wines);
  assert.deepEqual(m.map((x) => [x.name, x.year]), [["The Hype", 2020], ["The Hype Reserve", 2020]]);
  assert.deepEqual(matchWines("Datenblatt.pdf Pintia", wines).map((x) => [x.name, x.year]), [["Pintia", 2019]], "Bildtext zählt, einziger Jahrgang");
  assert.deepEqual(matchWines("rechnung-mai.pdf", wines), []);
});

test("PDF ohne Bezug: Frage mit bis zu 3 Vorschlägen; Wahl legt es ab wie in der App, mit Link", async () => {
  reset();
  await sendDoc(pdf("2020-the-hype-cabernet-sauvignon.pdf"));
  assert.equal(sent().at(-1), "📎 Danke für „2020-the-hype-cabernet-sauvignon.pdf“. Zu welchem Wein gehört das?");
  assert.deepEqual(lastButtons().map((b) => b.text), ["🍷 The Hype 2020", "🍷 The Hype Reserve 2020", "🔎 Anderen Wein suchen", "✖️ Abbrechen"]);
  assert.equal(media().length, 0, "noch nichts gespeichert");
  await press("🍷 The Hype 2020");
  assert.equal(media().length, 1);
  const row = media()[0];
  assert.deepEqual([row.wine_id, row.vintage_year, row.kind, row.storage_bucket, row.file_name, row.mime_type], [HYPE, 2020, "document", DOCUMENT_BUCKET, "2020-the-hype-cabernet-sauvignon.pdf", "application/pdf"]);
  assert.match(String(row.storage_path), new RegExp(`^app/${HYPE}/[0-9a-f-]{36}\\.pdf$`), "gleicher Ort wie in der App");
  assert.ok(net.storage!.has(`${DOCUMENT_BUCKET}/${row.storage_path}`), "Datei im Bucket");
  assert.match(sent().at(-1)!, /^📎 Ich habe das Dokument beim The Hype 2020 abgelegt\./);
  assert.match(sent().at(-1)!, /<a href="https:\/\/[^"]+\/wein\/11111111-1111-4111-8111-111111111111\?jahrgang=2020">In der App öffnen<\/a>/);
  assert.equal(docJob().status, "confirmed");
  // Zweiter Klick: nichts doppelt
  await handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: `dc:${docJob().id}:0`, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
  assert.equal(media().length, 1);
});

test("„🔎 Anderen Wein suchen“: Name schreiben, Treffer antippen", async () => {
  reset();
  await sendDoc(pdf("rechnung-mai.pdf"));
  assert.match(sent().at(-1)!, /auf Anhieb keinen passenden/);
  await press("🔎 Anderen Wein suchen");
  assert.equal(sent().at(-1), T.docSearchAsk);
  await say("Bordeaux");
  assert.match(sent().at(-1)!, /Zu „Bordeaux“ finde ich keinen Wein/);
  await say("Pintia");
  assert.equal(sent().at(-1), "Welcher ist es?");
  await press("🍷 Pintia 2019");
  assert.deepEqual([media()[0].wine_id, media()[0].vintage_year, media()[0].file_name], [PINTIA, 2019, "rechnung-mai.pdf"]);
});

test("„📎 Dokument“ im Wein-Menü: das nächste PDF gehört ohne Rückfrage zu diesem Wein", async () => {
  reset();
  await handleUpdate({
    update_id: 1,
    callback_query: {
      id: "cb", from: { id: 111, is_bot: false, first_name: "M" },
      data: encodeMenu({ op: "doc", subject: { kind: "vintage", wineId: PINTIA, year: 2019 }, back: { kind: "stock" } }),
      message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) },
    },
  } as never);
  assert.equal(sent().at(-1), "📎 Schick mir das PDF für <b>Pintia 2019</b> – ich lege es direkt dort ab.");
  await sendDoc(pdf("Datenblatt.pdf"));
  assert.ok(!sent().some((t) => t.includes("Zu welchem Wein")), "keine Rückfrage");
  assert.deepEqual([media()[0].wine_id, media()[0].vintage_year, media()[0].file_name], [PINTIA, 2019, "Datenblatt.pdf"]);
  assert.match(sent().at(-1)!, /^📎 Ich habe das Dokument beim Pintia 2019 abgelegt\./);
  // Das übernächste PDF wird wieder nachgefragt.
  await sendDoc(pdf("noch-eins.pdf"));
  assert.match(sent().at(-1)!, /Zu welchem Wein gehört das\?/);
});

test("Zeitgrenze 10 Minuten: „📎 Dokument“ wartet nicht länger; offene Frage läuft ab", async () => {
  reset();
  net.tables.ingest_jobs.push({ id: "77777777-7777-4777-8777-777777777777", source: "telegram_document", telegram_chat_id: 111, status: "needs_review", created_at: minutesAgo(11), updated_at: minutesAgo(11), extracted: { kind: "document", step: "waiting", target: { wineId: PINTIA, year: 2019, title: "Pintia 2019" } } });
  await sendDoc(pdf("Datenblatt.pdf"));
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === "77777777-7777-4777-8777-777777777777")!.status, "discarded");
  assert.equal(media().length, 0, "nach 10 Minuten nicht mehr automatisch zugeordnet");
  assert.match(sent().at(-1)!, /Zu welchem Wein gehört das\?/);
  // Die Frage selbst: nach 11 Minuten ohne Antwort beiseite gelegt.
  docJob().updated_at = minutesAgo(11);
  await say("Hallo");
  assert.equal(docJob().status, "discarded");
  assert.ok(sent().includes("Das Dokument „Datenblatt.pdf“ lasse ich mal beiseite."), sent().join(" | "));
});

test("Abbrechen, falscher Dateityp, zu gross", async () => {
  reset();
  await sendDoc(pdf("2020-the-hype.pdf"));
  await press("✖️ Abbrechen");
  assert.equal(sent().at(-1), T.docCancelled);
  assert.equal(docJob().status, "discarded");
  assert.equal(media().length, 0);

  reset();
  await sendDoc({ file_id: "x", file_unique_id: "u", file_name: "liste.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_size: 2000 });
  assert.equal(sent().at(-1), T.docOnlyPdf);
  assert.match(T.docOnlyPdf, /^Ich nehme nur PDFs an/);
  await sendDoc(pdf("riesig.pdf", 25 * 1024 * 1024));
  assert.equal(sent().at(-1), T.docTooBig);
  assert.match(T.docTooBig, /App/);
  assert.equal(net.tables.ingest_jobs.filter((j) => j.source === "telegram_document").length, 0);
  // Kein echtes PDF (falscher Inhalt): nichts gespeichert, ehrliche Meldung
  net.files!.set("f-fake.pdf", new TextEncoder().encode("hello"));
  await sendDoc(pdf("fake.pdf"));
  await press("🔎 Anderen Wein suchen");
  await say("Pintia");
  await press("🍷 Pintia 2019");
  assert.equal(media().length, 0);
  assert.equal(sent().at(-1), T.docSaveError);
});

test("Texte im zentralen Modul: Hilfe und Einbuchen im Ton von Antoine", () => {
  assert.equal(HELP_TEXT, T.help);
  assert.match(T.help, /📎 Datenblätter und andere PDFs kannst du mir einfach schicken/);
  const text = savedMessage({ proposal: { name: "Pintia", vintage_year: 2019 }, storage_room: "Weinkeller", quantity: 6 } as never, [], () => 0);
  assert.equal(text, "✅ Wunderbar – ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht.\nMöchtest du gleich eine öffnen oder bewerten?");
});
