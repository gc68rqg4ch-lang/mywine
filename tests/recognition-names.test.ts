// Erkennung: keine Standardgrösse (Rückfrage statt 0,7 l), Name vollständig (Liqueur, Holzfass),
// Spirituosen mit Marke, wenn sie Teil des Produktnamens ist, Wein ohne Produzent; Alkohol nur vom
// Etikett. Rein bzw. mit Prompt-Texten – ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProposal, parseSizeAnswer, type WineProposal } from "@/lib/ingest/schema";
import { completeSpiritName } from "@/lib/ingest/wine-names";
import { FULL_NAME_RULE, SIZE_ALCOHOL_RULE, SPIRIT_NAME_RULE } from "@/lib/ingest/recognize";

const p = (x: Partial<WineProposal>): WineProposal => ({
  name: null, producer: null, vintage_year: null, country: null, region: null, appellation: null, type: null, grape_shares: [], alcohol_content: null, bottle_size_ml: null, ...x,
});

test("Keine Standardgrösse: Spirituose ohne lesbare Grösse bleibt ohne (Rückfrage), Name mit «Liqueur»/«Holzfass» vollständig", () => {
  const holz = normalizeProposal(p({ name: "Pflaumenbrand Holzfass", producer: "Urs Hecht", type: "spirit" }));
  assert.deepEqual([holz.name, holz.bottle_size_ml], ["Pflaumenbrand Holzfass", null]);
  assert.equal(normalizeProposal(p({ name: "Williamsbrand Liqueur", producer: "Urs Hecht", type: "spirit" })).name, "Williamsbrand Liqueur");
  assert.equal(normalizeProposal(p({ name: "Pintia", producer: "Vega Sicilia", type: "red" })).bottle_size_ml, null, "auch Wein: keine 0,75 l");
  assert.equal(normalizeProposal(p({ name: "X", type: "spirit", bottle_size_ml: 500 })).bottle_size_ml, 500);
  // Alkohol nur vom Etikett: 0 = nicht lesbar → leer
  assert.equal(normalizeProposal(p({ name: "X", type: "spirit", alcohol_content: 0 })).alcohol_content, null);
  assert.equal(normalizeProposal(p({ name: "X", type: "spirit", alcohol_content: 38 })).alcohol_content, 38);
});

test("Grösse getippt: 50 cl, 500 ml, 0,5 l, 0,7, 50, 750, 1,5", () => {
  assert.deepEqual(["50 cl", "500 ml", "0,5 l", "0,7", "50", "750", "1,5", "1 l"].map(parseSizeAnswer), [500, 500, 500, 700, 500, 750, 1500, 1000]);
  assert.equal(parseSizeAnswer("zwei"), null);
  assert.equal(parseSizeAnswer("0"), null);
});

test("Spirituose: Marke im Namen, wenn sie Teil des Produktnamens ist; nicht doppeln; Wein ohne Produzent", () => {
  assert.equal(normalizeProposal(p({ name: "Vanilla", producer: "Galliano", type: "spirit" })).name, "Galliano Vanilla");
  assert.equal(completeSpiritName("Lunar", "Hendrick's"), "Hendrick's Lunar");
  assert.equal(completeSpiritName("Gin Rosa", "Malfy"), "Malfy Gin Rosa");
  assert.equal(completeSpiritName("Very Special", "Hennessy"), "Hennessy Very Special");
  assert.equal(completeSpiritName("Amaretto", "Paolo Lazzaroni & Figli"), "Lazzaroni Amaretto");
  assert.equal(completeSpiritName("Reserva Exclusiva", "Diplomático"), "Diplomático Reserva Exclusiva");
  // Marke schon im Namen bzw. Person/Brennerei als Produzent: unverändert
  assert.equal(completeSpiritName("Blanton's Original Single Barrel", "Blanton's"), "Blanton's Original Single Barrel");
  assert.equal(completeSpiritName("Blanton's Original Single Barrel", "Buffalo Trace Distillery"), "Blanton's Original Single Barrel");
  assert.equal(completeSpiritName("Maker's Mark No. 46", "Maker's Mark"), "Maker's Mark No. 46");
  assert.equal(completeSpiritName("Hennessy Very Special", "Hennessy"), "Hennessy Very Special");
  assert.equal(completeSpiritName("Pflaumenbrand Holzfass", "Urs Hecht"), "Pflaumenbrand Holzfass");
  assert.equal(completeSpiritName("Noah's Mill", "Willett Distillery"), "Noah's Mill");
  // Wein bleibt ohne Produzent
  assert.equal(normalizeProposal(p({ name: "Pintia", producer: "Vega Sicilia", type: "red" })).name, "Pintia");
});

test("Prompt: Beispiele für vollständige Namen, Spirituosen mit Marke, keine Standardgrösse, kein geschätzter Alkohol", () => {
  assert.match(FULL_NAME_RULE, /Pflaumenbrand Holzfass/);
  assert.match(FULL_NAME_RULE, /Williamsbrand Liqueur/);
  for (const name of ["Galliano Vanilla", "Hendrick's Lunar", "Malfy Gin Rosa", "Hennessy Very Special", "Lazzaroni Amaretto", "Diplomático Reserva Exclusiva", "Blanton's Original Single Barrel", "Pintia"]) {
    assert.ok(SPIRIT_NAME_RULE.includes(name), name);
  }
  assert.match(SIZE_ALCOHOL_RULE, /keine Standardgrösse/);
  assert.match(SIZE_ALCOHOL_RULE, /keinen Alkoholgehalt schätzen/);
});
