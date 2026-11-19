// Bot Antoine: gleicher Wein unter anderem Namen („Saint-Émilion Grand Cru“ statt „La Dominique“,
// gleicher Produzent, gleiche Art) → Rückfrage „Ist das «La Dominique» (Château La Dominique)?
// Sonst lege ich «…» neu an.“ statt still ein neuer Wein. Text, Foto und „Nur verkostet“.
// Claude, Telegram und Supabase per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { nameCore, relatedWines, sameProducerWines } from "@/lib/ingest/wine-names";
import { normalizeProposal, type IngestState } from "@/lib/ingest/schema";
import { continuePhotoPurchase, processTextJob, saveJob } from "@/lib/ingest/flow";
import { ESTATE_NAME_RULE } from "@/lib/ingest/recognize";
import { handleUpdate } from "@/lib/ingest/bot";
import { TASTED_SOURCE, processTastedText } from "@/lib/chat/tasted";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { runLater } from "@/lib/later";
import { createAdminClient } from "@/lib/supabase/admin";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const DOM = "33333333-3333-4333-8333-333333333333";
const JOB = "aaaaaaaa-0000-4000-8000-00000000000b";
const AOC = "Saint-Émilion Grand Cru";

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

const wine = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, producer: "Château La Dominique", type: "red", country: "Frankreich", region: "Bordeaux", appellation: AOC, alcohol_content: 14, grapes: [], want_to_buy: false, ...extra,
});
function reset(wines = [wine(DOM, "La Dominique")]) {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines,
    inventory_items: [{ id: "i1", wine_id: DOM, vintage_year: 2018, status: "sealed", quantity: 1 }],
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
async function textIngest(w: Record<string, unknown>) {
  parseResult = {
    name: null, producer: null, vintage_year: 2019, country: null, region: null, appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750, ...w,
    purchase: { quantity: 6, storage_room: "Weinkeller", price: 60, regular_price: 70, vendor: "Coop", gift: false, gift_from: "" },
  };
  net.tables.ingest_jobs.push({ id: JOB, source: "text", telegram_chat_id: 111, status: "processing", extracted: { step: "researching", source: "text" }, photo_paths: [], updated_at: new Date().toISOString() });
  await processTextJob(JOB, 111, "6 Flaschen Saint-Émilion Grand Cru 2019");
}
const ASK = /Ist das <b>«La Dominique» \(Château La Dominique\)<\/b>\? Sonst lege ich «Saint-Émilion Grand Cru» neu an\./;

test("Regel: gleicher Produzent (nach Normalisierung) und gleiche Art; gleiche Appellation zuerst, höchstens 3", () => {
  const wines = [
    wine("a", "Zeta", { appellation: "Bordeaux" }),
    wine("b", "Alpha", { appellation: "Bordeaux" }),
    wine("c", "La Dominique"),
    wine("d", "Beta", { appellation: "Bordeaux Supérieur" }),
    wine("w", "Blanc", { type: "white" }),
    wine("o", "Figeac", { producer: "Château Figeac" }),
  ];
  assert.deepEqual(sameProducerWines("Chateau la Dominique", "red", "Saint-Emilion Grand Cru", wines).map((w) => w.id), ["c", "b", "d"]);
  assert.deepEqual(sameProducerWines("Château La Dominique", "white", null, wines).map((w) => w.id), ["w"]);
  assert.deepEqual(sameProducerWines("Château Cheval Blanc", "red", AOC, wines), [], "anderer Produzent");
  assert.deepEqual(sameProducerWines("Château La Dominique", null, AOC, wines), [], "ohne Art keine");
  assert.deepEqual(sameProducerWines(null, "red", AOC, wines), [], "ohne Produzent keine");
});

test("Prompt: Gutsname als Weinname, Appellation und Klassifikation nie in name", () => {
  assert.match(ESTATE_NAME_RULE, /„La Dominique“, Produzent „Château La Dominique“/);
  assert.match(ESTATE_NAME_RULE, /Grand Cru Classé, Cru Bourgeois/);
  assert.match(ESTATE_NAME_RULE, /nur, wenn der Wein weder einen eigenen Namen noch den Gutsnamen/);
});

test("Text: „Saint-Émilion Grand Cru“ von Château La Dominique → Rückfrage; Wahl bucht auf «La Dominique»", async () => {
  reset();
  await textIngest({ name: AOC, producer: "Château La Dominique", appellation: AOC });
  assert.equal(state().step, "similar");
  assert.deepEqual(state().similar_ids, [DOM]);
  assert.match(sent().at(-1)!, ASK);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ La Dominique", "➕ Neuer Wein", "✖️ Abbrechen"]);
  await press("✅ La Dominique");
  assert.equal(job().matched_wine_id, DOM);
  assert.deepEqual([state().proposal.name, state().proposal.producer, state().restock], ["La Dominique", "Château La Dominique", false], "2019 nicht im Bestand: kein Nachkauf");
  assert.equal(state().step, "confirm", JSON.stringify(state()));
  await press("✅ Ja");
  await runLater();
  assert.equal(net.tables.wines.length, 1, "kein neuer Wein");
  assert.deepEqual(net.tables.inventory_items.map((i) => [i.wine_id, i.vintage_year]), [[DOM, 2018], [DOM, 2019]]);
});

test("Text: Jahrgang schon im Bestand → nach der Wahl als Nachkauf", async () => {
  reset();
  await textIngest({ name: AOC, producer: "Château La Dominique", vintage_year: 2018 });
  await press("✅ La Dominique");
  assert.equal(state().restock, true);
});

test("Text: Produzent nur nach Normalisierung gleich („Chateau la Dominique“) → ebenfalls Kandidat; „Neuer Wein“ mit vorhandener Schreibweise", async () => {
  reset();
  await textIngest({ name: AOC, producer: "Chateau la Dominique" });
  assert.equal(state().step, "similar");
  assert.match(sent().at(-1)!, ASK);
  await press("➕ Neuer Wein");
  assert.equal(state().new_wine, true);
  assert.equal(job().matched_wine_id, null);
  assert.equal(state().proposal.producer, "Château La Dominique", "Produzent in vorhandener Schreibweise");
  await press("✅ Ja");
  await runLater();
  assert.equal(net.tables.wines.length, 2);
  assert.deepEqual([net.tables.wines.at(-1)!.name, net.tables.wines.at(-1)!.producer], [AOC, "Château La Dominique"]);
});

test("Keine Rückfrage: anderer Produzent, gleicher Produzent mit anderer Art, exakter Treffer", async () => {
  reset();
  await textIngest({ name: AOC, producer: "Château Figeac" });
  assert.notEqual(state().step, "similar");
  assert.ok(!sent().some((t) => /Ist das|[Mm]einst du/.test(t)), sent().join("\n---\n"));

  reset();
  await textIngest({ name: "Blanc", producer: "Château La Dominique", type: "white" });
  assert.notEqual(state().step, "similar");
  assert.ok(!sent().some((t) => /Ist das|[Mm]einst du/.test(t)));

  reset();
  await textIngest({ name: "La Dominique", producer: "Château La Dominique", vintage_year: 2018 });
  assert.equal(state().step, "restock", "exakter Treffer: wie bisher Nachkauf-Frage");
  assert.equal(job().matched_wine_id, DOM);
  assert.ok(!sent().some((t) => /Ist das|[Mm]einst du/.test(t)));
});

test("Foto: mehr als 3 Weine des Produzenten → höchstens 3, gleiche Appellation zuerst; Wahl → Vorschlag zum bestehenden Wein", async () => {
  reset([
    wine("w1", "Alpha", { appellation: "Bordeaux" }),
    wine("w2", "Beta", { appellation: "Bordeaux" }),
    wine("w3", "Gamma", { appellation: "Bordeaux" }),
    wine(DOM, "La Dominique"),
  ]);
  net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "processing", extracted: { step: "received" }, photo_paths: [], updated_at: new Date().toISOString() });
  const proposal = normalizeProposal({ name: AOC, producer: "Château La Dominique", vintage_year: 2020, country: "Frankreich", region: null, appellation: AOC, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750 });
  await continuePhotoPurchase(createAdminClient(), JOB, 111, { proposal, model: "x", confidence: 0.9, notes: null, imageSides: null, vintageCertain: true });
  assert.equal(state().step, "similar");
  assert.deepEqual(state().similar_ids, [DOM, "w1", "w2"]);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ La Dominique", "✅ Alpha", "✅ Beta", "➕ Neuer Wein", "✖️ Abbrechen"]);
  assert.match(sent().at(-1)!, /^Ist das <b>«La Dominique» \(Château La Dominique\)<\/b> bzw\. <b>«Alpha»/);
  await press("✅ La Dominique");
  assert.equal(state().step, "review");
  assert.equal(job().matched_wine_id, DOM);
  assert.equal(state().proposal.name, "La Dominique");
  job().extracted = { ...state(), step: "saving", storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null };
  await saveJob(job() as never, 111);
  assert.equal(net.tables.wines.length, 4);
  assert.equal(net.tables.inventory_items.at(-1)!.wine_id, DOM);
});

test("Nur verkostet: gleicher Produzent, anderer Name → Rückfrage; Wahl hängt den Eintrag an den bestehenden Wein", async () => {
  reset();
  parseResult = {
    name: AOC, producer: "Château La Dominique", vintage_year: 2019, type: "red", country: null, region: null,
    tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 4, want_to_buy: false },
  };
  const T_JOB = "99999999-9999-4999-8999-99999999999b";
  net.tables.ingest_jobs.push({ id: T_JOB, source: TASTED_SOURCE, telegram_chat_id: 111, status: "processing", photo_paths: [], updated_at: new Date().toISOString(), extracted: { flow: "tasted", step: "t_reading", origin: "text", proposal: {}, personId: MICHEL, personName: "Michel", set: {} } });
  await processTastedText(T_JOB, 111, "Gestern einen Saint-Émilion Grand Cru von Château La Dominique probiert, 4 Sterne");
  assert.match(sent().at(-1)!, ASK);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ La Dominique", "➕ Neuer Wein", "✖️ Abbrechen"]);
  await press("✅ La Dominique");
  await press("✅ Ja, speichern");
  assert.equal(net.tables.wines.length, 1, "kein neuer Wein");
  assert.equal(net.tables.wine_encounters[0]?.wine_id, DOM);
});

// --- Name ↔ Produzent: Gutsname einmal als Name, einmal als Produzent (Besitzerfirma als Produzent)

const PG = "44444444-4444-4444-8444-444444444444";
const petit = (extra: Record<string, unknown> = {}) => ({
  id: PG, name: "Petit Gravet Aîné", producer: "Château Petit Gravet Aîné", type: "red", country: "Frankreich", region: "Bordeaux", appellation: AOC, alcohol_content: 14, grapes: [], want_to_buy: false, ...extra,
});

test("Regel Name ↔ Produzent: Kern ohne Füllwörter und Zusätze, beide Richtungen, nie Name gegen Name allein, gleiche Art", () => {
  assert.equal(nameCore("Château Petit Gravet Aîné"), "petit gravet aine");
  const stock = [petit()];
  assert.deepEqual(relatedWines({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", type: "red" }, stock).map((w) => w.id), [PG]);
  // umgekehrt: Bestand mit Gutsname im Namen, Vorschlag mit Gutsname als Produzent
  const reverse = [petit({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel" })];
  assert.deepEqual(relatedWines({ name: "Petit Gravet Aîné", producer: "Château Petit Gravet Aîné", type: "red" }, reverse).map((w) => w.id), [PG]);
  // gleicher Name, anderer Produzent: kein Kandidat
  const chard = [{ id: "r", name: "Chardonnay", producer: "Rombauer", type: "white", appellation: null }];
  assert.deepEqual(relatedWines({ name: "Chardonnay", producer: "Cuvaison", type: "white" }, chard), []);
  // andere Art bzw. ohne Art: keiner
  assert.deepEqual(relatedWines({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", type: "white" }, stock), []);
  assert.deepEqual(relatedWines({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", type: null }, stock), []);
  // über Produzent und über Name ↔ Produzent beim selben Wein → nur einmal
  const both = [petit({ name: "Château Petit Gravet Aîné", producer: "Château Petit Gravet Aîné" })];
  assert.deepEqual(relatedWines({ name: "Petit Gravet Aîné", producer: "Château Petit Gravet Aîné", type: "red" }, both).map((w) => w.id), [PG]);
  // beide Regeln zusammen: gleiche Appellation zuerst, dann alphabetisch, höchstens 3
  const mixed = [
    wine("a", "Alpha", { producer: "Vignobles J.J. Nouvel", appellation: "Bordeaux" }),
    wine("b", "Beta", { producer: "Vignobles J.J. Nouvel", appellation: "Bordeaux" }),
    wine("c", "Gamma", { producer: "Vignobles J.J. Nouvel", appellation: "Bordeaux" }),
    petit(),
  ];
  assert.deepEqual(relatedWines({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", type: "red", appellation: AOC }, mixed).map((w) => w.id), [PG, "a", "b"]);
});

test("Text: «Château Petit Gravet Aîné» von Vignobles J.J. Nouvel → Rückfrage mit «Petit Gravet Aîné»; Wahl bucht auf den bestehenden Wein", async () => {
  reset([petit()]);
  await textIngest({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", vintage_year: 2016 });
  assert.equal(state().step, "similar");
  assert.deepEqual(state().similar_ids, [PG]);
  assert.match(sent().at(-1)!, /Ist das <b>«Petit Gravet Aîné» \(Château Petit Gravet Aîné\)<\/b>\? Sonst lege ich «Château Petit Gravet Aîné» neu an\./);
  assert.deepEqual(lastButtons().map((b) => b.text), ["✅ Petit Gravet Aîné", "➕ Neuer Wein", "✖️ Abbrechen"]);
  await press("✅ Petit Gravet Aîné");
  assert.equal(job().matched_wine_id, PG);
  assert.deepEqual([state().proposal.name, state().proposal.producer], ["Petit Gravet Aîné", "Château Petit Gravet Aîné"]);
  await press("✅ Ja");
  await runLater();
  assert.equal(net.tables.wines.length, 1, "kein neuer Wein");
  assert.equal(net.tables.inventory_items.at(-1)!.wine_id, PG);
});

test("Text: «Chardonnay» von Cuvaison neben «Chardonnay» von Rombauer → keine Rückfrage; andere Art → keine Rückfrage", async () => {
  reset([wine("r", "Chardonnay", { producer: "Rombauer", type: "white", appellation: null })]);
  await textIngest({ name: "Chardonnay", producer: "Cuvaison", type: "white" });
  assert.notEqual(state().step, "similar");
  assert.ok(!sent().some((t) => /Ist das|[Mm]einst du/.test(t)));

  reset([petit()]);
  await textIngest({ name: "Château Petit Gravet Aîné", producer: "Vignobles J.J. Nouvel", type: "white" });
  assert.notEqual(state().step, "similar");
  assert.ok(!sent().some((t) => /Ist das|[Mm]einst du/.test(t)));
});
