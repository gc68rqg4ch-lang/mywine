// /recherche: schon Recherchiertes 12 Monate überspringen – Wein (wines.researched_at) und
// Geschmacksprofil je Jahrgang (wine_vintages.taste_profile_checked_at, auch ohne Fund).
// Jahrgänge mit Profil nie; „Nachrecherchieren“ ignoriert die Regel; Option aus → alle.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine, loadGapData } from "@/lib/research/wine";
import { autoTasteProfile } from "@/lib/research/taste-auto";
import { RECENT_MONTHS, profileKey, tasteTargets, wineGaps, withinRecentMonths } from "@/lib/research/gaps";

const W = "11111111-1111-4111-8111-111111111111";
const monthsAgo = (m: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString();
};
const tasteCalls: string[] = [];
const fieldCalls: string[] = [];
const noMatch = { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] };
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    const prompt = String((body.messages as { content: string }[])[0].content);
    if (tools.includes("report_taste_profile")) {
      tasteCalls.push(prompt.match(/"jahrgang":(\d{4}|"ohne Jahrgang")/)?.[1] ?? "?");
      return claudeTool("report_taste_profile", noMatch);
    }
    fieldCalls.push(prompt);
    return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
  },
};
installNet(net);
const db = createAdminClient();

/** Pintia mit Flaschen 2016, 2018 und 2019; 2019 hat ein Profil, 2018 wurde vor 2 Monaten erfolglos gesucht, 2016 vor 14 Monaten. */
function reset() {
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type: "red", alcohol_content: 14.5, grapes: ["Tinta de Toro"], researched_at: monthsAgo(3) }],
    inventory_items: [2016, 2018, 2019].map((y) => ({ wine_id: W, vintage_year: y, status: "sealed" })),
    wine_encounters: [],
    wine_vintages: [
      { id: "v16", wine_id: W, vintage_year: 2016, drink_from_year: 2020, drink_until_year: 2030, taste_profile_checked_at: monthsAgo(14) },
      { id: "v18", wine_id: W, vintage_year: 2018, drink_from_year: 2022, drink_until_year: 2032, taste_profile_checked_at: monthsAgo(2) },
      { id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: 2023, drink_until_year: 2033, taste_profile_checked_at: monthsAgo(1) },
    ],
    wine_grape_shares: [], research_suggestions: [],
    wine_taste_profiles: [{ id: "p19", wine_id: W, vintage_year: 2019, source: "research", aromas: {}, food_pairing: [], sources: [], evidence: {} }],
  };
  tasteCalls.length = 0;
  fieldCalls.length = 0;
}
const checked = (y: number) => net.tables.wine_vintages.find((v) => v.vintage_year === y)?.taste_profile_checked_at as string | undefined;

test("Regel: 12 Monate, Jahrgänge mit Profil nie, ohne Option alle ohne Profil", async () => {
  reset();
  assert.equal(RECENT_MONTHS, 12);
  assert.equal(withinRecentMonths(monthsAgo(11)), true);
  assert.equal(withinRecentMonths(monthsAgo(13)), false);
  const data = await loadGapData(db);
  const g = wineGaps(data.wines[0], data, "cellar")!;
  assert.ok(data.profiles.has(profileKey(W, 2019)));
  assert.deepEqual(tasteTargets(g, data, { skipRecent: true }), [2016], "2019 hat ein Profil, 2018 kürzlich gesucht");
  assert.deepEqual(tasteTargets(g, data, { skipRecent: false }), [2018, 2016], "Option aus: alle ohne Profil, neueste zuerst");
});

test("Sammellauf „Geschmacksprofil fehlt“: kürzlich gesuchte Jahrgänge überspringen; erfolglose Suche setzt das Datum", async () => {
  reset();
  const outcome = await researchAndFillWine(db, W, "all", { taste: "only" });
  assert.equal(outcome.tasteYear, 2016);
  assert.deepEqual(tasteCalls, ["2016"]);
  assert.equal(outcome.taste, "none");
  assert.ok(withinRecentMonths(checked(2016)), "auch ohne Fund vermerkt");
  assert.equal(fieldCalls.length, 0, "nur das Profil");
  // Nochmals: jetzt ist alles kürzlich gesucht oder hat ein Profil → nichts
  const again = await researchAndFillWine(db, W, "all", { taste: "only" });
  assert.equal(again.taste, "skipped");
  assert.equal(tasteCalls.length, 1);
  // Option aus: wieder gesucht – aber nie ein Jahrgang mit Profil
  const off = await researchAndFillWine(db, W, "all", { taste: "only", skipRecent: false });
  assert.equal(off.tasteYear, 2018);
  assert.deepEqual(tasteCalls, ["2016", "2018"]);
  assert.ok(!tasteCalls.includes("2019"));
  // Ausdrücklich ein Jahrgang mit Profil im Sammellauf → nicht gesucht
  assert.equal((await researchAndFillWine(db, W, "all", { taste: "only", year: 2019, skipRecent: false })).taste, "skipped");
});

test("Normaler Sammellauf (missing): Profil nur für nicht kürzlich gesuchte Jahrgänge ohne Profil", async () => {
  reset();
  net.tables.wine_vintages.find((v) => v.vintage_year === 2016)!.taste_profile_checked_at = monthsAgo(1);
  const outcome = await researchAndFillWine(db, W, "all", { taste: "missing" });
  assert.equal(fieldCalls.length, 1, "Stammdaten werden gesucht (nur leere Felder)");
  assert.equal(outcome.taste, "skipped");
  assert.equal(tasteCalls.length, 0);
});

test("Nachrecherchieren (🔎) ignoriert die 12-Monats-Regel und setzt das Datum", async () => {
  reset();
  const before = checked(2018);
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2018 });
  assert.deepEqual(tasteCalls, ["2018"], "trotz Suche vor 2 Monaten");
  assert.equal(outcome.taste, "none");
  assert.notEqual(checked(2018), before);
  assert.ok(Date.parse(checked(2018)!) > Date.now() - 60_000);
  // Auch ein Jahrgang mit Profil wird beim Nachrecherchieren gesucht
  await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.deepEqual(tasteCalls, ["2018", "2019"]);
});

test("Automatische Suche: kürzlich ohne Fund gesucht → überspringen; sonst suchen und Datum setzen", async () => {
  reset();
  assert.equal(await autoTasteProfile(db, W, 2018), "recent");
  assert.equal(await autoTasteProfile(db, W, 2019), "exists");
  assert.equal(tasteCalls.length, 0);
  assert.equal(await autoTasteProfile(db, W, 2016), "none", "vor 14 Monaten → wieder suchen");
  assert.ok(withinRecentMonths(checked(2016)));
  // Neuer Jahrgang ohne Zeile in wine_vintages: Zeile wird mit dem Datum angelegt
  assert.equal(await autoTasteProfile(db, W, 2021), "none");
  assert.ok(withinRecentMonths(checked(2021)));
  assert.deepEqual(tasteCalls, ["2016", "2021"]);
});
