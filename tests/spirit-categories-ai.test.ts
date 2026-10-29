// Spirituosen-Kategorien für Antoine aus spirit_categories (nicht fest im Code): neue bzw.
// umbenannte Kategorie erscheint im Schema/Prompt ohne Code-Änderung, DB-Fehler → feste Liste,
// Zwischenspeicher (5 Min.) verhindert wiederholte Abfragen. Stubs – ohne DB, Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { claudeText, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_CATEGORIES_TTL_MS, clearAiCategoryCache, spiritCategoriesForAi } from "@/lib/spirits/load";
import { FALLBACK_CATEGORIES, MAX_ENUM, spiritLabelSchema, subcategoryText } from "@/lib/spirits/ai-categories";
import { spiritResearchSchema } from "@/lib/spirits/research";
import { parseTextEntry } from "@/lib/ingest/recognize";
import type { SpiritCategory } from "@/lib/spirits/categories";

let reads = 0;
let broken = false;
let lastBody: Record<string, unknown> = {};
const ENTRY = {
  name: "Kirsch", producer: "Etter", vintage_year: null, country: null, region: null, appellation: null, type: "spirit", grape_shares: [], alcohol_content: null, bottle_size_ml: 700, best_before: "",
  purchase: { quantity: 1, storage_room: "", price: 0, regular_price: 0, vendor: "", gift: false, gift_from: "" },
  spirit: { kind: "spirit", category: "Sake", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 },
};
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  fail: (method, table) => {
    if (table !== "spirit_categories") return null;
    reads++;
    return broken ? { status: 500, body: { message: "kaputt" } } : null;
  },
  claude: (body) => {
    lastBody = body;
    return claudeText(ENTRY);
  },
};
installNet(net);
const db = createAdminClient();

const row = (id: string, name: string, sort: number, parent: string | null = null) => ({ id, name, sort_order: sort, parent_id: parent });
function reset(rows = [row("w", "Whisky", 10), row("b", "Bourbon", 10, "w"), row("l", "Likör", 20), row("a", "Andere", 90)]) {
  net.tables = { spirit_categories: rows };
  reads = 0;
  broken = false;
  clearAiCategoryCache();
}
const mainsOf = (cats: SpiritCategory[]) => {
  const json = z.toJSONSchema(spiritLabelSchema(cats)) as unknown as { properties: { category: { enum?: string[]; description?: string } } };
  return json.properties.category;
};

test("Neue Kategorie in der DB → im Schema (enum) und in der Prompt-Liste, sortiert nach sort_order", async () => {
  reset([row("w", "Whisky", 10), row("b", "Bourbon", 10, "w"), row("s", "Sake", 15), row("l", "Likör", 20), row("j", "Junmai", 10, "s")]);
  const { categories, fromDb } = await spiritCategoriesForAi(db);
  assert.equal(fromDb, true);
  const cat = mainsOf(categories);
  assert.deepEqual(cat.enum, ["", "Whisky", "Sake", "Likör"]);
  assert.match(cat.description!, /Whisky, Sake, Likör/);
  assert.equal(subcategoryText(categories), "Whisky: Bourbon; Sake: Junmai");
  // Recherche: Kategorie „Sake › Junmai“ wählbar
  const research = z.toJSONSchema(spiritResearchSchema(categories)) as unknown as { properties: { category: { enum: string[] } } };
  assert.ok(research.properties.category.enum.includes("Sake › Junmai"));
});

test("Erkennung per Text: Schema an Claude mit den Kategorien aus der DB; unbekannter Name wird trotzdem eingelesen", async () => {
  reset([row("w", "Whisky", 10), row("o", "Obstbrand", 20), row("k", "Kirsch", 10, "o"), row("s", "Sake", 30)]);
  const result = await parseTextEntry("1 Flasche Etter Kirsch");
  // Das SDK schreibt das enum für die strukturierte Ausgabe in die Beschreibung („{enum: […]}“).
  const format = (lastBody.output_config as { format: { schema: { properties: { spirit: { properties: { category: { description: string }; subcategory: { description: string } } } } } } }).format;
  const category = format.schema.properties.spirit.properties.category.description;
  assert.match(category, /Whisky, Obstbrand, Sake/);
  assert.match(category, /\{enum: \["","Whisky","Obstbrand","Sake"\]\}/);
  assert.match(format.schema.properties.spirit.properties.subcategory.description, /Obstbrand: Kirsch/);
  assert.equal(result.spirit?.category, "Sake");
});

test("Umbenannte Kategorie → nach Ablauf des Zwischenspeichers der neue Name", async () => {
  reset();
  const t0 = 1_000_000;
  assert.ok(mainsOf((await spiritCategoriesForAi(db, t0)).categories).enum!.includes("Likör"));
  net.tables.spirit_categories = [row("w", "Whisky", 10), row("l", "Liköre & Cremes", 20)];
  assert.ok(mainsOf((await spiritCategoriesForAi(db, t0 + 60_000)).categories).enum!.includes("Likör"), "innert 5 Min. aus dem Zwischenspeicher");
  const later = mainsOf((await spiritCategoriesForAi(db, t0 + AI_CATEGORIES_TTL_MS + 1)).categories).enum!;
  assert.ok(later.includes("Liköre & Cremes") && !later.includes("Likör"));
});

test("Zwischenspeicher: wiederholte Aufrufe fragen die DB nur einmal", async () => {
  reset();
  const t0 = 2_000_000;
  for (let i = 0; i < 5; i++) await spiritCategoriesForAi(db, t0 + i * 1000);
  assert.equal(reads, 1);
});

test("DB-Fehler bzw. leere Tabelle → feste Liste, Ablauf läuft weiter (nicht zwischengespeichert)", async () => {
  reset();
  broken = true;
  const failed = await spiritCategoriesForAi(db, 3_000_000);
  assert.deepEqual([failed.fromDb, failed.categories], [false, FALLBACK_CATEGORIES]);
  assert.ok(mainsOf(failed.categories).enum!.includes("Grappa / Trester"));
  broken = false;
  assert.equal((await spiritCategoriesForAi(db, 3_000_001)).fromDb, true, "nach dem Fehler wieder aus der DB");
  reset([]);
  assert.equal((await spiritCategoriesForAi(db)).fromDb, false);
  // Erkennung läuft auch mit kaputter DB
  reset();
  broken = true;
  const parsed = await parseTextEntry("1 Flasche Etter Kirsch");
  assert.equal(parsed.proposal.name, "Etter Kirsch");
});

test("Sehr viele Hauptkategorien → Text statt enum (Grenze der strukturierten Ausgabe)", () => {
  const many = Array.from({ length: MAX_ENUM + 5 }, (_, i) => ({ id: `c${i}`, parentId: null, name: `Kat ${i}`, sortOrder: i }));
  const cat = mainsOf(many);
  assert.equal(cat.enum, undefined);
  assert.match(cat.description!, /Kat 0, Kat 1/);
});
