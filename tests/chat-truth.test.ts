// Chat-Modus von Antoine: Wahrheit nur aus der Datenbank (Status-Aussage ohne Werkzeug wird
// verhindert), offene Erfassungen anzeigen und weglassen („lösch das“), Abschied ohne alte
// Themen, Gedächtnis-Fenster (12 Std. / 20 Nachrichten), Ablauf nach 10 Minuten.
// Claude (Fake mit Tool-Aufrufen), Supabase und Telegram per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate } from "@/lib/ingest/bot";
import { runLater } from "@/lib/later";
import { CHAT_STRICT_NOTE, CHAT_SYSTEM, claimsStatus } from "@/lib/bot/chat-prompt";
import { T } from "@/lib/bot/texts";
import { MENU_SOURCE, expireStale } from "@/lib/chat/pending";
import { EXPIRED_ERROR, PENDING_TTL_MINUTES, staleMessage } from "@/lib/chat/ttl";
import { MENU_VERSION, encodeMenu } from "@/lib/chat/menu-view";
import { HISTORY_LIMIT } from "@/lib/chat/history";
import { createAdminClient } from "@/lib/supabase/admin";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const JOB = "77777777-7777-4777-8777-777777777777";
type Row = Record<string, unknown>;
type Body = { model: string; system: string; tools: { name: string }[]; messages: { role: string; content: unknown }[] };

const text = (t: string, model = "claude-haiku-5-5") => ({
  id: "msg", type: "message", role: "assistant", model, stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: t }], usage: { input_tokens: 1, output_tokens: 1 },
});
/** Letzte Nachricht: Ergebnis eines Werkzeugs? Dann dessen Text. */
const toolResult = (b: Body) => {
  const last = b.messages.at(-1)!;
  const block = Array.isArray(last.content) ? (last.content as { type: string; content?: unknown }[]).find((c) => c.type === "tool_result") : null;
  if (!block) return null;
  return typeof block.content === "string" ? block.content : JSON.stringify(block.content);
};
const userText = (b: Body) => {
  const first = [...b.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  return String(first?.content ?? "");
};

let script: (b: Body, calls: number) => unknown = () => text("?");
const requests: Body[] = [];
const net: Net = {
  tables: {},
  telegram: [],
  rpc: {},
  claude: (body) => {
    requests.push(body as Body);
    return script(body as Body, requests.length) as Record<string, unknown>;
  },
};
installNet(net);
const db = createAdminClient();

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const openJob = (updatedMinutesAgo = 2, step = "confirm"): Row => ({
  id: JOB, source: "telegram", telegram_chat_id: 111, status: "needs_review", photo_paths: [],
  created_at: minutesAgo(updatedMinutesAgo), updated_at: minutesAgo(updatedMinutesAgo),
  extracted: { step, proposal: { name: "Pintia", producer: "Vega Sicilia", vintage_year: 2017, type: "red", grape_shares: [] } },
});

function reset(jobs: Row[] = [], history: Row[] = []) {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], wine_encounters: [], wine_tastings: [], places: [], vendors: [],
    telegram_chat_messages: history,
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }, ...jobs],
  };
  net.telegram.length = 0;
  requests.length = 0;
}
const sent = () => net.telegram.filter((t) => t.method === "sendMessage").map((m) => String(m.body.text));
async function say(t: string) {
  await handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text: t } } as never);
  await runLater();
}

test("System-Prompt: Persona, Wahrheit nur aus den Werkzeugen, Abschied, Fehler eingestehen", () => {
  assert.match(CHAT_SYSTEM, /persönliche Sommelier von Michel und Sara/);
  assert.match(CHAT_SYSTEM, /nur, wenn du in DIESEM Zug ein passendes Werkzeug aufgerufen hast/);
  assert.match(CHAT_SYSTEM, /Gesprächsverlauf ist nur Kontext/);
  assert.match(CHAT_SYSTEM, /ohne ungefragt offene Dinge, Weine oder alte Themen anzusprechen/);
  assert.match(CHAT_SYSTEM, /Entschuldige, da habe ich mich vertan – der Pintia war gar nicht gespeichert\./);
  assert.match(CHAT_SYSTEM, /„lösch das“, „vergiss den“, „brauchen wir nicht“/);
  assert.match(CHAT_SYSTEM, /keine Wörter wie „Erfassungsvorgang“, „Eintrag“, „Datenbank“/);
  assert.ok(!/ß/.test(CHAT_SYSTEM.replace("nie „ß“", "")), "Schweizer Schreibweise");
  assert.ok(claimsStatus("Der Pintia 2017 aus dem Kronenhalle ist vorgemerkt; schau morgen kurz drauf."));
  assert.ok(claimsStatus("🥂 Chardonnay 2023 · 11 Fl."));
  assert.ok(!claimsStatus("Gute Nacht, Michel – schlaf gut!"));
  assert.ok(!claimsStatus("Gern geschehen! Zum Lamm passt ein kräftiger Roter."));
});

test("Vorfall „ich gehe jetzt ins Bett“: Status aus dem Verlauf ohne Nachschauen wird nicht gesendet; Abschied ohne alte Themen", async () => {
  // Altes Gedächtnis (z. B. aus Tests): angeblich vorgemerkter Pintia. Gespeichert ist nichts.
  reset([], [
    { id: 1, chat_id: 111, role: "user", content: "Pintia 2017 im Kronenhalle", created_at: minutesAgo(60) },
    { id: 2, chat_id: 111, role: "assistant", content: "[Erfassung eines verkosteten Weins gestartet: Pintia 2017 Kronenhalle]", created_at: minutesAgo(60) },
  ]);
  // Fake-Claude wie im Vorfall: ohne Hinweis behauptet es den Status aus dem Verlauf.
  script = (b) => (b.system.includes(CHAT_STRICT_NOTE) ? text("Gute Nacht, Michel – schlaf gut!", b.model) : text("Der Pintia 2017 aus dem Kronenhalle ist vorgemerkt; schau morgen kurz drauf.", b.model));
  await say("ich gehe jetzt ins Bett tschüss, Antoine");
  assert.deepEqual(sent(), ["Gute Nacht, Michel – schlaf gut!"]);
  assert.ok(!sent().some((t) => /Pintia|vorgemerkt/.test(t)), "keine alten Themen, kein falscher Status");
  assert.deepEqual(requests.map((r) => r.model), ["claude-haiku-5-5", "claude-sonnet-5-5"], "zweiter Versuch mit Hinweis");
  assert.ok(requests[0].system.includes("Gesprächsverlauf ist nur Kontext"));

  // Behauptet auch der zweite Versuch Status ohne Nachschauen: ehrliche Kurzantwort statt Falschaussage.
  reset();
  script = (b) => text("Deine 6 Flaschen Pintia liegen im Weinkeller.", b.model);
  await say("wie viel Pintia habe ich noch?");
  assert.deepEqual(sent(), [T.chatLookFirst]);

  // Mit Nachschauen im selben Zug darf Antoine Status nennen.
  reset();
  script = (b) => (toolResult(b) == null ? claudeTool("list_open_entries", {}) : text("Gerade ist nichts angefangen – es ist nichts vorgemerkt.", b.model));
  await say("ist der Pintia gespeichert?");
  assert.deepEqual(sent(), ["Gerade ist nichts angefangen – es ist nichts vorgemerkt."]);
  assert.equal(requests.length, 2, "kein zweiter Versuch nötig");
  assert.match(toolResult(requests[1])!, /Keine offenen Erfassungen/);
});

test("Offene Erfassungen anzeigen und weglassen – „lösch das“ ohne Ja/Nein, kurze Bestätigung", async () => {
  reset([openJob()]);
  script = (b) => (toolResult(b) == null ? claudeTool("list_open_entries", {}) : text("Offen ist noch der Pintia 2017 – soll ich ihn weglassen?", b.model));
  await say("was ist bei dir noch offen?");
  const listed = JSON.parse(toolResult(requests[1])!);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].entry_id, JOB);
  assert.match(listed[0].what, /Pintia 2017/);
  assert.equal(listed[0].waiting_for_answer, true);
  assert.equal(sent().at(-1), "Offen ist noch der Pintia 2017 – soll ich ihn weglassen?");
  assert.ok(["list_open_entries", "cancel_open_entry"].every((n) => requests[0].tools.some((t) => t.name === n)));

  // „lösch das“: nachschauen, weglassen, kurz bestätigen – ohne Rückfrage.
  requests.length = 0;
  net.telegram.length = 0;
  script = (b) => {
    const r = toolResult(b);
    if (r == null) return claudeTool("list_open_entries", {});
    if (r.startsWith("[")) return claudeTool("cancel_open_entry", { entry_id: JSON.parse(r)[0].entry_id });
    return text("Gut, den Pintia lasse ich weg.", b.model);
  };
  await say("nein, den kannst du löschen");
  assert.match(userText(requests[0]), /löschen/);
  const job = net.tables.ingest_jobs.find((j) => j.id === JOB)!;
  assert.equal(job.status, "discarded");
  assert.match(toolResult(requests[2])!, /Weggelassen: den angefangenen Pintia 2017/);
  assert.deepEqual(sent(), ["Gut, den Pintia lasse ich weg."]);
  assert.ok(!net.telegram.some((t) => JSON.stringify(t.body.reply_markup ?? {}).includes("Ja")), "keine Ja/Nein-Rückfrage");

  // Ohne entry_id: genau eine offen → diese; keine offen → Hinweis.
  reset([openJob()]);
  script = (b) => (toolResult(b) == null ? claudeTool("cancel_open_entry", {}) : text("Gut, den Pintia lasse ich weg.", b.model));
  await say("lösch das");
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === JOB)!.status, "discarded");
  reset();
  script = (b) => (toolResult(b) == null ? claudeTool("cancel_open_entry", {}) : text("Da ist gerade nichts angefangen.", b.model));
  await say("vergiss den");
  assert.match(toolResult(requests[1])!, /Keine offenen Erfassungen/);
});

test("Gedächtnis: nur die letzten 12 Stunden und höchstens 20 Nachrichten gehen mit; Ältere bleiben gespeichert", async () => {
  const history: Row[] = [
    { id: 1, chat_id: 111, role: "user", content: "ALT vor 13 Stunden", created_at: minutesAgo(13 * 60) },
    { id: 2, chat_id: 111, role: "assistant", content: "ALT Antwort", created_at: minutesAgo(13 * 60) },
    ...Array.from({ length: 30 }, (_, i) => ({ id: 10 + i, chat_id: 111, role: i % 2 ? "assistant" : "user", content: `N${i}`, created_at: minutesAgo(60 - i) })),
    { id: 99, chat_id: 222, role: "user", content: "ANDERER CHAT", created_at: minutesAgo(1) },
  ];
  reset([], history);
  script = (b) => text("Gern geschehen!", b.model);
  await say("danke dir");
  const messages = requests[0].messages.map((m) => String(m.content));
  assert.equal(HISTORY_LIMIT, 20);
  assert.ok(!messages.some((m) => m.startsWith("ALT") || m === "ANDERER CHAT"));
  assert.ok(!messages.includes("N9"), "nur die neuesten 20");
  assert.equal(messages.at(-1), "danke dir");
  // N10 ist eine Nutzernachricht → die 20 neuesten (N10–N29) gehen mit, plus die neue.
  assert.deepEqual(messages.slice(0, 2), ["N10", "N11"]);
  assert.equal(messages.length, 21);
  assert.deepEqual(sent(), ["Gern geschehen!"]);
  // Nichts gelöscht: ältere Nachrichten bleiben, die neuen kommen dazu.
  assert.equal(net.tables.telegram_chat_messages.filter((m) => m.chat_id === 111).length, 32 + 2);
});

test("Zeitgrenze 10 Minuten: Rückfragen, Chat-Vorschläge und Blättern im Menü", async () => {
  assert.equal(PENDING_TTL_MINUTES, 10);
  assert.equal(EXPIRED_ERROR, "abgelaufen: 10 Min. ohne Antwort");
  reset([openJob(9, "quantity")]);
  assert.equal((await expireStale(db, 111)).length, 0, "9 Minuten: noch offen");
  net.tables.ingest_jobs.find((j) => j.id === JOB)!.updated_at = minutesAgo(11);
  assert.equal((await expireStale(db, 111)).length, 1);
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === JOB)!.error, EXPIRED_ERROR);
  assert.equal(sent().at(-1), "Den angefangenen Pintia 2017 lasse ich mal beiseite.");

  // Knöpfe: gemessen ab dem letzten Senden bzw. Bearbeiten der Nachricht.
  const now = Date.now();
  const s = (min: number) => Math.floor((now - min * 60_000) / 1000);
  assert.equal(staleMessage({ date: s(11) }, now), true);
  assert.equal(staleMessage({ date: s(30), edit_date: s(3) }, now), false, "Menü weitergeblättert");
  assert.equal(staleMessage({ date: 0 }, now), false);

  reset();
  await handleUpdate({
    update_id: 1,
    callback_query: {
      id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: encodeMenu({ op: "list", list: { kind: "stock" }, offset: 0 }),
      message: { message_id: 9, chat: { id: 111, type: "private" }, date: s(12), text: "Bestand" },
    },
  } as never);
  const edited = net.telegram.find((t) => t.method === "editMessageText");
  assert.equal(edited?.body.text, T.menuExpired);
});
