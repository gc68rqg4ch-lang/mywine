// Stammdaten und Geschmacksprofil in EINEM Recherche-Aufruf, wenn beides fällig ist; sonst wie
// bisher je ein Aufruf. Gemeinsames Schema unter der Union-Grenze. Stubs – ohne DB, Schlüssel, Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeError, claudeTool, installNet, type Net } from "./stub-net";
import { schemaRejected, usageLimit } from "@/lib/ai/api-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine } from "@/lib/research/wine";
import { runJob, toResult } from "@/lib/research/jobs";
import { wineTastePrompt } from "@/lib/research/wine-taste";
import { WINE_TASTE_MAX_TOKENS, WINE_TASTE_SEARCHES, wineTasteSchema } from "@/lib/research/wine-taste";
import { tasteResearchSchema } from "@/lib/research/taste";
import { toolInputSchema } from "@/lib/ingest/recognize";
import { MAX_UNION_PARAMS, countUnionParams, strictSchemaProblems } from "@/lib/ai/schema-limits";
import { recordUsage, setUsageWriter } from "@/lib/ai/usage";
import { PURPOSE_LABELS } from "@/lib/ai/cost";
import { satTypeForWine } from "@/lib/tasting/sat";
import { UNKNOWN } from "@/lib/taste/profile";

const W = "11111111-1111-4111-8111-111111111111";
const SRC = "https://pintia.example/ficha-2019";
const WINE = { producer: null, country: null, region: null, appellation: "DO Toro", type: null, alcohol_content: 14.5, vintages: [{ vintage_year: 2019, drink_from_year: 2022, drink_until_year: 2034, grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true }], sources: [SRC] };
const TASTE = {
  matches_wine: true, same_vintage: true,
  sources: [{ url: SRC, title: "Ficha", kind: "producer", vintage: 2019 }],
  fields: { sweetness: "trocken", acidity: UNKNOWN, tannin: "hoch", alcohol: UNKNOWN, body: "voll", flavour_intensity: UNKNOWN, finish: UNKNOWN },
  aromas: [], evidence: [{ field: "body", source_url: SRC, quote: "full-bodied" }, { field: "tannin", source_url: SRC, quote: "firm tannins" }],
  contradictions: [], style_summary: "", food_pairing: [],
};
type Call = { tools: string[]; body: Record<string, unknown> };
const calls: Call[] = [];
let combinedReply: () => Record<string, unknown> = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
const net: Net & { nativeCombined?: boolean } = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name).filter((n) => n.startsWith("report_"));
    calls.push({ tools, body });
    if (tools.includes("report_wine_and_taste")) return combinedReply();
    if (tools.includes("report_taste_profile")) return claudeTool("report_taste_profile", TASTE);
    if (tools.includes("report_spirit_details")) return claudeTool("report_spirit_details", { matches_spirit: false, producer: "", country: "", region: "", alcohol_content: 0, age_years: 0, cask: "", distilled_year: 0, bottled_year: 0, category: "unbekannt", sources: [] });
    return claudeTool("report_wine_details", WINE);
  },
};
net.nativeCombined = true;
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();

const monthsAgo = (m: number) => new Date(Date.now() - m * 30 * 86_400_000).toISOString();
function reset(type = "red", checked: string | null = null) {
  calls.length = 0;
  net.tables = {
    wines: [{ id: W, name: type === "spirit" ? "Woodford Reserve" : "Pintia", producer: type === "spirit" ? "Woodford" : "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type, alcohol_content: null, grapes: [], researched_at: null, spirit_category_id: null, age_years: null, cask: null, distilled_year: null, bottled_year: null }],
    inventory_items: [{ wine_id: W, vintage_year: type === "spirit" ? null : 2019, status: "sealed" }],
    wine_encounters: [],
    wine_vintages: [{ id: "v19", wine_id: W, vintage_year: type === "spirit" ? null : 2019, drink_from_year: null, drink_until_year: null, taste_profile_checked_at: checked }],
    wine_grape_shares: [], wine_taste_profiles: [], wine_media: [], research_suggestions: [], api_usage: [], spirit_categories: [],
  };
}

test("Stammdaten und Profil fällig → genau EIN Recherche-Aufruf; beides wird wie bisher gespeichert", async () => {
  reset();
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.deepEqual(calls.map((c) => c.tools), [["report_wine_and_taste"]]);
  const body = calls[0].body;
  assert.equal(body.max_tokens, WINE_TASTE_MAX_TOKENS);
  const search = (body.tools as { type?: string; max_uses?: number }[]).find((t) => t.type?.startsWith("web_search"));
  assert.equal(search?.max_uses, WINE_TASTE_SEARCHES);
  assert.equal(WINE_TASTE_SEARCHES, 3);
  const prompt = JSON.stringify(body.messages);
  assert.match(prompt, /Beginne mit dem technischen Datenblatt[^"]*Verkostungsnotiz des Jahrgangs 2019/);
  assert.match(prompt, /Teil 1 \(Feld wine\)[\s\S]*Rebsorten mit Prozent[\s\S]*Teil 2 \(Feld taste\)[\s\S]*wörtliches Zitat/);
  // Stammdaten, Jahrgang, Profil
  assert.deepEqual([net.tables.wines[0].appellation, net.tables.wines[0].alcohol_content], ["DO Toro", 14.5]);
  assert.deepEqual([net.tables.wine_vintages[0].drink_from_year, net.tables.wine_vintages[0].drink_until_year], [2022, 2034]);
  assert.equal(net.tables.wine_taste_profiles.length, 1);
  assert.equal(outcome.taste, "saved");
  assert.ok(net.tables.wines[0].researched_at, "markResearched");
  assert.ok(net.tables.wine_vintages[0].taste_profile_checked_at, "markTasteChecked");
  // Eigener Zweck in api_usage
  assert.deepEqual(net.tables.api_usage.map((r) => r.purpose), ["research_wine_taste"]);
  assert.equal(PURPOSE_LABELS.research_wine_taste, "Recherche Stammdaten + Profil");
});

test("Gemeinsamer Aufruf ohne Ergebnis → kein Ersatz-Aufruf; Profil gilt als gesucht, Stammdaten als recherchiert", async () => {
  reset();
  combinedReply = () => ({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: "Nichts gefunden." }], usage: { input_tokens: 1, output_tokens: 1 } });
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.equal(calls.length, 1, "kein zusätzlicher teurer Aufruf");
  assert.equal(outcome.taste, "none");
  assert.ok(net.tables.wines[0].researched_at);
  assert.ok(net.tables.wine_vintages[0].taste_profile_checked_at);
  // Nur ein Teil gültig: der andere bleibt erhalten
  reset();
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: { kaputt: true } });
  const half = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.equal(net.tables.wines[0].appellation, "DO Toro");
  assert.equal(half.taste, "none");
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
});

test("Nur Profil (🔎) bzw. nur Stammdaten (Profil nicht fällig) → wie bisher je ein Aufruf", async () => {
  reset();
  await researchAndFillWine(db, W, "all", { taste: "only", year: 2019 });
  assert.deepEqual(calls.map((c) => c.tools), [["report_taste_profile"]]);
  reset("red", monthsAgo(1));
  await researchAndFillWine(db, W, "all", { taste: "missing" });
  assert.deepEqual(calls.map((c) => c.tools), [["report_wine_details"]], "Profil kürzlich gesucht: nur Stammdaten");
});

test("Spirituose unverändert: eigene Recherche, kein gemeinsamer Aufruf", async () => {
  reset("spirit");
  await researchAndFillWine(db, W, "all", { taste: "always" });
  const tools = calls.flatMap((c) => c.tools);
  assert.ok(tools.includes("report_spirit_details"));
  assert.ok(!tools.includes("report_wine_and_taste") && !tools.includes("report_wine_details"));
});

test("Gemeinsames Schema: unter der Union-Grenze und strict-tauglich (Wein und Spirituose)", () => {
  for (const wineType of ["red", "white", "sparkling", "sweet", "fortified", "rose"]) {
    const json = toolInputSchema(wineTasteSchema(tasteResearchSchema(satTypeForWine(wineType), wineType)));
    const unions = countUnionParams(json);
    assert.ok(unions <= MAX_UNION_PARAMS, `${wineType}: ${unions} Unions`);
    assert.deepEqual(strictSchemaProblems(json), [], wineType);
  }
});

test("Gemeinsames Tool ohne strict (keine Grammatik), Einzel-Tools weiter strict", async () => {
  reset();
  await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  const tool = (calls[0].body.tools as { name?: string; strict?: boolean }[]).find((t) => t.name === "report_wine_and_taste")!;
  assert.equal(tool.strict, false);
  reset();
  await researchAndFillWine(db, W, "all", { taste: "only", year: 2019 });
  assert.equal((calls[0].body.tools as { name?: string; strict?: boolean }[]).find((t) => t.name === "report_taste_profile")!.strict, true);
});

const GRAMMAR = "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.";
const LIMIT = "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.";

test("Schema-Fehler (400) beim gemeinsamen Aufruf → sofort die zwei Einzelaufrufe, beide Ergebnisse gespeichert", async () => {
  reset();
  combinedReply = () => claudeError(400, GRAMMAR) as never;
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.deepEqual(calls.map((c) => c.tools), [["report_wine_and_taste"], ["report_wine_details"], ["report_taste_profile"]]);
  assert.equal(net.tables.wines[0].appellation, "DO Toro");
  assert.equal(net.tables.wine_taste_profiles.length, 1);
  assert.equal(outcome.taste, "saved");
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
});

test("API-Limit beim gemeinsamen Aufruf → kein Rückfall (wie bisher), nichts vermerkt", async () => {
  reset();
  combinedReply = () => claudeError(400, LIMIT) as never;
  await assert.rejects(researchAndFillWine(db, W, "all", { taste: "always", year: 2019 }), (e: unknown) => usageLimit(e) != null);
  assert.equal(calls.length, 1);
  assert.equal(net.tables.wines[0].researched_at, null);
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
});

test("Schema-Ablehnung erkennen: Grammatik, Union-Grenze, nicht unterstützt – nicht Limit, Überlast oder anderes", () => {
  const err = (status: number, message: string) => Object.assign(new Error(`${status} ${message}`), { status, error: { type: "error", error: { type: "invalid_request_error", message } } });
  assert.ok(schemaRejected(err(400, GRAMMAR)));
  assert.ok(schemaRejected(err(400, "Schemas contains too many parameters with union types (18 parameters with type arrays or anyOf). This exceeds the limit of 16")));
  assert.ok(schemaRejected(err(400, "tools.2.custom.input_schema: 'minimum' is not supported")));
  assert.ok(!schemaRejected(err(400, LIMIT)));
  assert.ok(!schemaRejected(err(529, "Overloaded")));
  assert.ok(!schemaRejected(err(400, "messages: text content blocks must be non-empty")));
});

test("Ungültiger Teil → einmal nachfragen (gleiche Unterhaltung); bleibt er ungültig, gilt der gültige Teil", async () => {
  reset();
  let n = 0;
  const broken = { ...TASTE, fields: { sweetness: "trocken" } };
  combinedReply = () => (++n === 1 ? claudeTool("report_wine_and_taste", { wine: WINE, taste: broken }) : claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE }));
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.equal(calls.length, 2, "eine Nachfrage");
  const followUp = JSON.stringify(calls[1].body.messages);
  assert.match(followUp, /"is_error":true/);
  assert.match(followUp, /Teil taste/);
  assert.equal(outcome.taste, "saved");
  // Zweimal ungültig: keine dritte Runde; Stammdaten bleiben, kein Profil
  reset();
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: broken });
  const half = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.equal(calls.length, 2);
  assert.equal(net.tables.wines[0].appellation, "DO Toro");
  assert.equal(half.taste, "none");
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
});

test("Vor der Migration: neuer Zweck wird als research_wine gezählt", async () => {
  const rows: { purpose: string }[] = [];
  setUsageWriter(async (row) => {
    if (row.purpose === "research_wine_taste") throw new Error('new row for relation "api_usage" violates check constraint "api_usage_purpose_check"');
    rows.push(row);
  });
  await recordUsage("claude-sonnet-5-5", { input_tokens: 10, output_tokens: 5 }, { purpose: "research_wine_taste" });
  assert.deepEqual(rows.map((r) => r.purpose), ["research_wine"]);
});

test("Prompt: klares Kriterium zum Weitersuchen bzw. Aufhören, keine Einladung zum Aufhören nach einem Treffer", () => {
  const input = { wine: { wine: { name: "Pintia", producer: "Vega Sicilia", country: null, region: null, appellation: null, type: "red" as const, alcohol_content: null }, vintages: [{ year: 2019, knownGrapes: [] }] }, taste: { wine: { name: "Pintia", producer: "Vega Sicilia", type: "red" }, year: 2019, documents: [], pages: [] } };
  const prompt = wineTastePrompt(input, "REGELN", "");
  assert.match(prompt, /Verlässliche Quellen: Produzent bzw\. Datenblatt, offizieller Importeur bzw\. Vertreiber, seriöse Fachhändler, Kritiker bzw\. Fachpresse\. Nicht verlässlich: persönliche Einschätzungen \(Blogs, Videos, Foren, Bewertungsportale mit Nutzernotizen\)/);
  assert.match(prompt, /Wann aufhören: sobald beide Teile \(Stammdaten und Geschmacksprofil\) mit mindestens einer verlässlichen Quelle belegt sind/);
  assert.match(prompt, /Wann weitersuchen: nur, solange für einen Teil noch keine verlässliche Quelle gefunden ist – dann mit einem anderen Ansatz bzw\. einer anderen Art von Quelle; keine Abfrage wiederholen/);
  assert.match(prompt, /bleiben „unbekannt“ – dafür nicht weitersuchen und nichts erfinden/);
  assert.match(prompt, /bis zu 3 Websuchen/);
  assert.doesNotMatch(prompt, /mindestens zwei unabhängigen Quellen|nur eine Quelle hat|belegen meist|zugleich|Keine Suche doppelt|EINER Websuche/);
  const white = wineTastePrompt({ ...input, taste: { ...input.taste, wine: { ...input.taste.wine, type: "white" } } }, "REGELN", "");
  assert.match(white, /Kernwerte wie Säure, Körper, Süsse\)/, "Tannin nur bei Rotwein");
});

test("Diagnose im Ergebnis des Auftrags: Websuchen, Profil-Quellen, Kernwerte „unbekannt“, confidence", async () => {
  reset();
  // Zwei Websuchen in der Antwort (wie die API sie als server_tool_use liefert)
  combinedReply = () => {
    const r = claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE }) as { content: unknown[] };
    return { ...r, content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Pintia 2019 ficha" } }, { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "Pintia 2019 review" } }, ...r.content] };
  };
  const outcome = await runJob(db, { wine_id: W, kind: "page", params: { year: 2019 } });
  const result = toResult(outcome) as { diagnostics?: { wine_taste?: Record<string, unknown> } };
  // TASTE: eine Quelle, Säure unbekannt (Süsse, Tannin, Körper belegt)
  assert.deepEqual(result.diagnostics?.wine_taste, { web_searches: 2, requests: 1, profile_sources: 1, unknown_core: 1, confidence: "mittel", answered: true });
  // Rückfall (Schema-Fehler): vermerkt
  reset();
  combinedReply = () => claudeError(400, GRAMMAR) as never;
  const fallback = toResult(await runJob(db, { wine_id: W, kind: "page", params: { year: 2019 } })) as { diagnostics?: { wine_taste?: { fallback?: string } } };
  assert.match(String(fallback.diagnostics?.wine_taste?.fallback), /grammar/);
  combinedReply = () => claudeTool("report_wine_and_taste", { wine: WINE, taste: TASTE });
});
