// API-Kosten messen und begrenzen: Kosten aus usage (Preistabelle), Protokoll jeder Messages-
// Antwort über den fetch des Clients (Zweck, Wein, Auftrag, dry_run), Fehler beim Protokollieren
// stören nie, Monatsbudget (Recherche pausiert, Erkennung läuft, einmal pro Tag gemeldet, Erhöhung).
// Ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUDGET_STEP_USD, DEFAULT_MONTHLY_BUDGET_USD, baseBudget, costUsd, priceOf, usageCounts, zurichMonth } from "@/lib/ai/cost";
import { recordUsage, setUsageWriter, usageRow, withUsage } from "@/lib/ai/usage";
import { budgetExceeded, budgetFrom, budgetState, raiseBudget } from "@/lib/ai/budget";
import { RESEARCH_MAX_TOKENS, parseTextEntry, researchTools, webResearch } from "@/lib/ingest/recognize";
import { processQueue, runJob } from "@/lib/research/jobs";
import { scheduleTasteProfile } from "@/lib/research/taste-auto";
import { runLater } from "@/lib/later";
import { z } from "zod";

test("Kosten aus usage: Input, Output, Cache lesen/schreiben, Websuchen; Haiku über 100k teurer; unbekanntes Modell vorsichtig", () => {
  const usage = { input_tokens: 10_000, output_tokens: 1_000, cache_read_input_tokens: 5_000, cache_creation_input_tokens: 2_000, server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 } };
  // Sonnet 5.5: (10000×2 + 1000×10 + 5000×0.2 + 2000×2.5) / 1e6 + 3 × 0.01
  assert.equal(costUsd("claude-sonnet-5-5", usage), 0.066);
  assert.deepEqual(usageCounts(usage), { input: 10_000, output: 1_000, cacheRead: 5_000, cacheWrite: 2_000, webSearches: 3, webFetches: 1 });
  assert.equal(costUsd("claude-haiku-5-5", { input_tokens: 2_000, output_tokens: 500 }), 0.00045);
  assert.equal(costUsd("claude-haiku-5-5", { input_tokens: 150_000, output_tokens: 1_000 }), 0.0775, "über 100k: 0.50/2.50");
  assert.equal(priceOf("claude-sonnet-5-5-20261001").input, 2, "mit Zusatz");
  assert.equal(priceOf("irgendwas").input, 4, "unbekannt: wie Opus 5.5");
  assert.equal(costUsd("claude-sonnet-5-5", null), 0);
  assert.equal(costUsd("claude-sonnet-5-5", { input_tokens: -5, output_tokens: Number.NaN }), 0);
});

test("Monat in Zürich: Grenzen in UTC (Sommer-/Winterzeit), Vormonat, Jahreswechsel; Budget aus der Umgebung", () => {
  assert.deepEqual(zurichMonth(new Date("2026-10-29T12:00:00Z")), { month: "2026-10-01", from: "2026-09-30T22:00:00.000Z", to: "2026-10-31T23:00:00.000Z" });
  assert.equal(zurichMonth(new Date("2026-10-29T12:00:00Z"), -1).month, "2026-09-01");
  assert.equal(zurichMonth(new Date("2026-01-15T12:00:00Z"), -1).month, "2025-12-01");
  assert.equal(zurichMonth(new Date("2026-10-31T23:30:00Z")).month, "2026-11-01", "Mitternacht Zürich = schon November");
  assert.equal(baseBudget(undefined), DEFAULT_MONTHLY_BUDGET_USD);
  assert.equal(baseBudget("35"), 35);
  assert.equal(baseBudget("viel"), 20);
  assert.deepEqual(budgetFrom("2026-10-01", 19.99, 0, null, 20).exceeded, false);
  assert.deepEqual(budgetFrom("2026-10-01", 20, 0, null, 20).exceeded, true);
  assert.deepEqual(budgetFrom("2026-10-01", 25, 10, null, 20), { month: "2026-10-01", spent: 25, base: 20, extra: 10, budget: 30, exceeded: false, notifiedOn: null });
});

// --- Mit Stub: Claude, Supabase, Telegram

const W = "11111111-1111-4111-8111-111111111111";
let cost = 0;
let claudeCalls = 0;
let lastBody: Record<string, unknown> = {};
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    claudeCalls++;
    lastBody = body;
    const tools = ((body.tools as { name?: string }[]) ?? []).map((t) => t.name);
    const name = tools.includes("report_test") ? "report_test" : "report_taste_profile";
    const reply = name === "report_test" ? claudeTool(name, { ok: true }) : claudeTool(name, { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    // Text-Erfassung (strukturierte Ausgabe)
    if ((body.output_config as { format?: unknown } | undefined)?.format) {
      return { ...reply, model: body.model, content: [{ type: "text", text: JSON.stringify({ name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, type: "red", country: "Spanien", region: null, appellation: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null, best_before: "", spirit: { kind: "wine", category: "", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 }, purchase: { quantity: 0, storage_room: "", price: 0, regular_price: 0, vendor: "" } }) }], stop_reason: "end_turn", usage: { input_tokens: 800, output_tokens: 200 } };
    }
    return { ...reply, usage: { input_tokens: 20_000, output_tokens: 1_500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 4, web_fetch_requests: 0 } } };
  },
};
net.rpc.api_cost_by_purpose = () => (cost ? [{ purpose: "research_wine", calls: 3, cost_usd: cost, web_searches: 10 }] : []);
installNet(net);
const db = createAdminClient();

function reset() {
  net.tables = {
    api_usage: [], api_budget: [], research_jobs: [], research_worker_lock: [{ id: 1, owner: null, locked_until: null }],
    persons: [{ id: "p1", name: "mk", telegram_user_id: 111 }],
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null }],
    wine_vintages: [], wine_taste_profiles: [], wine_media: [], inventory_items: [], vendors: [],
  };
  net.telegram = [];
  cost = 0;
  claudeCalls = 0;
}
const schema = z.object({ ok: z.boolean() });
const research = () => webResearch({ prompt: "Test", toolName: "report_test", toolDescription: "x", schema, maxSearches: 2 });

test("Jede Messages-Antwort wird protokolliert: Zweck aus dem Kontext, Wein, Auftrag, Websuchen, Kosten", async () => {
  reset();
  const result = await withUsage({ purpose: "research_price", wineId: W, jobRef: "job-1:dry_run" }, research);
  assert.deepEqual(result, { ok: true });
  const [row] = net.tables.api_usage;
  assert.deepEqual(
    [row.purpose, row.model, row.input_tokens, row.output_tokens, row.web_searches, row.wine_id, row.job_ref],
    ["research_price", "claude-sonnet-5-5", 20_000, 1_500, 4, W, "job-1:dry_run"],
  );
  assert.equal(row.cost_usd, 0.095, "20000×2/1e6 + 1500×10/1e6 + 4 × 0.01");
  // Ohne äusseren Zweck: aus dem Tool der Recherche (unbekanntes Tool → other)
  await research();
  assert.equal(net.tables.api_usage[1].purpose, "other");
  // Erkennung: Zweck recognize (das Ergebnis selbst ist hier egal)
  await parseTextEntry("Pintia 2019, 6 Flaschen").catch(() => null);
  const haiku = net.tables.api_usage.find((r) => r.model === "claude-haiku-5-5")!;
  assert.equal(haiku.purpose, "recognize");
  assert.equal(haiku.cost_usd, 0.00018, "Haiku: 800×0.1 + 200×0.5");
  // Ungültige Wein-ID wird nicht übernommen
  assert.equal(usageRow("claude-haiku-5-5", null, { wineId: "kein-uuid" }).wine_id, null);
});

test("Recherche: höchstens 6000 Ausgabe-Tokens, Websuche mit Schweizer Standort; ohne Suchen kein web_search-Tool", async () => {
  reset();
  await research();
  assert.equal(lastBody.max_tokens, RESEARCH_MAX_TOKENS);
  assert.ok(RESEARCH_MAX_TOKENS <= 6000);
  const none = researchTools({ toolName: "x", toolDescription: "x", inputSchema: { type: "object" }, maxSearches: 0 });
  assert.ok(!none.some((t) => "type" in t && t.type === "web_search_20260209"));
});

test("Fehler beim Protokollieren stören den Ablauf nie", async () => {
  reset();
  const errors: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(" "));
  try {
    setUsageWriter(async () => {
      throw new Error("DB weg");
    });
    assert.deepEqual(await research(), { ok: true });
    await recordUsage("claude-sonnet-5-5", { input_tokens: 1 });
  } finally {
    console.error = orig;
    setUsageWriter(async (row) => {
      const { error } = await db.from("api_usage").insert(row);
      if (error) throw new Error(error.message);
    });
  }
  assert.ok(errors.some((e) => e.startsWith("api usage log failed") && e.includes("DB weg")));
  // Supabase lehnt ab (z. B. Migration fehlt) → ebenso nur ein Log
  net.fail = (method, table) => (table === "api_usage" ? { status: 404, body: { code: "PGRST205", message: "Could not find the table 'public.api_usage'" } } : null);
  try {
    assert.deepEqual(await research(), { ok: true });
  } finally {
    net.fail = undefined;
  }
});

test("Budget erreicht: Recherche-Aufträge pausieren (hold budget), Meldung einmal pro Tag; nach Erhöhung geht es weiter", async () => {
  reset();
  for (const id of ["j1", "j2"]) net.tables.research_jobs.push({ id, run_id: "r1", wine_id: W, kind: "page", params: {}, status: "queued", hold: null, attempts: 0, position: 0, created_at: new Date().toISOString(), created_by: "p1" });
  net.rpc.acquire_research_worker = () => true;
  net.rpc.release_research_worker = () => null;
  net.rpc.claim_research_job = () => {
    const next = net.tables.research_jobs.find((j) => j.status === "queued" && j.hold == null);
    if (!next) return [];
    Object.assign(next, { status: "running", attempts: 1 });
    return [{ ...next }];
  };
  cost = 21.5;
  assert.equal(await budgetExceeded(db), true);
  let ran = 0;
  const runner = async () => {
    ran++;
    return { status: "nothing" as const, filled: [], suggested: 0, seconds: 0 };
  };
  const first = await processQueue(db, { runner });
  assert.equal(first.status === "ok" && first.halted, "budget");
  assert.equal(ran, 0, "keine Recherche");
  assert.deepEqual(net.tables.research_jobs.map((j) => [j.status, j.hold]), [["queued", "budget"], ["queued", "budget"]]);
  const notices = () => net.telegram.filter((t) => t.method === "sendMessage" && /Monatsbudget/.test(String(t.body.text)));
  assert.equal(notices().length, 1);
  assert.match(String(notices()[0].body.text), /USD 21\.50 von 20\.00\). 2 Recherchen warten/);
  await processQueue(db, { runner });
  assert.equal(notices().length, 1, "höchstens einmal pro Tag");

  // Automatische Recherche nach dem Einbuchen fällt aus (keine API-Kosten)
  claudeCalls = 0;
  scheduleTasteProfile(W, 2019);
  await runLater();
  assert.equal(claudeCalls, 0);
  // Erkennung läuft weiter (nicht vom Budget betroffen)
  await parseTextEntry("Pintia 2019").catch(() => null);
  assert.ok(claudeCalls >= 1);

  // Budget um 10 USD erhöhen → 30: Aufträge werden freigegeben und abgearbeitet
  assert.equal(await raiseBudget(db), DEFAULT_MONTHLY_BUDGET_USD + BUDGET_STEP_USD);
  const state = await budgetState(db);
  assert.deepEqual([state?.extra, state?.budget, state?.exceeded], [10, 30, false]);
  const second = await processQueue(db, { runner });
  assert.equal(second.status === "ok" && second.processed, 2);
  assert.equal(ran, 2);
  assert.ok(net.tables.research_jobs.every((j) => j.status === "done" && j.hold == null));
});

test("Auftrag im Worker: Wein und Auftrag im Protokoll; Testlauf der Preissuche mit „:dry_run“", async () => {
  reset();
  net.tables.inventory_items = [{ id: "cccccccc-0000-4000-8000-00000000000c", wine_id: W, vintage_year: 2019, bottle_size_ml: 750, quantity: 1, purchase_price: null, regular_price: null, is_gift: false, gift_from: null }];
  await runJob(db, { id: "job-7", wine_id: W, kind: "price", params: { item_id: "cccccccc-0000-4000-8000-00000000000c", mode: "both", dry_run: true } } as never);
  const rows = net.tables.api_usage;
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.purpose === "research_price" && r.wine_id === W && r.job_ref === "job-7:dry_run"), JSON.stringify(rows));
});

test("Nach dem Einbuchen schon gesucht: Trinkfenster nur schätzen, ohne zweite Websuche", async () => {
  reset();
  const { researchDrinkWindow } = await import("@/lib/research/drink-window");
  await researchDrinkWindow({ name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: null }, 2019, null, [], { noSearch: true });
  const tools = (lastBody.tools as { type?: string; name?: string }[]).map((t) => t.type ?? t.name);
  assert.ok(!tools.includes("web_search_20260209") && !tools.includes("web_fetch_20260209"), tools.join(","));
  assert.match(JSON.stringify(lastBody.messages), /Keine Websuche/);
  await researchDrinkWindow({ name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: null }, 2019, null, []);
  assert.ok((lastBody.tools as { type?: string }[]).some((t) => t.type === "web_search_20260209"), "sonst wie bisher mit Websuche");
});
