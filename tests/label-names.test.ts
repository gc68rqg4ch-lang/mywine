// Produzenten- und Weinnamen beim Einbuchen: Abgleich mit bestehenden Produzenten (ohne Zusätze
// wie Vineyards/Cellars), Produzent nicht im Weinnamen, Prüfschritt der Namen (Sonnet 5.5) mit
// Rückfrage bei Widerspruch – nachgestellt am Fall Louis Roederer 2018 (Erkennung las die
// Herkunftsangabe „Vignoble de la Rivière“ als Namen, die Quellen beschrieben den weissen Brut
// Vintage, das Etikett ist rosa). Claude, Telegram und Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { fakeDb } from "./fake-db";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import { callbackData } from "@/lib/ingest/messages";
import { normalizeProposal, RecognitionSchema, type IngestState } from "@/lib/ingest/schema";
import { tidyWineName } from "@/lib/ingest/wine-names";
import { decideNameCheck, NAME_CHECK_MAX_CONFIDENCE, colorsConflict, type NameCheckInput } from "@/lib/ingest/name-decision";
import { harmonizeWine } from "@/lib/producers/load";
import { matchProducer, producerKey, sameProducer, stripProducerFromName } from "@/lib/producers/match";
import { labelUrl, producerUrlsNote, researchTools } from "@/lib/ingest/recognize";
import { T } from "@/lib/bot/texts";

// ---------------------------------------------------------------------------
// A) Abgleich mit bestehenden Produzenten

test("A: Produzent gleich ohne Zusätze (Vineyards, Cellars, Château, Champagne …) – gespeicherte Schreibweise gilt", async () => {
  assert.ok(sameProducer("DAOU", "Daou Vineyards"));
  assert.ok(sameProducer("Orin Swift", "Orin Swift Cellars"));
  assert.ok(sameProducer("Daou Family Estates", "DAOU"));
  assert.ok(sameProducer("Champagne Louis Roederer", "Louis Roederer"));
  assert.ok(sameProducer("Château Musar", "Musar"));
  assert.ok(sameProducer("Bodegas Vega Sicilia", "Vega Sicilia"));
  assert.ok(sameProducer("Weingut Gantenbein", "Gantenbein"));
  assert.ok(sameProducer("Ridge Vineyards", "Ridge Wine Company"));
  assert.ok(sameProducer("Éstate", "Estate"), "nur Zusatz: bleibt der ganze Name");
  assert.ok(!sameProducer("Vega", "Vega Sicilia"));
  assert.ok(!sameProducer("Domaine Leflaive", "Domaine Leroy"));
  assert.equal(producerKey("Daou Vineyards"), "daou");
  assert.equal(producerKey("Daou Vineyards", { keepAdditions: true }), "daouvineyards");

  // Beispiele aus dem Bestand (nach der Korrektur in der DB)
  const existing = ["DAOU Vineyards", "DAOU Vineyards", "Orin Swift Cellars", "Louis Roederer"];
  assert.deepEqual(matchProducer("DAOU", existing), { kind: "same", producer: "DAOU Vineyards" });
  assert.deepEqual(matchProducer("Daou", existing), { kind: "same", producer: "DAOU Vineyards" });
  assert.deepEqual(matchProducer("Orin Swift", existing), { kind: "same", producer: "Orin Swift Cellars" });
  assert.deepEqual(matchProducer("Champagne Louis Roederer", existing), { kind: "same", producer: "Louis Roederer" });

  // Mit der DB: Produzent einheitlich und nicht im Namen
  const db = fakeDb({ wines: existing.map((producer, i) => ({ id: `w${i}`, name: `Wein ${i}`, producer })) });
  // fakeDb kennt „not“ (not.is.null) nicht: hier ohne Wirkung.
  const wrapped = {
    from: (t: string) => {
      const b = db.from(t) as Record<string, unknown>;
      b.not = () => b;
      return b;
    },
  };
  assert.deepEqual(await harmonizeWine(wrapped as never, { name: "DAOU Reserve Cabernet Sauvignon", producer: "Daou", type: "red" }), {
    name: "Reserve Cabernet Sauvignon",
    producer: "DAOU Vineyards",
    type: "red",
  });
  assert.deepEqual(await harmonizeWine(wrapped as never, { name: "Orin Swift Abstract", producer: "Orin Swift", type: "red" }), {
    name: "Abstract",
    producer: "Orin Swift Cellars",
    type: "red",
  });
});

// ---------------------------------------------------------------------------
// B) Produzent nicht im Weinnamen

test("B: Produzent bzw. Variante vorne im Weinnamen fällt weg; bleibt nichts bzw. nur eine Stufe: unverändert", () => {
  assert.equal(stripProducerFromName("DAOU Reserve Cabernet Sauvignon", "DAOU Vineyards"), "Reserve Cabernet Sauvignon");
  assert.equal(stripProducerFromName("Daou Vineyards Reserve Cabernet Sauvignon", "DAOU"), "Reserve Cabernet Sauvignon");
  assert.equal(stripProducerFromName("Orin Swift Abstract", "Orin Swift Cellars"), "Abstract");
  assert.equal(stripProducerFromName("Louis Roederer Rosé Vintage", "Champagne Louis Roederer"), "Rosé Vintage");
  assert.equal(stripProducerFromName("DAOU - Reserve", "DAOU"), "Reserve");
  assert.equal(stripProducerFromName("Daou", "DAOU Vineyards"), "Daou", "nichts übrig: unverändert");
  assert.equal(stripProducerFromName("La Dominique", "Château La Dominique"), "La Dominique");
  assert.equal(stripProducerFromName("Margaux du Château Margaux", "Château Margaux"), "Margaux du Château Margaux");
  assert.equal(stripProducerFromName("Pintia", "Vega Sicilia"), "Pintia");
  assert.equal(stripProducerFromName("Daouville Red", "DAOU"), "Daouville Red", "nur ganze Wörter");
  // Nur Stufe übrig: Marke bleibt davor (wie die bestehenden Weine „Legaris Reserva“).
  assert.equal(tidyWineName("Legaris Reserva", "Legaris", "red"), "Legaris Reserva");
  // Spirituosen: Marke gehört zum Namen
  assert.equal(tidyWineName("Hennessy Very Special", "Hennessy", "spirit"), "Hennessy Very Special");
  // Erkennung: schon beim Normalisieren
  const p = normalizeProposal({ name: "DAOU Reserve Cabernet Sauvignon", producer: "DAOU", vintage_year: 2021, country: null, region: null, appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: null });
  assert.equal(p.name, "Reserve Cabernet Sauvignon");
});

// ---------------------------------------------------------------------------
// C/D) Erkennung: Farbe, Herkunftsangabe, Adresse des Produzenten; Herstellerseite gezielt abrufen

test("C/D: Schema mit Farbe, Herkunftsangabe und Adressen; Herstellerseite per web_fetch", () => {
  const parsed = RecognitionSchema.pick({ wine_color: true, label_note: true, producer_urls: true }).parse({});
  assert.deepEqual(parsed, { wine_color: "unclear", label_note: "", producer_urls: [] }, "fehlt etwas: unbekannt statt Fehler");
  assert.equal(labelUrl("www.louis-roederer.com"), "https://www.louis-roederer.com/");
  assert.equal(labelUrl("https://app.louis-roederer.com/QR/01/06/-/2018/C/"), "https://app.louis-roederer.com/QR/01/06/-/2018/C/");
  assert.equal(labelUrl("Vignoble de la Rivière"), null);
  assert.match(producerUrlsNote(["https://www.louis-roederer.com/"]), /zuerst mit web_fetch/);
  const tools = researchTools({ toolName: "x", toolDescription: "x", inputSchema: { type: "object" }, maxSearches: 3, fetchUrls: ["https://www.louis-roederer.com/"] });
  const fetch = tools.find((t) => "name" in t && t.name === "web_fetch") as { allowed_domains?: string[] } | undefined;
  assert.deepEqual(fetch?.allowed_domains, ["louis-roederer.com"]);
});

// ---------------------------------------------------------------------------
// E/F) Prüfschritt: Auswertung (rein)

const roederer: NameCheckInput = {
  proposal: { name: "Vignoble de la Rivière", producer: "Louis Roederer", vintage_year: 2018, type: "sparkling", grape_shares: [{ grape: "Pinot Noir", percent: null }, { grape: "Chardonnay", percent: null }] },
  color: "rose",
  labelNote: null,
  described: { name: "Brut Vintage", color: "white", official: "https://app.louis-roederer.com/QR/01/06/-/2018/C/" },
  sources: ["https://app.louis-roederer.com/QR/01/06/-/2018/C/", "https://www.callmewine.com/en/champagne-brut-vintage-louis-roederer-2018-P64865.htm"],
};

test("E/F: Widerspruch bzw. Korrektur → Varianten zur Auswahl, confidence höchstens 0.7; sonst keine Frage", () => {
  const corrected = decideNameCheck(roederer, { verdict: "conflict", name: "Rosé Vintage", producer: "Louis Roederer", color: "rose", reason: "Rosa Etikett; die Quellen beschreiben den weissen Brut Vintage." });
  assert.ok(corrected.ask);
  assert.deepEqual(corrected.variants.map((v) => v.name), ["Vignoble de la Rivière", "Rosé Vintage", "Brut Vintage"]);
  assert.equal(corrected.maxConfidence, NAME_CHECK_MAX_CONFIDENCE);
  assert.ok(NAME_CHECK_MAX_CONFIDENCE <= 0.7);

  // Ohne Ergebnis des Prüfschritts: Farbe Foto ↔ Quellen widerspricht sich trotzdem → fragen.
  const colorOnly = decideNameCheck(roederer, null);
  assert.ok(colorOnly.ask);
  assert.equal(colorOnly.reason, T.nameCheckColor("rosa", "Weisswein"));
  assert.ok(colorsConflict("rose", "white") && !colorsConflict("rose", "unclear") && !colorsConflict("red", "red"));

  // Stimmt alles: keine zusätzliche Frage.
  const fine: NameCheckInput = { ...roederer, proposal: { ...roederer.proposal, name: "Rosé Vintage" }, described: { name: "Rosé Vintage", color: "rose", official: null } };
  assert.deepEqual(decideNameCheck(fine, { verdict: "ok", name: "Rosé Vintage", producer: "Louis Roederer", color: "rose", reason: "" }), { ask: false });
  assert.deepEqual(decideNameCheck(fine, null), { ask: false });
  // „ok“ mit gleicher Schreibweise (Gross/Klein, Akzente): keine Frage.
  assert.deepEqual(decideNameCheck(fine, { verdict: "correct", name: "ROSE VINTAGE", producer: "Louis Roederer", color: "rose", reason: "" }), { ask: false });
});

// ---------------------------------------------------------------------------
// Bot: Roederer-Fall durch Erkennung, Recherche und Prüfschritt (Fotos eines Albums)

const JOB = jobIdFor(111, "roederer");
let check: Record<string, unknown> = {};
let recognitionName = "Vignoble de la Rivière";
const calls: string[] = [];

const net: Net = {
  tables: {},
  telegram: [],
  rpc: { replace_grape_shares: () => [] },
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if (tools.includes("report_wine_details")) {
      calls.push("research");
      return claudeTool("report_wine_details", {
        producer: null, country: "Frankreich", region: "Champagne", appellation: "Champagne", type: null, alcohol_content: 12.5,
        vintages: [{ vintage_year: 2018, drink_from_year: 2024, drink_until_year: 2035, grapes: [{ grape: "Pinot Noir", percent: null }, { grape: "Chardonnay", percent: null }], percentages_for_vintage: false }],
        sources: ["https://www.callmewine.com/en/champagne-brut-vintage-louis-roederer-2018-P64865.htm"],
        wine_name: "Brut Vintage", wine_color: "white", official_source: "https://app.louis-roederer.com/QR/01/06/-/2018/C/",
      });
    }
    if (body.model === "claude-sonnet-5-5" && (body.output_config as { format?: unknown } | undefined)?.format) {
      calls.push("check");
      return claudeText(check);
    }
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      calls.push("recognize");
      return claudeText({
        name: recognitionName, producer: "Champagne Louis Roederer", vintage_year: 2018, country: "Frankreich", region: "Champagne", appellation: "Champagne", type: "sparkling",
        grape_shares: [{ grape: "Pinot Noir", percent: null }, { grape: "Chardonnay", percent: null }], alcohol_content: 12.5, bottle_size_ml: 750,
        confidence: 0.95, uncertain_notes: null, vintage_certain: true, image_sides: ["front", "back"],
        wine_color: "rose", label_note: "", producer_urls: [],
      });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${JSON.stringify(tools)}`);
  },
  storage: new Map(),
};
installNet(net);

const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage");
const lastText = () => String(sent().at(-1)?.body.text ?? "").replace(/ /g, " ");
const lastButtons = () => ((sent().at(-1)?.body.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const cb = (data: string) => ({
  update_id: 2,
  callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0 } },
});
const say = (text: string) => ({ update_id: 3, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text } });

async function album() {
  net.tables = {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    // Gleicher Produzent, andere Art (kein „Meinst du …?“): nur für die Schreibweise.
    wines: [{ id: "w-roederer", name: "Carte Blanche Demi-Sec Rosé", producer: "Louis Roederer", type: "rose" }],
    inventory_items: [], ingest_jobs: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], spirit_categories: [],
  };
  net.telegram.length = 0;
  calls.length = 0;
  net.storage = new Map();
  net.tables.ingest_jobs.push({ id: JOB, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], extracted: { step: "received", caption: "gekauft" }, updated_at: new Date(Date.now() - 60_000).toISOString() });
  const rose = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#f2b8c6" } }).jpeg().toBuffer();
  net.storage.set(`wine-photos/${photoFolder(JOB)}/1537.jpg`, { bytes: rose, type: "image/jpeg" });
  net.storage.set(`wine-photos/${photoFolder(JOB)}/1538.jpg`, { bytes: rose, type: "image/jpeg" });
  await processJob(JOB, 111);
}

test("Roederer: Prüfschritt korrigiert «Vignoble de la Rivière» → Antoine fragt mit beiden Varianten; Wahl gilt", async () => {
  recognitionName = "Vignoble de la Rivière";
  check = { verdict: "conflict", name: "Rosé Vintage", producer: "Louis Roederer", color: "rose", reason: "Rosa Etikett, die Quellen beschreiben den weissen Brut Vintage." };
  await album();
  assert.deepEqual(calls, ["recognize", "research", "check"], "genau ein zusätzlicher Aufruf");
  assert.equal(state().step, "name_check");
  assert.equal(state().proposal.producer, "Louis Roederer", "gespeicherte Schreibweise (ohne „Champagne“)");
  assert.ok(state().recognition.confidence <= 0.7, "confidence höchstens 0.7");
  assert.ok((job().confidence as number) <= 0.7);
  assert.match(lastText(), /Beim Namen bin ich nicht sicher: Rosa Etikett, die Quellen beschreiben den weissen Brut Vintage\./);
  assert.deepEqual(lastButtons().map((b) => b.text), ["«Vignoble de la Rivière»", "«Rosé Vintage»", "«Brut Vintage»", T.nameCheckSelf, "✖️ Abbrechen"]);
  assert.equal(net.tables.inventory_items.length, 0, "nichts gespeichert");

  await handleUpdate(cb(lastButtons()[1].callback_data!) as never);
  assert.equal(state().step, "review");
  assert.equal(state().proposal.name, "Rosé Vintage");
  assert.equal(state().name_check, undefined);
  assert.match(lastText(), /Louis Roederer<\/b>\nRosé Vintage 2018/);
  assert.deepEqual(lastButtons().map((b) => b.text), ["💾 Speichern", "✏️ Korrigieren", "🗑️ Verwerfen"]);
});

test("Roederer: ✏️ Selbst eingeben → getippter Name gilt", async () => {
  check = { verdict: "correct", name: "Rosé Vintage", producer: "Louis Roederer", color: "rose", reason: "Die Herkunftsangabe ist kein Name." };
  await album();
  await handleUpdate(cb(callbackData("nameself", JOB)) as never);
  assert.equal(state().step, "name_input");
  assert.equal(lastText(), T.nameCheckType);
  await handleUpdate(say("Louis Roederer Rosé Vintage") as never);
  assert.equal(state().step, "review");
  assert.equal(state().proposal.name, "Rosé Vintage", "Produzent vorne im getippten Namen fällt weg");
});

test("Ohne Widerspruch: Einbuchen wie bisher ohne zusätzliche Frage", async () => {
  recognitionName = "Rosé Vintage";
  check = { verdict: "ok", name: "Rosé Vintage", producer: "Louis Roederer", color: "rose", reason: "" };
  const research = net.claude;
  // Quellen beschreiben denselben Wein (Rosé)
  net.claude = (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
    if (tools.includes("report_wine_details")) {
      const answer = research(body) as { content: { input: Record<string, unknown> }[] };
      const block = answer.content.find((c) => c.input)!;
      block.input = { ...block.input, wine_name: "Rosé Vintage", wine_color: "rose" };
      return answer;
    }
    return research(body);
  };
  try {
    await album();
  } finally {
    net.claude = research;
  }
  assert.equal(state().step, "review");
  assert.equal(state().proposal.name, "Rosé Vintage");
  assert.equal(state().recognition.confidence, 0.95);
  assert.deepEqual(lastButtons().map((b) => b.text), ["💾 Speichern", "✏️ Korrigieren", "🗑️ Verwerfen"]);
});

// ---------------------------------------------------------------------------
// G) Prüfung des Bestands (nur lesend)

test("G: Prüfskript listet Schreibweisen, Produzent im Namen, Herkunftsangaben – ändert nichts", async () => {
  const { nameAudit, auditText } = await import("@/lib/producers/audit");
  const wines = [
    { id: "1", name: "Pessimist", producer: "DAOU", type: "red" },
    { id: "2", name: "DAOU Reserve Cabernet Sauvignon", producer: "Daou Vineyards", type: "red" },
    { id: "3", name: "Vignoble de la Rivière", producer: "Louis Roederer", type: "sparkling" },
    { id: "4", name: "Legaris Reserva", producer: "Legaris", type: "red" },
    { id: "5", name: "Hennessy Very Special", producer: "Hennessy", type: "spirit" },
  ];
  const before = JSON.stringify(wines);
  const r = nameAudit(wines);
  assert.deepEqual(r.producerGroups, [[{ spelling: "DAOU", count: 1 }, { spelling: "Daou Vineyards", count: 1 }]]);
  assert.deepEqual(r.producerInName.map((w) => [w.name, w.suggestion]), [["DAOU Reserve Cabernet Sauvignon", "Reserve Cabernet Sauvignon"]]);
  assert.deepEqual(r.originLike.map((w) => [w.name, w.word]), [["Vignoble de la Rivière", "vignoble"]]);
  assert.equal(JSON.stringify(wines), before, "nur lesend");
  assert.match(auditText(r), /«DAOU» \(1\) = «Daou Vineyards» \(1\)/);
});
