// Trinkfenster speichern mit unvollständigem Teilresultat (Fall „Abstract“ 2022, verkostet über
// Antoine, ohne Bestand): Status ohne recognition → früher „Cannot read properties of undefined
// (reading 'sources')“, Trinkfenster nicht gespeichert. Jetzt: ohne Quelle gespeichert; manual
// bleibt; bei einem Fehler nichts als geprüft markiert (Lücke bleibt für den nächsten Lauf).
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { recognitionSources, storeDrinkWindow } from "@/lib/ingest/flow";
import type { IngestState } from "@/lib/ingest/schema";
import { sourceNote } from "@/lib/research/compare";
import { readTasteResearch } from "@/lib/research/taste";
import { wineGaps } from "@/lib/research/gaps";

const W = "30e65544-d507-4732-8e20-6c57d66596f8";
const ROW = "00a88dc3-398b-4189-980c-583142d2dcc5";

/** Genau wie im Verkostet-Ablauf vor der Korrektur: ohne recognition. */
const partial = (extra: Partial<IngestState> = {}) =>
  ({ proposal: { name: "Abstract", producer: "Orin Swift", vintage_year: 2022, grape_shares: [] }, drink_from_year: 2024, drink_until_year: 2030, ...extra }) as unknown as IngestState;

const emptyRow = (extra: Record<string, unknown> = {}) => ({
  id: ROW, wine_id: W, vintage_year: 2022, drink_from_year: null, drink_until_year: null, drink_window_source: null, drink_window_note: null, ...extra,
});

function quietErrors() {
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  return { errors, restore: () => (console.error = orig) };
}

test("Teilresultat ohne recognition: kein Absturz, Trinkfenster ohne Quelle gespeichert", async () => {
  const tables = { wine_vintages: [emptyRow()], wines: [{ id: W, researched_at: null }] };
  const log = quietErrors();
  try {
    await storeDrinkWindow(fakeDb(tables) as never, W, partial());
  } finally {
    log.restore();
  }
  assert.deepEqual(log.errors, [], "kein „storing drink window failed“");
  const [v] = tables.wine_vintages;
  assert.deepEqual([v.drink_from_year, v.drink_until_year, v.drink_window_source, v.drink_window_note], [2024, 2030, "research", null]);
});

test("recognition ohne bzw. mit kaputten sources: keine Quelle; mit Quellen: Host als Notiz", async () => {
  assert.deepEqual(recognitionSources(partial()), []);
  assert.deepEqual(recognitionSources(partial({ recognition: {} as never })), []);
  assert.deepEqual(recognitionSources(partial({ recognition: { sources: "x" } as never })), []);
  assert.equal(sourceNote(undefined), null);
  assert.equal(sourceNote(null), null);
  const tables = { wine_vintages: [emptyRow()] };
  await storeDrinkWindow(fakeDb(tables) as never, W, partial({ recognition: { model: "", confidence: 1, notes: null, enriched_fields: [], sources: ["https://www.orinswift.com/abstract"] } }));
  assert.equal(tables.wine_vintages[0].drink_window_note, "orinswift.com");
});

test("Trinkfenster von Hand (manual) bzw. schon vorhanden: nie überschrieben", async () => {
  for (const row of [emptyRow({ drink_window_source: "manual" }), emptyRow({ drink_from_year: 2025, drink_until_year: 2032, drink_window_source: "manual" }), emptyRow({ drink_from_year: 2026, drink_window_source: "research" })]) {
    const before = { ...row };
    const db = fakeDb({ wine_vintages: [row] });
    await storeDrinkWindow(db as never, W, partial());
    assert.deepEqual(row, before);
    assert.equal(db.writes.length, 0);
  }
});

test("Fehler beim Speichern: kein Absturz, nichts als geprüft markiert – Lücke bleibt für den nächsten Lauf", async () => {
  const wines = [{ id: W, name: "Abstract", producer: "Orin Swift", country: "USA", region: "California", appellation: null, type: "red", alcohol_content: null, grapes: [], researched_at: null }];
  const broken = { from: () => { throw new Error("db down"); } };
  const log = quietErrors();
  try {
    await storeDrinkWindow(broken as never, W, partial());
  } finally {
    log.restore();
  }
  assert.equal(log.errors.length, 1);
  assert.equal(wines[0].researched_at, null);
  // Recherche (Umfang „alle“, verkostet ohne Bestand): Trinkfenster 2022 fehlt weiterhin.
  const gaps = wineGaps(wines[0], { items: [{ wine_id: W, vintage_year: 2022, status: "tasted" }], vintages: [emptyRow()], shares: [] }, "all");
  assert.ok(gaps?.gaps.includes("window"));
});

test("Geschmacksprofil-Teil ohne sources: kein Absturz, nichts übernommen", () => {
  const raw = { matches_wine: true, same_vintage: true };
  assert.equal(readTasteResearch(raw, { wine: { name: "Abstract", producer: "Orin Swift", type: "red" } as never, year: 2022, documents: [] }), null);
});
