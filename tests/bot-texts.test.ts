// Antoines Sprache: alle Texte zentral (src/lib/bot/texts.ts), keine technischen Meldungen,
// Varianten für häufige Meldungen; Ort-Regel („Restaurant“ allein ist kein Ort – App und Bot);
// App: Wein löschen ohne Namenseingabe. Supabase, Telegram, Claude per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { claudeText, installNet, type Net } from "./stub-net";
import { T, VARIANTS, allBotTexts, pick, say } from "@/lib/bot/texts";
import { genericPlaceKind, placeFromText } from "@/lib/edit/places";
import { applyEdit } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import { DELETE_FOREVER } from "@/lib/edit/delete-text";
import { handleUpdate } from "@/lib/ingest/bot";
import { TASTED_SOURCE, processTastedText } from "@/lib/chat/tasted";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { createAdminClient } from "@/lib/supabase/admin";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const PINTIA = "11111111-1111-4111-8111-111111111111";
let tastedReply: Record<string, unknown> = {};
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => claudeText(tastedReply), storage: new Map() };
installNet(net);
const db = createAdminClient();

function reset() {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [{ id: PINTIA, name: "Pintia", producer: "Vega Sicilia", type: "red", want_to_buy: false, grapes: [] }],
    places: [], wine_encounters: [], wine_ratings: [], wine_tastings: [], inventory_items: [], wine_media: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION } }],
  };
  net.telegram.length = 0;
}
const sent = () => net.telegram.filter((t) => t.method === "sendMessage").map((m) => String(m.body.text));
const lastButtons = () =>
  ((net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = (text: string) => {
  const b = lastButtons().find((x) => x.text === text);
  assert.ok(b?.callback_data, `Knopf „${text}“ fehlt: ${lastButtons().map((x) => x.text).join(" | ")}`);
  return handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: b.callback_data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: Math.floor(Date.now() / 1000) } } } as never);
};
const say_ = (text: string) =>
  handleUpdate({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } } as never);

const TECHNICAL = [/erhalten –/, /zwischen 1 und 999/, /Haiku|Sonnet|Claude|\bAPI\b/, /Button/, /Zeichen\)/, /fehlgeschlagen/, /❌|⛔/, /ß/, /Telegram-ID ist [^<]*$/];

test("Keine technischen Texte: zentrales Modul und Quelltext der Bot-Module", () => {
  const texts = allBotTexts();
  assert.ok(texts.length > 60, `${texts.length} Texte`);
  for (const t of texts) {
    for (const bad of TECHNICAL.slice(0, -1)) assert.ok(!bad.test(t), `technisch: ${t}`);
  }
  // Frühere Meldungen kommen im Quelltext der Bot-Module nicht mehr vor.
  const dirs = ["src/lib/ingest", "src/lib/chat", "src/lib/bot"];
  const old = ["Foto erhalten", "Fotos erhalten", "zwischen 1 und 999", "Erkennung ist fehlgeschlagen –", "Ich komme gerade nicht an Claude", "Button oder", "(2–80 Zeichen)"];
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(`${dir}/${file}`, "utf8");
      for (const phrase of old) assert.ok(!source.includes(phrase), `${dir}/${file}: „${phrase}“`);
    }
  }
  // Beispiele aus der Vorgabe
  assert.equal(T.howManyRetry, "Wie viele Flaschen sind es?");
  assert.equal(T.error, "Da ist mir leider etwas schiefgegangen – ich habe nichts gespeichert. Versuchst du es nochmals?");
  assert.equal(T.laidAside({ kind: "wine", wine: "Pintia 2019" }), "Den angefangenen Pintia 2019 lasse ich mal beiseite.");
});

test("Varianten: Foto erhalten, gespeichert, fertig, abgebrochen – je 2–3, zufällig gewählt", () => {
  for (const key of ["photosReceived", "photoReceived", "saved", "done", "cancelled"] as const) {
    const v = VARIANTS[key];
    assert.ok(v.length >= 2 && v.length <= 3, key);
    assert.equal(new Set(v).size, v.length, `${key}: alle verschieden`);
  }
  assert.equal(pick(["a", "b", "c"], () => 0), "a");
  assert.equal(pick(["a", "b", "c"], () => 0.99), "c");
  assert.equal(say("done", () => 0.5), VARIANTS.done[1]);
  assert.equal(T.photosReceived(2, () => 0), "Danke für die Fotos – ich schaue kurz nach …");
  assert.equal(T.photosReceived(1, () => 0), "Danke für das Foto – ich schaue kurz nach …");
  // Über viele Aufrufe kommen verschiedene Varianten vor.
  assert.ok(new Set(Array.from({ length: 60 }, () => say("saved"))).size >= 2);
});

test("Ort-Regel: allgemeines Wort → kein Ort (nur die Art), echter Name → Ort", () => {
  for (const [text, kind] of [["Restaurant", "restaurant"], ["im Restaurant", "restaurant"], ["Bar", "bar"], ["in einer Weinbar", "bar"], ["zuhause bei Freunden", "privat"], ["Weingut", "weingut"], ["auf dem Weingut", "weingut"]] as const) {
    assert.equal(genericPlaceKind(text), kind, text);
    assert.deepEqual(placeFromText(text), { name: null, kind }, text);
  }
  for (const text of ["Kronenhalle", "Napa Grill", "Restaurant Kronenhalle", "Weingut Gantenbein"]) {
    assert.equal(genericPlaceKind(text), null, text);
    assert.equal(placeFromText(text).name, text);
  }
  assert.deepEqual(placeFromText("Restaurant Kronenhalle"), { name: "Restaurant Kronenhalle", kind: "restaurant" });
});

test("Ort-Regel in der App (gemeinsames Modul): „Restaurant“ legt keinen Ort an, „Kronenhalle“ schon", async () => {
  reset();
  const add = (place: string) =>
    applyEdit(db, { kind: "addEncounter", wine: { wineId: PINTIA }, year: 2019, set: { place: { name: place, kind: null, city: null } }, personId: MICHEL, source: "app", ratings: [] });
  const generic = await add("Restaurant");
  assert.ok(generic.ok, JSON.stringify(generic));
  assert.equal(net.tables.places.length, 0, "kein Ort „Restaurant“");
  assert.equal(net.tables.wine_encounters[0].place_id, null);
  const named = await add("Kronenhalle");
  assert.ok(named.ok);
  assert.deepEqual(net.tables.places.map((p) => p.name), ["Kronenhalle"]);
});

test("Ort-Regel im Bot: „im Restaurant“ → nur die Art, beim 📍 Ort gezielt nachfragen; Name → Ort", async () => {
  reset();
  tastedReply = {
    name: "Pintia", producer: null, vintage_year: 2019, type: null, country: null, region: null,
    tasting: { tasted_on: "", place: "im Restaurant", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 4, want_to_buy: false },
  };
  const JOB = "99999999-9999-4999-8999-999999999999";
  net.tables.ingest_jobs.push({ id: JOB, source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText(JOB, 111, "Heute im Restaurant den Pintia 2019 probiert, 4 Sterne");
  const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
  assert.equal((job().extracted as { placeKind?: string }).placeKind, "restaurant");
  assert.equal((job().extracted as { set: { place?: string } }).set.place, undefined, "kein Ort „Restaurant“");
  await press("✅ Ja, speichern");
  assert.equal(net.tables.places.length, 0);
  await press("📍 Ort");
  assert.match(sent().at(-1)!, /In welchem Restaurant wart ihr\?/);
  await say_("Restaurant"); // wieder nur das allgemeine Wort
  assert.equal(net.tables.places.length, 0);
  assert.match(sent().at(-1)!, /In welchem Restaurant wart ihr\?/);
  await say_("Kronenhalle");
  assert.deepEqual(net.tables.places.map((p) => [p.name, p.kind]), [["Kronenhalle", "restaurant"]]);
  assert.equal(net.tables.wine_encounters[0].place_id, net.tables.places[0].id);
});

test("App: Wein löschen ohne Namenseingabe – Übersicht bleibt, rote Warnung, „Endgültig löschen“", async () => {
  reset();
  net.rpc.delete_wine = (args) => {
    for (const [name, rows] of Object.entries(net.tables)) net.tables[name] = rows.filter((r) => (name === "wines" ? r.id : r.wine_id) !== args.p_wine_id);
    return [];
  };
  const form = new FormData();
  form.set("kind", "deleteWine");
  form.set("wineId", PINTIA);
  const edits = editsFromForm(form);
  assert.deepEqual(edits, [{ kind: "deleteWine", wineId: PINTIA }], "kein Name nötig");
  const result = await applyEdit(db, (edits as never[])[0]);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(net.tables.wines.length, 0);
  assert.equal(DELETE_FOREVER, "Alles wird endgültig gelöscht und lässt sich nicht wiederherstellen.");
  const ui = readFileSync("src/app/(cellar)/wein/[id]/delete-sections.tsx", "utf8");
  assert.ok(!ui.includes("confirmName") && !ui.includes("eintippen"), "keine Namenseingabe mehr");
  assert.ok(ui.includes("Endgültig löschen") && ui.includes("DELETE_FOREVER"));
});
