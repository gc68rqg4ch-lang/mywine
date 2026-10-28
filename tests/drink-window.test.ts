// Trinkfenster bei jedem Einbuchen: fehlt es, sucht Antoine im Hintergrund eine Quelle (research),
// sonst schätzt er (estimate, mit Begründung). Herkunft je Jahrgang (label/research/estimate/manual),
// Rangfolge (manual/label nie überschreiben, research ersetzt estimate, Abweichung zu manual →
// Vorschlag), Anzeige „≈“ in App und Bot, Sammellauf „Trinkfenster fehlt“, API-Limit → nichts gesetzt.
// Claude, Telegram und Supabase per Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claudeError, claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideDrinkWindow, drinkWindowHint, drinkWindowText, saveVintageWindow } from "@/lib/cellar/drink-window";
import { evaluateDrinkWindow, findAndStoreDrinkWindow, type DrinkWindowRaw } from "@/lib/research/drink-window";
import { autoDrinkWindow } from "@/lib/research/drink-window-auto";
import { saveJob, storeBestBefore } from "@/lib/ingest/flow";
import { runLater } from "@/lib/later";
import { drinkBadges, drinkStatusText } from "@/lib/cellar/overview";
import { wineDetailsText } from "@/lib/chat/details";
import { windowTargets, wineGaps } from "@/lib/research/gaps";
import { loadGapData } from "@/lib/research/wine";
import type { IngestState } from "@/lib/ingest/schema";

const W = "11111111-1111-4111-8111-111111111111";
const NOW = new Date().getFullYear();
const SRC = "https://bodegaspintia.example/pintia-2019";
const raw = (x: Partial<DrinkWindowRaw> = {}): DrinkWindowRaw => ({
  matches_wine: true, same_vintage: true, drink_from: 0, drink_until: 0, sources: [], quote: "",
  estimate_from: 0, estimate_until: 0, estimate_reason: "", ...x,
});
const found = raw({ drink_from: 2024, drink_until: 2034, sources: [{ url: SRC, title: "Ficha", kind: "producer", vintage: 2019 }], quote: "Drink 2024–2034" });
const estimate = raw({ matches_wine: false, same_vintage: false, estimate_from: 2023, estimate_until: 2030, estimate_reason: "Toro-Rotwein aus Tinta de Toro hält meist 10–12 Jahre." });

let reply: () => Record<string, unknown> = () => claudeTool("report_drink_window", found);
const calls: string[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: { replace_grape_shares: () => [] }, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    if (tools.includes("report_drink_window")) {
      calls.push(String((body.messages as { content: string }[])[0].content));
      return reply();
    }
    if (tools.includes("report_taste_profile")) {
      return claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
installNet(net);
const db = createAdminClient();

const wine = { id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: "DO Toro", alcohol_content: 14.5, grapes: ["Tinta de Toro"], want_to_buy: false, researched_at: null, notes: null };
function reset(vintages: Record<string, unknown>[] = []) {
  net.tables = {
    persons: [{ id: "p1", name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [{ ...wine }], inventory_items: [], vendors: [], wine_vintages: vintages, wine_grape_shares: [], wine_media: [],
    wine_taste_profiles: [], research_suggestions: [], telegram_chat_messages: [], wine_encounters: [], ingest_jobs: [],
  };
  net.telegram.length = 0;
  calls.length = 0;
  reply = () => claudeTool("report_drink_window", found);
}
const row = (year: number | null = 2019) => net.tables.wine_vintages.find((v) => v.wine_id === W && v.vintage_year === year);

test("Rangfolge (rein): manual/label bleiben, research ersetzt estimate, estimate ersetzt nichts, Abweichung zu manual → Vorschlag", () => {
  const research = { from: 2024, until: 2034, source: "research" as const, note: "x" };
  const guess = { from: 2023, until: 2030, source: "estimate" as const, note: "y" };
  assert.equal(decideDrinkWindow(null, guess), "set");
  assert.equal(decideDrinkWindow({ from: null, until: null, source: null }, research), "set");
  assert.equal(decideDrinkWindow({ from: 2023, until: 2030, source: "estimate" }, research), "set");
  assert.equal(decideDrinkWindow({ from: 2023, until: 2030, source: "estimate" }, guess), "keep");
  assert.equal(decideDrinkWindow({ from: 2022, until: 2028, source: "research" }, guess), "keep");
  assert.equal(decideDrinkWindow({ from: 2022, until: 2028, source: "research" }, research), "keep");
  assert.equal(decideDrinkWindow({ from: 2022, until: 2028, source: "manual" }, research), "suggest");
  assert.equal(decideDrinkWindow({ from: 2024, until: 2034, source: "manual" }, research), "keep", "gleich → nichts");
  assert.equal(decideDrinkWindow({ from: 2022, until: 2028, source: "manual" }, guess), "keep");
  assert.equal(decideDrinkWindow({ from: null, until: 2028, source: "label" }, research), "keep");
  assert.equal(decideDrinkWindow({ from: 2022, until: 2028, source: null }, research), "suggest", "ohne Herkunft = von Hand");
});

test("Prüfung der Antwort: Quelle → research (mit Quelle), keine passende Quelle → estimate mit Begründung, sonst nichts", () => {
  assert.deepEqual(evaluateDrinkWindow(found, 2019, NOW), { from: 2024, until: 2034, source: "research", note: "bodegaspintia.example" });
  const otherVintage = raw({ ...found, sources: [{ url: SRC, title: "Ficha", kind: "producer", vintage: 2016 }], estimate_from: 2023, estimate_until: 2030, estimate_reason: "Grund." });
  assert.equal(evaluateDrinkWindow(otherVintage, 2019, NOW)?.source, "estimate", "Quelle zu anderem Jahrgang zählt nicht");
  assert.deepEqual(evaluateDrinkWindow(estimate, 2019, NOW), { from: 2023, until: 2030, source: "estimate", note: "Toro-Rotwein aus Tinta de Toro hält meist 10–12 Jahre." });
  assert.equal(evaluateDrinkWindow(raw({ estimate_from: 2023, estimate_until: 2030 }), 2019, NOW), null, "Schätzung ohne Begründung");
  assert.equal(evaluateDrinkWindow(raw({ estimate_from: 2010, estimate_until: 2030, estimate_reason: "x" }), 2019, NOW)?.from, null, "vor dem Jahrgang unplausibel");
  assert.equal(evaluateDrinkWindow(raw({ estimate_from: 2031, estimate_until: 2030, estimate_reason: "x" }), 2019, NOW), null, "ab > bis");
  assert.equal(evaluateDrinkWindow(raw({ ...found, quote: "" }), 2019, NOW), null, "Quelle ohne Zitat (und ohne Schätzung)");
  // NV: Quellen zum Wein selbst
  assert.equal(evaluateDrinkWindow(raw({ ...found, sources: [{ url: SRC, title: "x", kind: "producer", vintage: 0 }] }), null, NOW)?.source, "research");
});

test("Einbuchen ohne Trinkfenster → Suche im Hintergrund (research); mit Trinkfenster → keine Suche", async () => {
  reset();
  const job = {
    id: "aaaaaaaa-0000-4000-8000-00000000000a", source: "text", telegram_chat_id: 111, status: "processing", photo_paths: [], matched_wine_id: W,
    extracted: {
      step: "saving", source: "text", restock: true, storage_room: "Weinkeller", quantity: 1, price: null, regular_price: null, vendor_id: null,
      proposal: { name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: "Toro", appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750 },
      recognition: { model: "text", confidence: 1, notes: null, enriched_fields: [], sources: [] },
    } as unknown as IngestState,
  };
  net.tables.ingest_jobs.push(job);
  await saveJob(job as never, 111);
  assert.equal(calls.length, 0, "erst nach der Antwort");
  await runLater();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /"jahrgang":2019/);
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source, row()?.drink_window_note], [2024, 2034, "research", "bodegaspintia.example"]);

  // Jahrgang hat schon ein Trinkfenster → keine Suche
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2022, drink_until_year: 2030, drink_window_source: "manual" }]);
  assert.equal(await autoDrinkWindow(db, W, 2019), "exists");
  assert.equal(calls.length, 0);
});

test("Keine Quelle → Schätzung mit Begründung (estimate)", async () => {
  reset();
  reply = () => claudeTool("report_drink_window", estimate);
  assert.equal(await autoDrinkWindow(db, W, 2019), "set");
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source], [2023, 2030, "estimate"]);
  assert.match(String(row()?.drink_window_note), /Toro-Rotwein/);
});

test("Rangfolge in der DB: manual/label bleiben, research ersetzt estimate, Abweichung zu manual → Vorschlag", async () => {
  // estimate → research ersetzt
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2023, drink_until_year: 2030, drink_window_source: "estimate", drink_window_note: "Schätzung" }]);
  assert.equal((await findAndStoreDrinkWindow(db, W, 2019, { onlyIfEmpty: false })).result, "set");
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source], [2024, 2034, "research"]);
  // estimate ersetzt keine Schätzung
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2022, drink_until_year: 2029, drink_window_source: "estimate" }]);
  reply = () => claudeTool("report_drink_window", estimate);
  assert.equal((await findAndStoreDrinkWindow(db, W, 2019, { onlyIfEmpty: false })).result, "unchanged");
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year], [2022, 2029]);
  // manual bleibt, Abweichung → zwei Vorschläge
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2022, drink_until_year: 2028, drink_window_source: "manual" }]);
  assert.equal((await findAndStoreDrinkWindow(db, W, 2019, { onlyIfEmpty: false })).result, "suggested");
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source], [2022, 2028, "manual"]);
  assert.deepEqual(net.tables.research_suggestions.map((s) => [s.field, s.current_value, s.suggested_value]), [["drink_from_year", 2022, 2024], ["drink_until_year", 2028, 2034]]);
  // label bleibt, ohne Vorschlag
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: null, drink_until_year: 2028, drink_window_source: "label" }]);
  assert.equal((await findAndStoreDrinkWindow(db, W, 2019, { onlyIfEmpty: false })).result, "unchanged");
  assert.equal(row()?.drink_until_year, 2028);
  assert.equal(net.tables.research_suggestions.length, 0);
});

test("Ablaufdatum vom Etikett → Herkunft label", async () => {
  reset();
  await storeBestBefore(db, W, { best_before: "2028-09", proposal: { vintage_year: null } } as IngestState);
  const nv = row(null)!;
  assert.deepEqual([nv.drink_until_year, nv.drink_window_source, nv.drink_window_note, nv.notes], [2028, "label", "Haltbar bis September 2028", "Haltbar bis September 2028"]);
  // Danach sucht die automatische Suche nicht mehr (Trinkfenster vorhanden)
  assert.equal(await autoDrinkWindow(db, W, null), "exists");
});

test("Ohne Migration (Spalten fehlen): Trinkfenster wird trotzdem gespeichert, nur ohne Herkunft", async () => {
  reset();
  net.fail = (method, table, body) =>
    table === "wine_vintages" && JSON.stringify(body ?? "").includes("drink_window_source")
      ? { status: 400, body: { code: "PGRST204", message: "Could not find the 'drink_window_source' column of 'wine_vintages' in the schema cache" } }
      : null;
  try {
    await saveVintageWindow(db, { rowId: null, wineId: W, year: 2019 }, { drink_from_year: 2024, drink_until_year: 2030 }, "estimate", "x");
  } finally {
    net.fail = undefined;
  }
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source], [2024, 2030, undefined]);
});

test("Anzeige: Schätzung mit „≈“ in App und Bot; „bald trinken“ / „über dem Höhepunkt“", () => {
  assert.equal(drinkWindowText(2023, 2030, "estimate"), "≈ 2023–2030");
  assert.equal(drinkWindowText(2023, 2030, "research"), "2023–2030");
  assert.equal(drinkStatusText(2023, 2030, 2026, "estimate"), "Trinkreif · ≈ 2023–2030 (geschätzt)");
  const badges = drinkBadges({ name: "x", producer: null, country: null, region: null, type: "red", grapes: [], vintages: [2019], units: [{ vintage_year: 2019, price_class: null, count: 1, drink_from_year: 2023, drink_until_year: 2030, drink_source: "estimate" }] }, [2019], 2026);
  assert.equal(badges[0].text, "Trinkreif · ≈ 2023–2030 (geschätzt)");
  assert.equal(drinkWindowHint(NOW), "bald trinken");
  assert.equal(drinkWindowHint(NOW - 1), "über dem Höhepunkt");
  assert.equal(drinkWindowHint(NOW + 3), null);
  const base = { name: "Pintia", producer: "Vega Sicilia", type: "red" as const, year: 2019, country: null, region: null, appellation: null, alcohol: null, grapes: null, bottles: [], ratings: [], lastTasting: null, appUrl: null };
  assert.match(wineDetailsText({ ...base, drinkFrom: 2023, drinkUntil: NOW + 4, drinkSource: "estimate" }), /⏳ Trinkreife ≈ 2023–\d{4} \(geschätzt\)/);
  assert.match(wineDetailsText({ ...base, drinkFrom: 2018, drinkUntil: NOW - 1, drinkSource: "research" }), new RegExp(`⏳ Trinkreife 2018–${NOW - 1} – über dem Höhepunkt`));
  assert.match(wineDetailsText({ ...base, drinkFrom: 2020, drinkUntil: NOW, drinkSource: "manual" }), /– bald trinken/);
  // App: Weinseite zeigt die Herkunft, Bestand/Offen laden sie dazu
  const page = readFileSync("src/app/(cellar)/wein/[id]/page.tsx", "utf8");
  assert.ok(page.includes("drinkWindowText(vintage?.drink_from_year ?? null, vintage?.drink_until_year ?? null, drinkSource)"));
  assert.ok(page.includes("DRINK_SOURCE_LABELS[drinkSource]"));
  for (const f of ["src/app/(cellar)/page.tsx", "src/app/(cellar)/offen/page.tsx"]) assert.match(readFileSync(f, "utf8"), /withDrinkWindows\(/, f);
});

test("Sammellauf „Trinkfenster fehlt“: nur Jahrgänge mit Flaschen (ungeöffnet/offen) ohne „ab“ und „bis“, auch NV", async () => {
  reset([
    { id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: null, drink_until_year: null, taste_profile_checked_at: null },
    { id: "v18", wine_id: W, vintage_year: 2018, drink_from_year: 2022, drink_until_year: null, taste_profile_checked_at: null },
  ]);
  net.tables.inventory_items = [
    { wine_id: W, vintage_year: 2019, status: "sealed" },
    { wine_id: W, vintage_year: 2018, status: "open" },
    { wine_id: W, vintage_year: 2016, status: "sealed" },
    { wine_id: W, vintage_year: null, status: "open" },
    { wine_id: W, vintage_year: 2010, status: "drunk" },
  ];
  const data = await loadGapData(db);
  const g = wineGaps(data.wines[0], data, "cellar")!;
  assert.deepEqual(windowTargets(g, data), [2019, 2016, null], "2018 hat schon „ab“, 2010 ist getrunken");
  const page = readFileSync("src/app/(cellar)/recherche/page.tsx", "utf8");
  assert.ok(page.includes('params.fenster === "1"') && page.includes('mode={windowMode ? "window" : "research"}'));
});

test("API-Limit → nichts gesetzt (kein Trinkfenster, keine Herkunft), Fehler wird gemeldet", async () => {
  reset();
  reply = () => claudeError(400, "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.") as never;
  await assert.rejects(findAndStoreDrinkWindow(db, W, 2019), /usage limits/);
  assert.equal(net.tables.wine_vintages.length, 0);
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    assert.equal(await autoDrinkWindow(db, W, 2019), "failed");
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((l) => l.startsWith("api limit reached")));
  assert.equal(net.tables.wine_vintages.length, 0);
  assert.equal(net.tables.wines[0].researched_at, null);
});

test("Von Hand in der App geändert → „manual“; übernommener Vorschlag → „research“", async () => {
  const { applyEdit } = await import("@/lib/edit/edit");
  reset([{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2023, drink_until_year: 2030, drink_window_source: "estimate" }]);
  const done = await applyEdit(db, { kind: "drinkWindow", wineId: W, year: 2019, from: 2024, until: 2031 });
  assert.ok(done.ok, JSON.stringify(done));
  assert.deepEqual([row()?.drink_from_year, row()?.drink_until_year, row()?.drink_window_source], [2024, 2031, "manual"]);
  assert.ok((await applyEdit(db, { kind: "drinkWindow", wineId: W, year: 2019, from: 2024, until: 2034, source: "research" })).ok);
  assert.equal(row()?.drink_window_source, "research");
  assert.ok((await applyEdit(db, { kind: "drinkWindow", wineId: W, year: 2019, from: null, until: null })).ok);
  assert.equal(row()?.drink_window_source, null, "leer → keine Herkunft");
});
