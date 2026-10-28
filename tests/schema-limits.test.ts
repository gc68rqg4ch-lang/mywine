// Die Claude API lehnt Schemas mit mehr als 16 nullable/Union-Feldern ab (400 invalid_request_error).
// Dieser Test prüft alle Schemas des Bots, damit das nicht unbemerkt wieder passiert.
// Ausführen: npm test
import assert from "node:assert/strict";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MAX_UNION_PARAMS, countUnionParams, strictSchemaProblems } from "@/lib/ai/schema-limits";
import { NOT_MENTIONED, extractionSchema, toExtraction } from "@/lib/tasting/extract";
import { EnrichmentSchema, toolInputSchema } from "@/lib/ingest/recognize";
import { GrapeResearchSchema } from "@/lib/grapes/research";
import { RecognitionSchema, TastedTextSchema, TextEntrySchema, WineProposalSchema } from "@/lib/ingest/schema";
import { SAT_TYPES, newTastingData } from "@/lib/tasting/sat";
import { applyExtraction, missingCategories } from "@/lib/tasting/bot-draft";
import { chatTools } from "@/lib/chat/tools";
import { tasteResearchSchema } from "@/lib/research/taste";

// Zähler selbst: nullable und anyOf zählen, verschachtelt auch
assert.equal(countUnionParams({ type: "object", properties: { a: { type: ["string", "null"] }, b: { anyOf: [{ type: "string" }, { type: "null" }] }, c: { type: "object", properties: { d: { type: ["number", "null"] } } } } }), 3);

const outputFormat = (s: unknown) => (betaZodOutputFormat(s as never) as { schema: unknown }).schema;
const counts: [string, number][] = [
  ...SAT_TYPES.map(({ type }) => [`Verkostung ${type}`, countUnionParams(outputFormat(extractionSchema(type)))] as [string, number]),
  ["Foto-Erkennung", countUnionParams(outputFormat(RecognitionSchema))],
  ["Foto-Korrektur", countUnionParams(outputFormat(WineProposalSchema))],
  ["Erfassung per Text", countUnionParams(outputFormat(TextEntrySchema))],
  ["Verkostet per Text", countUnionParams(outputFormat(TastedTextSchema))],
  ["Websuche Stammdaten (strict)", countUnionParams(toolInputSchema(EnrichmentSchema))],
  ["Websuche Rebsorten (strict)", countUnionParams(toolInputSchema(GrapeResearchSchema))],
  // Geschmacksprofil: eigener Aufruf, Merkmale als enum mit „unbekannt“ – ganz ohne Unions.
  ...SAT_TYPES.map(({ type }) => [`Websuche Geschmacksprofil ${type} (strict)`, countUnionParams(toolInputSchema(tasteResearchSchema(type)))] as [string, number]),
  ["Chat-Tools gesamt", chatTools({} as never, []).reduce((s, t) => s + countUnionParams((t as { input_schema?: unknown }).input_schema), 0)],
];
console.log(counts.map(([n, c]) => `${n}: ${c}`).join("\n"));
for (const [name, count] of counts) assert.ok(count <= MAX_UNION_PARAMS, `${name}: ${count} > ${MAX_UNION_PARAMS}`);
// Strict: Schlüsselwörter, die die API bei strict ablehnt (400 „properties maximum, minimum are not
// supported“) – minimum/maximum (auch aus z.number().int()), exclusive*, multipleOf, min/maxLength,
// maxItems, minItems > 1, fremde formats, Regex mit Rückverweis/Lookaround/Wortgrenze, additionalProperties ≠ false.
assert.deepEqual(
  strictSchemaProblems({ type: "object", additionalProperties: false, properties: { minimum: { type: "integer", minimum: 0 }, s: { type: "string", maxLength: 3, pattern: "^a\\bb$" }, a: { type: "array", minItems: 2, items: {} } } }),
  [".properties.minimum.minimum", ".properties.s.maxLength", ".properties.s.pattern", ".properties.a.minItems=2"],
  "Prüfer erkennt die Schlüsselwörter (Feldnamen zählen nicht)",
);
// So entstand der Fehler: z.number().int() erzeugt minimum/maximum (sichere Ganzzahl-Grenzen).
assert.ok(strictSchemaProblems(toolInputSchema(z.object({ year: z.number().int() }))).length > 0);
const strictSchemas: [string, unknown][] = [
  ["Websuche Stammdaten (strict Tool)", toolInputSchema(EnrichmentSchema)],
  ["Websuche Rebsorten (strict Tool)", toolInputSchema(GrapeResearchSchema)],
  ...SAT_TYPES.map(({ type }) => [`Websuche Geschmacksprofil ${type} (strict Tool)`, toolInputSchema(tasteResearchSchema(type))] as [string, unknown]),
  ...SAT_TYPES.map(({ type }) => [`Verkostung ${type} (strukturierte Ausgabe)`, outputFormat(extractionSchema(type))] as [string, unknown]),
  ["Foto-Erkennung (strukturierte Ausgabe)", outputFormat(RecognitionSchema)],
  ["Foto-Korrektur (strukturierte Ausgabe)", outputFormat(WineProposalSchema)],
  ["Erfassung per Text (strukturierte Ausgabe)", outputFormat(TextEntrySchema)],
  ["Verkostet per Text (strukturierte Ausgabe)", outputFormat(TastedTextSchema)],
];
for (const [name, schema] of strictSchemas) {
  const problems = strictSchemaProblems(schema);
  assert.deepEqual(problems, [], `${name}: bei strict nicht unterstützt: ${problems.join(", ")}`);
}
// Chat-Tools sind nicht strict (dort sind Grenzen wie maxLength erlaubt). Melden, und sicherstellen,
// dass keines strict wird, solange es solche Schlüsselwörter enthält.
for (const tool of chatTools({} as never, []) as { name: string; strict?: boolean; input_schema: unknown }[]) {
  const problems = strictSchemaProblems(tool.input_schema);
  if (problems.length) console.log(`Hinweis ${tool.name} (nicht strict): ${problems.length} Schlüsselwörter, die strict nicht kennt`);
  assert.ok(!tool.strict || problems.length === 0, `${tool.name} ist strict, enthält aber ${problems.join(", ")}`);
}

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
// Geschmacksprofil: null-frei (Unions = 0), Merkmale mit „unbekannt“ als enum-Wert.
for (const { type } of SAT_TYPES) {
  const schema = toolInputSchema(tasteResearchSchema(type)) as { properties: { fields: { properties: Record<string, { enum: string[] }> } } };
  assert.equal(countUnionParams(schema), 0, `Geschmacksprofil ${type}: keine nullable Felder`);
  for (const [key, field] of Object.entries(schema.properties.fields.properties)) assert.equal(field.enum[0], "unbekannt", key);
}
