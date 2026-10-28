// Geschmacksprofil: Rotwein (wines.type = 'red') ohne gefundene Süsse gilt als „trocken“ – mit
// Regel-Beleg „regel:rotwein-trocken“ (gültiger Beleg, keine Quelle). Belegte Süsse gilt, andere
// Typen unverändert, Profil von Hand bleibt. Claude und Supabase per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine } from "@/lib/research/wine";
import { autoTasteProfile } from "@/lib/research/taste-auto";
import { RED_DRY_EVIDENCE, RED_DRY_REF, UNKNOWN, isRuleEvidence, validateTasteProfile, type TasteResearchRaw } from "@/lib/taste/profile";

const W = "11111111-1111-4111-8111-111111111111";
const SRC = "https://pintia.example/ficha-2019";
const unknownFields = { sweetness: UNKNOWN, acidity: UNKNOWN, tannin: UNKNOWN, alcohol: UNKNOWN, body: UNKNOWN, flavour_intensity: UNKNOWN, finish: UNKNOWN };
const raw = (x: Partial<TasteResearchRaw> = {}): TasteResearchRaw => ({
  matches_wine: true, same_vintage: true,
  sources: [{ url: SRC, title: "Ficha", kind: "producer", vintage: 2019 }],
  fields: { ...unknownFields, body: "voll" },
  aromas: [], evidence: [{ field: "body", source_url: SRC, quote: "full-bodied" }],
  contradictions: [], style_summary: "", food_pairing: [],
  ...x,
});
const redCtx = { type: "rot" as const, year: 2019, wineType: "red" };

let reply: TasteResearchRaw = raw();
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    if (tools.includes("report_taste_profile")) return claudeTool("report_taste_profile", reply);
    if (tools.includes("report_wine_details")) {
      return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
installNet(net);
const db = createAdminClient();

function reset(type: string, profiles: Record<string, unknown>[] = []) {
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type, alcohol_content: 14.5, grapes: [], researched_at: null }],
    inventory_items: [{ wine_id: W, vintage_year: 2019, status: "sealed" }],
    wine_encounters: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], research_suggestions: [], wine_taste_profiles: profiles,
  };
  reply = raw();
}
const profile = () => net.tables.wine_taste_profiles[0];

test("Prüfung: Rotwein ohne Süsse → trocken mit Regel-Beleg; belegte Süsse gilt; Regel ist keine Quelle", () => {
  const p = validateTasteProfile(raw(), redCtx)!;
  assert.equal(p.values.sweetness, "trocken");
  assert.deepEqual(p.evidence.sweetness, [{ quote: "Standard: Rotwein ohne Angabe gilt als trocken", source_url: "regel:rotwein-trocken" }]);
  assert.ok(isRuleEvidence(p.evidence.sweetness[0]), "Regel-Beleg gilt als Beleg");
  assert.deepEqual(p.sources.map((s) => s.url), [SRC], "nicht als Quelle");
  assert.ok(!p.sources.some((s) => s.url === RED_DRY_REF || s.title.includes("regel")));
  assert.equal(p.confidence, "mittel", "zählt nicht für die Sicherheit");

  const half = validateTasteProfile(raw({ fields: { ...unknownFields, body: "voll", sweetness: "halbtrocken" }, evidence: [...raw().evidence, { field: "sweetness", source_url: SRC, quote: "off-dry" }] }), redCtx)!;
  assert.equal(half.values.sweetness, "halbtrocken");
  assert.deepEqual(half.evidence.sweetness, [{ source_url: SRC, quote: "off-dry" }]);

  assert.equal(validateTasteProfile(raw(), { type: "weiss", year: 2019, wineType: "white" })!.values.sweetness, UNKNOWN, "Weisswein unverändert");
  for (const t of ["rose", "sparkling", "sweet", "fortified", null]) {
    assert.equal(validateTasteProfile(raw(), { type: "weiss", year: 2019, wineType: t })!.values.sweetness, UNKNOWN, String(t));
  }
  assert.equal(validateTasteProfile(raw({ fields: unknownFields, evidence: [] }), redCtx), null, "die Regel allein ergibt kein Profil");
  // Widersprechen sich Quellen bei der Süsse, bleibt sie unbekannt.
  assert.equal(validateTasteProfile(raw({ contradictions: [{ field: "sweetness", note: "x" }] }), redCtx)!.values.sweetness, UNKNOWN);
});

test("Profilsuche (Nachrecherchieren, Sammellauf, automatisch): Rotwein → trocken gespeichert", async () => {
  reset("red");
  assert.equal((await researchAndFillWine(db, W, "all", { taste: "only", year: 2019, skipRecent: false })).taste, "saved");
  assert.equal(profile().sweetness, "trocken");
  assert.deepEqual((profile().evidence as Record<string, unknown>).sweetness, [RED_DRY_EVIDENCE]);
  assert.ok(!(profile().sources as { url: string | null }[]).some((s) => s.url === RED_DRY_REF));

  reset("red");
  assert.equal(await autoTasteProfile(db, W, 2019), "saved");
  assert.equal(profile().sweetness, "trocken");
});

test("Weisswein ohne Süsse bleibt unbekannt", async () => {
  reset("white");
  await researchAndFillWine(db, W, "all", { taste: "only", year: 2019, skipRecent: false });
  assert.equal(profile().sweetness, UNKNOWN);
  assert.equal((profile().evidence as Record<string, unknown>).sweetness, undefined);
});

test("Profil von Hand bleibt unverändert (Fund wird Vorschlag)", async () => {
  const manual = { id: "p1", wine_id: W, vintage_year: 2019, source: "manual", sweetness: UNKNOWN, body: "mittel", aromas: {}, food_pairing: [], sources: [], evidence: {} };
  reset("red", [{ ...manual }]);
  await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  assert.equal(net.tables.wine_taste_profiles.length, 1);
  assert.deepEqual([profile().source, profile().sweetness, profile().body], ["manual", UNKNOWN, "mittel"]);
  assert.deepEqual(profile().evidence, {});
  const suggestion = net.tables.research_suggestions[0];
  assert.equal(suggestion?.field, "taste_profile");
});
