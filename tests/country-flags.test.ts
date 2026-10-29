import { test } from "node:test";
import assert from "node:assert/strict";
import { countryCode, countryFlag, originLabel, originParts } from "../src/lib/cellar/overview";

test("Flaggen für alle Länder aus Intl.DisplayNames", () => {
  assert.equal(countryFlag("Venezuela"), "🇻🇪");
  assert.equal(countryFlag("Kuba"), "🇨🇺");
  assert.equal(countryFlag("Jamaika"), "🇯🇲");
  assert.equal(countryFlag("Barbados"), "🇧🇧");
  assert.equal(countryFlag("Irland"), "🇮🇪");
  assert.equal(countryFlag("Japan"), "🇯🇵");
  assert.equal(countryFlag("Schweiz"), "🇨🇭");
  assert.equal(countryFlag("  spanien "), "🇪🇸");
});

test("Aliasse und Schreibweisen", () => {
  assert.equal(countryFlag("USA"), "🇺🇸");
  assert.equal(countryFlag("Vereinigte Staaten"), "🇺🇸");
  assert.equal(countryFlag("Großbritannien"), "🇬🇧");
  assert.equal(countryFlag("Grossbritannien"), "🇬🇧");
  assert.equal(countryFlag("Vereinigtes Königreich"), "🇬🇧");
  assert.equal(countryFlag("Côte d'Ivoire"), "🇨🇮");
  assert.equal(countryFlag("Elfenbeinküste"), "🇨🇮");
  assert.equal(countryFlag("Holland"), "🇳🇱");
  assert.equal(countryFlag("Tschechei"), "🇨🇿");
  assert.equal(countryFlag("Moldawien"), "🇲🇩");
  assert.equal(countryCode("österreich"), "AT");
});

test("Schottland, Wales, England eigene Flaggen; Nordirland 🇬🇧", () => {
  assert.equal(countryFlag("Schottland"), "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}");
  assert.equal(countryFlag("Wales"), "🏴\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}");
  assert.equal(countryFlag("England"), "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}");
  assert.equal(countryFlag("Nordirland"), "🇬🇧");
});

test("unbekannt → null", () => {
  assert.equal(countryFlag("Atlantis"), null);
  assert.equal(countryFlag(""), null);
  assert.equal(countryFlag(null), null);
  assert.equal(countryFlag("Europa"), null);
});

test("Kartenzeile: Flagge Land · Region; ohne Region nur das Land; Region = Land nur einmal", () => {
  // Spirituose (Diplomático) und Wein
  assert.equal(originLabel({ country: "Venezuela", region: "Lara" }), "🇻🇪 Venezuela · Lara");
  assert.equal(originLabel({ country: "Spanien", region: "Rioja" }), "🇪🇸 Spanien · Rioja");
  assert.equal(originLabel({ country: "Schottland", region: "Islay" }), `${countryFlag("Schottland")} Schottland · Islay`);
  assert.equal(originLabel({ country: "Spanien", region: null }), "🇪🇸 Spanien");
  assert.equal(originLabel({ country: "Venezuela", region: " " }), "🇻🇪 Venezuela");
  // ohne Flagge gleiches Format
  assert.equal(originLabel({ country: "Atlantis", region: "Lara" }), "Atlantis · Lara");
  assert.equal(originLabel({ country: "Atlantis", region: null }), "Atlantis");
  // Region gleich Land
  assert.equal(originLabel({ country: "Barbados", region: "Barbados" }), "🇧🇧 Barbados");
  assert.equal(originLabel({ country: "Schweiz", region: "schweiz" }), "🇨🇭 Schweiz");
  // ohne Land
  assert.equal(originLabel({ country: null, region: "Lara" }), "Lara");
  assert.equal(originLabel({ country: null, region: null }), null);
  // getrennt für die Karte: Land nie abgeschnitten, Region schon
  assert.deepEqual(originParts({ country: "Venezuela", region: "Lara" }), { country: "🇻🇪 Venezuela", region: "Lara" });
  assert.deepEqual(originParts({ country: "Kuba", region: "Kuba" }), { country: "🇨🇺 Kuba", region: null });
});
