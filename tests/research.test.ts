// Recherche pro Wein: Lücken im Keller/alle und vollständiges Ergänzen in einem Durchgang,
// ohne Vorhandenes zu überschreiben. Claude und Supabase per fetch-Stub. Ausführen: npm test
import assert from "node:assert/strict";
import { claudeTool, installNet, type Net } from "./stub-net";

Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub",
  SUPABASE_SECRET_KEY: "stub",
  ANTHROPIC_API_KEY: "stub",
});

const W = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const W3 = "33333333-3333-4333-8333-333333333333";
const prompts: string[] = [];
const net: Net = {
  tables: {
    wines: [
      { id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: null, type: "red", alcohol_content: null, grapes: [] },
      { id: W3, name: "Macan", producer: "Benjamin de Rothschild", country: "Spanien", region: "Rioja", appellation: "DOCa Rioja", type: "red", alcohol_content: null, grapes: ["Tempranillo"] },
      { id: W2, name: "Alion", producer: "Vega Sicilia", country: "Spanien", region: "Ribera", appellation: "DO Ribera del Duero", type: "red", alcohol_content: 14.5, grapes: [] },
    ],
    inventory_items: [
      { wine_id: W, vintage_year: 2019, status: "sealed" },
      { wine_id: W, vintage_year: 2016, status: "drunk" },
      { wine_id: W2, vintage_year: 2018, status: "drunk" },
      { wine_id: W3, vintage_year: 2017, status: "sealed" },
    ],
    wine_vintages: [
      { id: "v1", wine_id: W, vintage_year: 2019, drink_from_year: 2025, drink_until_year: null },
      { id: "v2", wine_id: W2, vintage_year: 2018, drink_from_year: 2022, drink_until_year: 2035 },
    ],
    wine_grape_shares: [
      { wine_id: W, vintage_year: null, grape: "Tinta de Toro", percent: null, source: "import" },
      { wine_id: W2, vintage_year: 2018, grape: "Tempranillo", percent: 100, source: "research" },
    ],
  },
  telegram: [],
  rpc: {},
  claude: (body) => {
    const prompt = String((body.messages as { content: string }[])[0].content);
    prompts.push(prompt);
    if (prompt.includes("Macan")) {
      // Ungültige Werte: werden verworfen statt gespeichert
      return claudeTool("report_wine_details", {
        producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: 40,
        vintages: [{ vintage_year: 2017, drink_from_year: 1700, drink_until_year: 2017.5, grapes: [{ grape: "Tempranillo", percent: 140 }], percentages_for_vintage: true }],
        sources: ["javascript:alert(1)"],
      });
    }
    return claudeTool("report_wine_details", {
      producer: "Anderer Produzent", country: "Italien", region: "Falsch", appellation: "DO Toro", type: "white", alcohol_content: 14,
      vintages: [{ vintage_year: 2019, drink_from_year: 2020, drink_until_year: 2032, grapes: [{ grape: "Tinta de Toro", percent: 100 }], percentages_for_vintage: true }],
      sources: ["https://pintia.example/ficha"],
    });
  },
};
const grapeCalls: Record<string, unknown>[] = [];
net.rpc.replace_grape_shares = (args) => {
  grapeCalls.push(args);
  return [];
};
installNet(net);

(async () => {
  const { wineGaps, gapCounts, needsResearch } = await import("@/lib/research/gaps");
  const { researchAndFillWine, loadGapData } = await import("@/lib/research/wine");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Lücken: im Keller nur Pintia 2019; „alle“ auch 2016 und Alion (dort fehlt nichts)
  const data = await loadGapData(db);
  const pintia = data.wines.find((w) => w.id === W)!;
  const cellar = wineGaps(pintia, data, "cellar")!;
  assert.deepEqual(cellar.gaps, ["grapePercent", "alcohol", "window", "origin"]);
  assert.deepEqual(cellar.vintages.map((v) => v.year), [2019]);
  assert.deepEqual(wineGaps(pintia, data, "all")!.vintages.map((v) => v.year), [2019, 2016]);
  assert.equal(wineGaps(data.wines.find((w) => w.id === W2)!, data, "cellar"), null, "Alion ist nicht im Keller");
  assert.equal(needsResearch(wineGaps(data.wines.find((w) => w.id === W2)!, data, "all")!), false);
  assert.deepEqual(gapCounts([cellar]), { grapePercent: 1, grapes: 0, alcohol: 1, window: 1, origin: 1 });

  // Ein Durchgang, nur Lücken gefragt; Vorhandenes bleibt, Leeres wird ergänzt
  const outcome = await researchAndFillWine(db, W, "cellar");
  assert.equal(prompts.length, 1, "genau eine Web-Recherche pro Wein");
  const asked = prompts[0].split("Bekannte Angaben")[0];
  assert.match(asked, /- Appellation/); assert.match(asked, /- Alkohol/);
  assert.doesNotMatch(asked, /- Region|- Land|- Typ|- Produzent/);
  assert.match(asked, /Jahrgang 2019: Trinkfenster ab\/bis, Rebsorten mit Prozent/);
  assert.doesNotMatch(asked, /Jahrgang 2016/, "getrunkene Jahrgänge nur bei „alle“");

  const wine = net.tables.wines.find((w) => w.id === W)!;
  assert.deepEqual([wine.producer, wine.country, wine.region, wine.type], ["Vega Sicilia", "Spanien", "Toro", "red"], "nie überschreiben");
  assert.deepEqual([wine.appellation, wine.alcohol_content], ["DO Toro", 14]);
  const v19 = net.tables.wine_vintages.find((v) => v.id === "v1")!;
  assert.deepEqual([v19.drink_from_year, v19.drink_until_year], [2025, 2032], "„ab“ bleibt, „bis“ wird ergänzt");
  assert.equal(grapeCalls.length, 1);
  assert.equal(grapeCalls[0].p_vintage_year, 2019);
  assert.deepEqual(grapeCalls[0].p_shares, [{ grape: "Tinta de Toro", percent: 100, sort_order: 0, source: "research" }]);
  assert.equal(outcome.status, "filled");
  assert.deepEqual(outcome.filled, ["Appellation", "Alkohol", "Trinkfenster 2019 (2025–2032)", "Rebsorten 2019 mit %: Tinta de Toro 100 %"]);

  // Ungültige Antwort (Alkohol 40 %, Jahr 1700, 2017.5, 140 %): nichts gespeichert
  const before = grapeCalls.length;
  const invalid = await researchAndFillWine(db, W3, "cellar");
  assert.equal(invalid.status, "nothing", JSON.stringify(invalid));
  assert.equal(net.tables.wines.find((w) => w.id === W3)!.alcohol_content, null);
  assert.equal(net.tables.wine_vintages.some((v) => v.wine_id === W3), false);
  assert.equal(grapeCalls.length, before, "140 % → ohne Anteil; vorhandene Rebsorten ohne % werden nicht ersetzt");
  prompts.length = 1;

  // Vollständiger Wein: keine Recherche
  const complete = await researchAndFillWine(db, W2, "all");
  assert.equal(complete.status, "complete"); assert.equal(prompts.length, 1);
  console.log("research tests ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
