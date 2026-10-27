// „ℹ️ Details“ im Bot: Dokumente werden mit Anzahl und Link zur Weinseite erwähnt. Ausführen: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { wineDetailsText, type WineDetails } from "../src/lib/chat/details";

const base: WineDetails = {
  name: "Pintia", producer: "Vega Sicilia", type: "red", year: 2019, country: "Spanien", region: "Toro", appellation: null,
  alcohol: 14.5, grapes: null, drinkFrom: null, drinkUntil: null, bottles: [], ratings: [], lastTasting: null,
  appUrl: "https://mywine.example/wein/w?jahrgang=2019",
};

test("Dokumente: Anzahl mit Link, ohne Dokumente keine Zeile", () => {
  assert.match(wineDetailsText({ ...base, documents: 2 }), /📄 2 Dokumente – <a href="https:\/\/mywine\.example\/wein\/w\?jahrgang=2019">auf der Weinseite<\/a>/);
  assert.match(wineDetailsText({ ...base, documents: 1 }), /📄 1 Dokument –/);
  assert.doesNotMatch(wineDetailsText({ ...base, documents: 0 }), /📄/);
  assert.doesNotMatch(wineDetailsText(base), /📄/);
});
