// Ablaufdatum (Mindesthaltbarkeit) vom Etikett ins Trinkfenster: Jahr → drink_until_year, Satz
// „Haltbar bis …“ in der Genauigkeit des Etiketts an die Notiz des Jahrgangs (nichts
// überschreiben), Anzeige in der Zusammenfassung (abgelaufen → Hinweis), auch NV.
// Claude, Telegram und Supabase per Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { appendNote, bestBeforeInText, bestBeforeSentence, formatBestBefore, isExpired, parseBestBefore } from "@/lib/ingest/best-before";
import { cleanBestBefore, applyCorrection } from "@/lib/ingest/recognize";
import { continuePhotoPurchase, processTextJob, saveJob } from "@/lib/ingest/flow";
import { normalizeProposal, type IngestState } from "@/lib/ingest/schema";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { createAdminClient } from "@/lib/supabase/admin";

const JOB = "aaaaaaaa-0000-4000-8000-00000000000a";
const W = "11111111-1111-4111-8111-111111111111";
let parseResult: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: { replace_grape_shares: () => [] }, storage: new Map(),
  claude: (body) => {
    const tools = (body.tools as { name?: string }[] | undefined)?.map((t) => t.name) ?? [];
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
installNet(net);
const db = createAdminClient();

const sparkling = { id: W, name: "Sparkling Rosé", producer: "ISH", type: "sparkling", country: "Dänemark", region: null, appellation: null, alcohol_content: 0, grapes: [], want_to_buy: false, notes: null };
function reset(source: "text" | "telegram", extra: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  net.tables = {
    persons: [{ id: "p1", name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], wine_taste_profiles: [],
    research_suggestions: [], telegram_chat_messages: [],
    ingest_jobs: [
      { id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION } },
      { id: JOB, source, telegram_chat_id: 111, status: "processing", extracted: { step: source === "text" ? "researching" : "received", ...(source === "text" ? { source: "text" } : {}) }, photo_paths: [], updated_at: new Date().toISOString() },
    ],
    ...extra,
  };
  net.telegram.length = 0;
}
const job = () => net.tables.ingest_jobs.find((j) => j.id === JOB)!;
const state = () => job().extracted as IngestState;
const lastText = () => String(net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.text ?? "");
const vintage = () => net.tables.wine_vintages[0];
const proposal = (year: number | null) =>
  normalizeProposal({ name: "Sparkling Rosé", producer: "ISH", vintage_year: year, country: "Dänemark", region: null, appellation: null, type: "sparkling", grape_shares: [], alcohol_content: 0, bottle_size_ml: 750 });
async function photo(bestBefore: string | null, year: number | null = 2024, caption?: string) {
  await continuePhotoPurchase(db, JOB, 111, { proposal: proposal(year), model: "x", confidence: 0.95, notes: null, imageSides: null, vintageCertain: true, bestBefore }, caption);
}
async function save() {
  job().extracted = { ...state(), step: "saving", vintage_confirmed: true, storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null };
  await saveJob(job() as never, 111);
}

test("Lesen: mit Tag und nur Monat/Jahr, verschiedene Schreibweisen und Sprachen", () => {
  const cases: [string, number, string][] = [
    ["Mindestens haltbar bis 09/2028", 2028, "Haltbar bis September 2028"],
    ["mindestens haltbar bis Ende: 10.2025", 2025, "Haltbar bis Oktober 2025"],
    ["Best before: SEP 2028", 2028, "Haltbar bis September 2028"],
    ["MHD 31.05.27", 2027, "Haltbar bis 31.05.27"],
    ["À consommer de préférence avant fin 03/2027", 2027, "Haltbar bis März 2027"],
    ["Consumir preferentemente antes de 31/12/2026", 2026, "Haltbar bis 31.12.26"],
    ["Da consumarsi preferibilmente entro 05/2029", 2029, "Haltbar bis Mai 2029"],
    ["zu verbrauchen bis 1. Juni 2027", 2027, "Haltbar bis 01.06.27"],
    ["best before end sept. 2028", 2028, "Haltbar bis September 2028"],
  ];
  for (const [text, year, sentence] of cases) {
    const bb = bestBeforeInText(text);
    assert.ok(bb, text);
    assert.equal(bb.year, year, text);
    assert.equal(bestBeforeSentence(bb), sentence, text);
  }
  // Aus der Erkennung (YYYY-MM bzw. YYYY-MM-DD)
  assert.equal(formatBestBefore(parseBestBefore("2028-09")!), "September 2028");
  assert.equal(formatBestBefore(parseBestBefore("2027-05-31")!), "31.05.27");
  assert.equal(cleanBestBefore("2028-9"), "2028-09");
  // Kein bzw. unleserliches Datum → nichts
  for (const bad of ["", "Pintia 2019, 6 Flaschen", "best before 2028", "haltbar bis 13/2028", "MHD 31.02.27", "Lot L2028-09"]) {
    assert.equal(bestBeforeInText(bad), null, bad);
  }
  for (const bad of ["", "2028", "unleserlich", "2027-02-30", "09/28"]) assert.equal(cleanBestBefore(bad), null, bad);
  assert.equal(bestBeforeInText("haltbar bis 09/2028, best before 10/2028"), null, "zwei verschiedene → unklar");
  // Abgelaufen: nur Monat → nach dem Monatsende
  assert.equal(isExpired(parseBestBefore("2025-10")!, "2025-10-31"), false);
  assert.equal(isExpired(parseBestBefore("2025-10")!, "2025-11-01"), true);
  assert.equal(appendNote("Kräftig", "Haltbar bis September 2028"), "Kräftig\nHaltbar bis September 2028");
  assert.equal(appendNote("Haltbar bis September 2028", "Haltbar bis September 2028"), "Haltbar bis September 2028", "nicht doppelt");
});

test("Foto: Ablaufdatum in der Zusammenfassung, beim Einbuchen Trinkfenster bis + Notiz", async () => {
  reset("telegram");
  await photo("2028-09");
  assert.deepEqual([state().best_before, state().drink_until_year, state().drink_from_year], ["2028-09", 2028, null]);
  assert.match(lastText(), /📆 Haltbar bis September 2028/);
  assert.doesNotMatch(lastText(), /abgelaufen/);
  await save();
  assert.deepEqual([vintage().vintage_year, vintage().drink_from_year, vintage().drink_until_year, vintage().notes], [2024, null, 2028, "Haltbar bis September 2028"]);
});

test("Datum in der Vergangenheit → „schon abgelaufen“ in der Zusammenfassung", async () => {
  reset("telegram");
  await photo("2025-10");
  assert.match(lastText(), /📆 Haltbar bis Oktober 2025 – <i>schon abgelaufen<\/i>/);
});

test("Kein bzw. unleserliches Datum → nichts gesetzt", async () => {
  reset("telegram");
  await photo(null);
  assert.equal(state().best_before, undefined);
  assert.equal(state().drink_until_year, null);
  assert.doesNotMatch(lastText(), /Haltbar/);
  await save();
  assert.equal(net.tables.wine_vintages.length, 0, "kein Trinkfenster, keine Notiz");
});

test("Bestehende Notiz bleibt, Satz wird angehängt; bestehendes Trinkfenster wird nicht überschrieben (Hinweis)", async () => {
  reset("telegram", {
    wines: [{ ...sparkling }],
    inventory_items: [{ id: "i0", wine_id: W, vintage_year: 2024, status: "sealed", quantity: 2 }],
    wine_vintages: [{ id: "v1", wine_id: W, vintage_year: 2024, drink_from_year: null, drink_until_year: 2030, notes: "Sehr fruchtig" }],
  });
  await photo("2028-09");
  assert.match(lastText(), /Bei dir steht die Trinkreife bis 2030 – die lasse ich so \(Etikett: haltbar bis September 2028\)/);
  await save();
  assert.deepEqual([vintage().drink_until_year, vintage().notes], [2030, "Sehr fruchtig\nHaltbar bis September 2028"]);
  assert.equal(net.tables.wine_vintages.length, 1);

  // „bis“ leer, aber „ab“ gesetzt und verträglich → „bis“ ergänzt, „ab“ bleibt
  reset("telegram", { wines: [{ ...sparkling }], wine_vintages: [{ id: "v1", wine_id: W, vintage_year: 2024, drink_from_year: 2025, drink_until_year: null, notes: null }] });
  await photo("2028-09");
  await save();
  assert.deepEqual([vintage().drink_from_year, vintage().drink_until_year, vintage().notes], [2025, 2028, "Haltbar bis September 2028"]);
});

test("NV-Wein: Trinkfenster und Notiz für „ohne Jahrgang“", async () => {
  reset("telegram");
  await photo("2027-05-31", null);
  await save();
  assert.deepEqual([vintage().vintage_year, vintage().drink_until_year, vintage().notes], [null, 2027, "Haltbar bis 31.05.27"]);
});

test("Text und Bildtext: „haltbar bis …“ wird übernommen", async () => {
  reset("text");
  parseResult = {
    name: "Low Calorie Selected Sparkling", producer: "Freixenet", vintage_year: null, country: null, region: null, appellation: null, type: "sparkling",
    grape_shares: [], alcohol_content: null, bottle_size_ml: null, best_before: "",
    purchase: { quantity: 2, storage_room: "Weinkeller", price: 9.9, regular_price: 0, vendor: "", gift: false, gift_from: "" },
  };
  await processTextJob(JOB, 111, "Freixenet Low Calorie Selected Sparkling, 2 Flaschen, Weinkeller, 9.90, mindestens haltbar bis 10/2025");
  assert.deepEqual([state().best_before, state().drink_until_year], ["2025-10", 2025]);
  assert.ok(net.telegram.some((t) => /📆 Haltbar bis Oktober 2025 – <i>schon abgelaufen<\/i>/.test(String(t.body.text))));
  // Bildtext
  reset("telegram");
  await photo(null, 2024, "haltbar bis SEP 2028");
  assert.equal(state().best_before, "2028-09");
});

test("✏️ Korrigieren ändert bzw. entfernt das Ablaufdatum", async () => {
  parseResult = { ...proposal(2024), best_before: "2029-03" };
  const corrected = await applyCorrection(proposal(2024), "haltbar bis März 2029", "2028-09");
  assert.equal(corrected.bestBefore, "2029-03");
  assert.equal("best_before" in corrected, false, "nicht im Vorschlag selbst");
  parseResult = { ...proposal(2024), best_before: "" };
  assert.equal((await applyCorrection(proposal(2024), "kein Ablaufdatum", "2028-09")).bestBefore, null);
});
