// Recherche pro Wein: Lücken im Bestand/alle und vollständiges Ergänzen in einem Durchgang,
// ohne Vorhandenes zu überschreiben. Claude und Supabase per fetch-Stub. Ausführen: npm test
import assert from "node:assert/strict";
import { claudeTool, installNet, type Net } from "./stub-net";

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  SUPABASE_SECRET_KEY: "stub",
  ANTHROPIC_API_KEY: "stub",
  TELEGRAM_BOT_TOKEN: "stub",
  TELEGRAM_WEBHOOK_SECRET: "stub",
  TELEGRAM_ALLOWED_USER_ID: "111",
});

const W = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const W3 = "33333333-3333-4333-8333-333333333333";
const W4 = "44444444-4444-4444-8444-444444444444";
const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const prompts: string[] = [];
let answer: Record<string, unknown> | null = null;
const net: Net = {
  tables: {
    wines: [
      { id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: null, grapes: [] },
      { id: W3, name: "Macan", producer: "Benjamin de Rothschild", country: "Spanien", region: "Rioja", appellation: "DOCa Rioja", type: "red", alcohol_content: null, grapes: ["Tempranillo"] },
      { id: W4, name: "Ohne Flaschen", producer: "X", country: null, region: null, appellation: null, type: null, alcohol_content: null, grapes: [] },
      { id: W2, name: "Alion", producer: "Vega Sicilia", country: "Spanien", region: "Ribera", appellation: "DO Ribera del Duero", type: "red", alcohol_content: 14.5, grapes: [] },
    ],
    inventory_items: [
      { wine_id: W, vintage_year: 2019, status: "sealed" },
      { wine_id: W, vintage_year: 2016, status: "drunk" },
      { wine_id: W2, vintage_year: 2018, status: "drunk" },
      { wine_id: W3, vintage_year: 2017, status: "sealed" },
    ],
    wine_vintages: [
      { id: "v1", wine_id: W, vintage_year: 2019, drink_from_year: 2025, drink_until_year: null },
      { id: "v2", wine_id: W2, vintage_year: 2018, drink_from_year: 2022, drink_until_year: 2035 },
    ],
    wine_grape_shares: [
      { wine_id: W, vintage_year: null, grape: "Tinta de Toro", percent: null, source: "import" },
      { wine_id: W2, vintage_year: 2018, grape: "Tempranillo", percent: 100, source: "research" },
    ],
    research_suggestions: [],
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: null }],
  },
  telegram: [],
  rpc: {},
  claude: (body) => {
    const prompt = String((body.messages as { content: string }[])[0].content);
    prompts.push(prompt);
    if (prompt.includes("Macan")) {
      // Ungültige Werte: werden verworfen statt gespeichert
      return claudeTool("report_wine_details", {
        producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: 40,
        vintages: [{ vintage_year: 2017, drink_from_year: 1700, drink_until_year: 2017.5, grapes: [{ grape: "Tempranillo", percent: 140 }], percentages_for_vintage: true }],
        sources: ["javascript:alert(1)"],
      });
    }
    if (answer) return claudeTool("report_wine_details", answer);
    return claudeTool("report_wine_details", {
      producer: "Anderer Produzent", country: "Italien", region: "Falsch", appellation: "DO Toro", type: "white", alcohol_content: 14,
      vintages: [{ vintage_year: 2019, drink_from_year: 2020, drink_until_year: 2032, grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true }],
      sources: ["https://pintia.example/ficha"],
    });
  },
};
const grapeCalls: Record<string, unknown>[] = [];
net.rpc.replace_grape_shares = (args) => {
  grapeCalls.push(args);
  return [];
};
installNet(net);

(async () => {
  const { wineGaps, gapCounts, needsResearch } = await import("@/lib/research/gaps");
  const { researchAndFillWine, loadGapData } = await import("@/lib/research/wine");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Lücken: im Bestand nur Pintia 2019; „alle“ auch 2016 und Alion (dort fehlt nichts)
  const data = await loadGapData(db);
  const pintia = data.wines.find((w) => w.id === W)!;
  const cellar = wineGaps(pintia, data, "cellar")!;
  assert.deepEqual(cellar.gaps, ["grapePercent", "alcohol", "window", "origin"]);
  assert.deepEqual(cellar.vintages.map((v) => v.year), [2019]);
  assert.deepEqual(wineGaps(pintia, data, "all")!.vintages.map((v) => v.year), [2019, 2016]);
  assert.equal(wineGaps(data.wines.find((w) => w.id === W2)!, data, "cellar"), null, "Alion ist nicht im Bestand");
  assert.equal(needsResearch(wineGaps(data.wines.find((w) => w.id === W2)!, data, "all")!), false);
  assert.deepEqual(gapCounts([cellar]), { grapePercent: 1, grapes: 0, alcohol: 1, window: 1, origin: 1 });

  // Ein Durchgang fragt immer alles; Leeres wird gefüllt, Abweichungen werden Vorschläge
  const outcome = await researchAndFillWine(db, W, "cellar");
  assert.equal(prompts.length, 1, "genau eine Web-Recherche pro Wein");
  const asked = prompts[0].split("Bei uns gespeichert")[0];
  assert.match(asked, /Produzent, Land, Region, Appellation, Typ, Alkohol/);
  assert.match(asked, /Jahrgang 2019: Trinkfenster ab\/bis, Rebsorten mit Prozent/);
  assert.doesNotMatch(asked, /Jahrgang 2016/, "getrunkene Jahrgänge nur bei „alle“");

  const wine = net.tables.wines.find((w) => w.id === W)!;
  assert.deepEqual([wine.producer, wine.country, wine.region, wine.type], ["Vega Sicilia", "Spanien", "Toro", "red"], "nie überschreiben");
  assert.deepEqual([wine.appellation, wine.alcohol_content], ["DO Toro", 14], "Leeres direkt gefüllt");
  const v19 = net.tables.wine_vintages.find((v) => v.id === "v1")!;
  assert.deepEqual([v19.drink_from_year, v19.drink_until_year], [2025, 2032], "„ab“ bleibt, „bis“ wird ergänzt");
  assert.equal(grapeCalls.length, 1, "gleiche Sorten ohne % → % direkt ergänzt");
  assert.deepEqual(grapeCalls[0].p_shares, [{ grape: "Tinta de Toro", percent: 100, sort_order: 0, source: "research" }]);
  assert.equal(outcome.status, "filled");
  assert.ok(Date.now() - Date.parse(String(wine.researched_at)) < 60_000, "researched_at gesetzt");
  assert.deepEqual(outcome.filled, ["Appellation", "Alkohol", "Trinkfenster 2019 (2025–2032)", "Rebsorten 2019 mit %: Tinta de Toro 100 %"]);
  const pending = () => net.tables.research_suggestions.filter((r) => r.status === "pending");
  assert.deepEqual(
    pending().map((r) => [r.field, r.vintage_year, r.current_value, r.suggested_value, r.source_note]),
    [
      ["producer", null, "Vega Sicilia", "Anderer Produzent", "pintia.example"],
      ["country", null, "Spanien", "Italien", "pintia.example"],
      ["region", null, "Toro", "Falsch", "pintia.example"],
      ["type", null, "red", "white", "pintia.example"],
      ["drink_from_year", 2019, 2025, 2020, "pintia.example"],
    ],
  );
  assert.equal(outcome.suggested, 5);

  // Gleiche Vorschläge nochmals: nichts Neues; Toleranzen (Alkohol ±0.2, Akzente, Gross/klein, % ±2)
  const again = await researchAndFillWine(db, W, "cellar");
  assert.equal(again.suggested, 0); assert.equal(pending().length, 5);
  answer = {
    producer: "VEGA SICÍLIA", country: "spanien", region: "Tóro", appellation: "do toro", type: "red", alcohol_content: 14.2,
    vintages: [{ vintage_year: 2019, drink_from_year: null, drink_until_year: 2032, grapes: [{ grape: "tinta de toro", percent: 98.5 }], percentages_for_vintage: true }],
    sources: [],
  };
  const tolerant = await researchAndFillWine(db, W, "cellar");
  assert.equal(tolerant.suggested, 0, "keine Scheinabweichungen");
  answer = { ...answer, region: "Ribera" };
  assert.equal((await researchAndFillWine(db, W, "cellar")).suggested, 1, "offener Vorschlag fürs gleiche Feld wird aktualisiert");
  assert.equal(pending().filter((r) => r.field === "region").length, 1);
  assert.equal(pending().find((r) => r.field === "region")!.suggested_value, "Ribera");
  answer = null;

  // Entscheiden: Behalten (abgelehnt) kommt nicht wieder; Übernehmen schreibt über das Bearbeiten-Modul
  const { decideSuggestion, loadPendingSuggestions } = await import("@/lib/research/suggestions");
  const producer = pending().find((r) => r.field === "producer")!;
  assert.ok((await decideSuggestion(db, producer.id as string, false, MICHEL)).ok);
  assert.equal(producer.status, "rejected"); assert.equal(producer.decided_by, MICHEL); assert.ok(producer.decided_at);
  await researchAndFillWine(db, W, "cellar");
  assert.ok(!pending().some((r) => r.field === "producer"), "abgelehnter Wert wird nicht erneut vorgeschlagen");

  const country = pending().find((r) => r.field === "country")!;
  const accepted = await decideSuggestion(db, country.id as string, true, MICHEL);
  assert.ok(accepted.ok, JSON.stringify(accepted));
  assert.equal(wine.country, "Italien"); assert.equal(country.status, "accepted");
  const from = pending().find((r) => r.field === "drink_from_year")!;
  assert.ok((await decideSuggestion(db, from.id as string, true, MICHEL)).ok);
  assert.deepEqual([v19.drink_from_year, v19.drink_until_year], [2020, 2032], "Trinkfenster: nur „ab“ übernommen");

  // Anzeige und Bot-Frage in der Ich-Form
  const list = await loadPendingSuggestions(db, { wineId: W });
  const region = list.find((x) => x.field === "region")!;
  assert.deepEqual([region.label, region.current, region.suggested], ["Region", "Toro", "Falsch"]);
  const { suggestionQuestion } = await import("@/lib/chat/research");
  assert.equal(
    suggestionQuestion({ field: "alcohol_content", vintageYear: null, current: "15 %", suggested: "14.5 %", sourceNote: null }),
    "🔎 Ich habe beim Alkohol <b>14.5 %</b> gefunden, bei dir steht 15 %. Übernehmen?",
  );
  // [Ja] im Bot: übernimmt mit der Person, die schreibt
  const { handleUpdate } = await import("@/lib/ingest/bot");
  await handleUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 111, is_bot: false, first_name: "M" }, data: `rs:${region.id}:y`, message: { message_id: 9, chat: { id: 111, type: "private" }, date: 0, text: "🔎 Ich habe … Übernehmen?" } } } as never);
  assert.equal(wine.region, "Falsch");
  assert.equal(net.tables.research_suggestions.find((r) => r.id === region.id)!.decided_by, MICHEL);

  // Ungültige Antwort (Alkohol 40 %, Jahr 1700, 2017.5, 140 %): nichts gespeichert, keine Vorschläge
  const before = grapeCalls.length;
  const suggestionsBefore = net.tables.research_suggestions.length;
  const invalid = await researchAndFillWine(db, W3, "cellar");
  assert.equal(invalid.status, "nothing", JSON.stringify(invalid));
  assert.equal(net.tables.wines.find((w) => w.id === W3)!.alcohol_content, null);
  assert.equal(net.tables.wine_vintages.some((v) => v.wine_id === W3), false);
  assert.equal(grapeCalls.length, before, "140 % → ohne Anteil; gleiche Sorten → nichts zu tun");
  assert.equal(net.tables.research_suggestions.length, suggestionsBefore);
  assert.ok(net.tables.wines.find((w) => w.id === W3)!.researched_at, "researched_at auch ohne Fund gesetzt");

  // Wein ohne Flaschen: keine Recherche
  const count = prompts.length;
  assert.equal((await researchAndFillWine(db, W4, "all")).status, "complete");
  assert.equal(prompts.length, count);
  assert.equal(net.tables.wines.find((w) => w.id === W4)!.researched_at, undefined, "ohne Recherche kein Datum");

  // 7-Tage-Regel für „kürzlich geprüfte überspringen“
  const { researchedRecently } = await import("@/lib/research/gaps");
  const now = Date.parse("2026-10-27T12:00:00Z");
  assert.equal(researchedRecently({ researched_at: "2026-10-21T12:00:01Z" }, now), true);
  assert.equal(researchedRecently({ researched_at: "2026-10-20T11:59:00Z" }, now), false);
  assert.equal(researchedRecently({ researched_at: null }, now), false);
  console.log("research tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
