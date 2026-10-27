// Die Claude API lehnt Schemas mit mehr als 16 nullable/Union-Feldern ab (400 invalid_request_error).
// Dieser Test prüft alle Schemas des Bots, damit das nicht unbemerkt wieder passiert.
// Ausführen: npm test
import assert from "node:assert/strict";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MAX_UNION_PARAMS, countUnionParams } from "@/lib/ai/schema-limits";
import { NOT_MENTIONED, extractionSchema, toExtraction } from "@/lib/tasting/extract";
import { EnrichmentSchema, toolInputSchema } from "@/lib/ingest/recognize";
import { GrapeResearchSchema } from "@/lib/grapes/research";
import { RecognitionSchema, WineProposalSchema } from "@/lib/ingest/schema";
import { SAT_TYPES, newTastingData } from "@/lib/tasting/sat";
import { applyExtraction, missingCategories } from "@/lib/tasting/bot-draft";
import { chatTools } from "@/lib/chat/tools";

// Zähler selbst: nullable und anyOf zählen, verschachtelt auch
assert.equal(countUnionParams({ type: "object", properties: { a: { type: ["string", "null"] }, b: { anyOf: [{ type: "string" }, { type: "null" }] }, c: { type: "object", properties: { d: { type: ["number", "null"] } } } } }), 3);

const outputFormat = (s: unknown) => (betaZodOutputFormat(s as never) as { schema: unknown }).schema;
const counts: [string, number][] = [
  ...SAT_TYPES.map(({ type }) => [`Verkostung ${type}`, countUnionParams(outputFormat(extractionSchema(type)))] as [string, number]),
  ["Foto-Erkennung", countUnionParams(outputFormat(RecognitionSchema))],
  ["Foto-Korrektur", countUnionParams(outputFormat(WineProposalSchema))],
  ["Websuche Stammdaten (strict)", countUnionParams(toolInputSchema(EnrichmentSchema))],
  ["Websuche Rebsorten (strict)", countUnionParams(toolInputSchema(GrapeResearchSchema))],
  ["Chat-Tools gesamt", chatTools({} as never, []).reduce((s, t) => s + countUnionParams((t as { input_schema?: unknown }).input_schema), 0)],
];
console.log(counts.map(([n, c]) => `${n}: ${c}`).join("\n"));
for (const [name, count] of counts) assert.ok(count <= MAX_UNION_PARAMS, `${name}: ${count} > ${MAX_UNION_PARAMS}`);
// Reserve: die Verkostung braucht gar keine Union-Typen mehr
for (const { type } of SAT_TYPES) assert.equal(countUnionParams(outputFormat(extractionSchema(type))), 0, type);

// Antwort im neuen Format → bisherige Extraction; fehlende Kategorien funktionieren weiter
const raw = extractionSchema("rot").parse({
  fields: {
    klarheit: NOT_MENTIONED, farbtiefe: NOT_MENTIONED, farbton: "rubinrot", reintoenigkeit: NOT_MENTIONED, geruchIntensitaet: "mittel (+)",
    aromaauspraegung: [], entwicklung: NOT_MENTIONED, suesse: "trocken", saeure: "hoch", tannin: NOT_MENTIONED, alkohol: NOT_MENTIONED,
    koerper: NOT_MENTIONED, geschmackIntensitaet: "ausgeprägt", geschmacksauspraegung: ["primär"], abgang: NOT_MENTIONED, trinkreife: NOT_MENTIONED,
  },
  aromas_add: [{ group: "Rote Früchte", aroma: "rote Kirsche" }],
  aromas_remove: [],
  notes: "  ",
});
const x = toExtraction(raw);
assert.equal(x.fields.klarheit, null); assert.equal(x.fields.aromaauspraegung, null); assert.equal(x.notes, null);
assert.equal(x.fields.saeure, "hoch"); assert.deepEqual(x.fields.geschmacksauspraegung, ["primär"]);
const sat = applyExtraction(newTastingData({ name: "P", producer: "T", region: null, country: null, type: "red" }, 2022, "", "2026-10-27"), x);
assert.equal(sat.fields.saeure, "hoch"); assert.equal(sat.fields.klarheit, undefined, "nicht Erwähntes bleibt leer");
assert.deepEqual(missingCategories(sat), ["Abgang", "Entwicklungsstadium", "Tannin", "Körper", "Trinkreife"]);
assert.throws(() => extractionSchema("rot").parse({ ...raw, fields: { ...raw.fields, saeure: null } }), "null ist kein gültiger Wert mehr");
console.log("schema limit tests ok");
