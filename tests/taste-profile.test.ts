// Geschmacksprofil aus der Recherche – oberstes Ziel: kein falsches Profil. Werte ohne Beleg
// fallen weg, unklare Aromen ebenso, Widersprüche → „unbekannt“, keine Quelle → kein Profil
// (Bestehendes bleibt), Profil von Hand wird nicht überschrieben (Vorschlag), Bearbeiten in der
// App, Zeile im Bot. Claude und Supabase per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  NO_RELIABLE_PROFILE,
  UNKNOWN,
  confidenceFor,
  tasteLine,
  tasteSourceLine,
  validateTasteProfile,
  type TasteResearchRaw,
} from "@/lib/taste/profile";
import { researchAndFillWine } from "@/lib/research/wine";
import { decideSuggestion, loadPendingSuggestions } from "@/lib/research/suggestions";
import { applyEdit } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import { loadTasteProfile } from "@/lib/taste/store";
import { wineDetailsText } from "@/lib/chat/details";

const W = "11111111-1111-4111-8111-111111111111";
const PRODUCER = "https://pintia.example/ficha";
const CRITIC = "https://critic.example/pintia-2019";
const SHOP = "https://shop.example/pintia";

const unknownFields = { sweetness: UNKNOWN, acidity: UNKNOWN, tannin: UNKNOWN, alcohol: UNKNOWN, body: UNKNOWN, flavour_intensity: UNKNOWN, finish: UNKNOWN };
const raw = (x: Partial<TasteResearchRaw> = {}): TasteResearchRaw => ({
  matches_wine: true,
  same_vintage: true,
  sources: [
    { url: PRODUCER, title: "Ficha técnica", kind: "producer", vintage: 2019 },
    { url: CRITIC, title: "Kritik", kind: "critic", vintage: 2019 },
  ],
  fields: { ...unknownFields, body: "voll", sweetness: "trocken", tannin: "hoch" },
  aromas: [
    { group: "Schwarze Früchte", aroma: "Brombeere", source_url: PRODUCER, quote: "notes of blackberry" },
    { group: "Eiche", aroma: "Kaffee", source_url: CRITIC, quote: "hints of coffee" },
  ],
  evidence: [
    { field: "body", source_url: PRODUCER, quote: "full-bodied" },
    { field: "sweetness", source_url: CRITIC, quote: "bone dry" },
    { field: "tannin", source_url: CRITIC, quote: "firm, high tannins" },
  ],
  contradictions: [],
  style_summary: "",
  food_pairing: [],
  ...x,
});
const ctx = { type: "rot" as const, year: 2019 };

test("Werte ohne Beleg werden verworfen (auch Belege mit fremder URL oder leerem Zitat)", () => {
  const p = validateTasteProfile(
    raw({
      fields: { ...unknownFields, body: "voll", sweetness: "trocken", tannin: "hoch", acidity: "hoch", finish: "lang", alcohol: "hoch" },
      evidence: [
        { field: "body", source_url: PRODUCER, quote: "full-bodied" },
        { field: "acidity", source_url: "https://anderswo.example/x", quote: "high acidity" },
        { field: "finish", source_url: PRODUCER, quote: "   " },
      ],
      style_summary: "Kraftvoller Toro.",
      food_pairing: ["Lamm"],
    }),
    ctx,
  )!;
  assert.equal(p.values.body, "voll");
  for (const k of ["sweetness", "tannin", "acidity", "finish", "alcohol"] as const) assert.equal(p.values[k], UNKNOWN, k);
  assert.equal(p.styleSummary, null, "Beschreibung ohne Beleg fällt weg");
  assert.deepEqual(p.foodPairing, [], "Speisen ohne Beleg fallen weg");
  // Ungültige Option (nicht im WSET-Vokabular) → unbekannt
  const odd = validateTasteProfile(raw({ fields: { ...unknownFields, body: "mächtig", sweetness: "trocken", tannin: "hoch" } }), ctx)!;
  assert.equal(odd.values.body, UNKNOWN);
  // Zitate höchstens 25 Wörter
  const long = validateTasteProfile(raw({ evidence: [{ field: "body", source_url: PRODUCER, quote: Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ") }] }), ctx)!;
  assert.equal(long.evidence.body[0].quote.split(" ").filter((w) => w !== "…").length, 25);
});

test("Unklare Aromen fallen weg – nie das nächstbeste", () => {
  const p = validateTasteProfile(
    raw({
      aromas: [
        { group: "Schwarze Früchte", aroma: "Brombeere", source_url: PRODUCER, quote: "blackberry" },
        { group: "Schwarze Früchte", aroma: "dunkle Beeren", source_url: PRODUCER, quote: "dark berries" }, // nicht im Lexikon
        { group: "Rote Früchte", aroma: "Brombeere", source_url: PRODUCER, quote: "blackberry" }, // falsche Gruppe
        { group: "Eiche", aroma: "Vanille", source_url: CRITIC, quote: "" }, // ohne Zitat
        { group: "Eiche", aroma: "Kaffee", source_url: "https://fremd.example", quote: "coffee" }, // fremde Quelle
      ],
    }),
    ctx,
  )!;
  assert.deepEqual(p.aromas, { "Schwarze Früchte": ["Brombeere"] });
  assert.deepEqual(Object.keys(p.evidence).sort(), ["Brombeere", "body", "sweetness", "tannin"]);
});

test("Widersprüchliche Quellen → unbekannt plus Hinweis", () => {
  const p = validateTasteProfile(raw({ contradictions: [{ field: "tannin", note: "Weingut: hoch, Händler: mittel" }] }), ctx)!;
  assert.equal(p.values.tannin, UNKNOWN);
  assert.equal(p.values.body, "voll");
  assert.match(p.sourceNote!, /Tannin: Quellen widersprechen sich \(Weingut: hoch, Händler: mittel\)\./);
  assert.notEqual(p.confidence, "hoch", "mit Widerspruch nie „hoch“");
});

test("Keine Quelle → kein Profil; anderer Wein → kein Profil; nichts belegt → kein Profil", () => {
  assert.equal(validateTasteProfile(raw({ sources: [] }), ctx), null);
  assert.equal(validateTasteProfile(raw({ sources: [{ url: "javascript:alert(1)", title: "x", kind: "producer", vintage: 0 }] }), ctx), null);
  assert.equal(validateTasteProfile(raw({ matches_wine: false }), ctx), null);
  assert.equal(validateTasteProfile(raw({ evidence: [], aromas: [] }), ctx), null);
});

test("Sicherheit und Jahrgang", () => {
  const src = (url: string, kind: "producer" | "critic" | "merchant" | "other") => ({ url, title: "", kind, vintage: null });
  assert.equal(confidenceFor([src(PRODUCER, "producer"), src(CRITIC, "critic")], 0), "hoch");
  assert.equal(confidenceFor([src(PRODUCER, "producer"), src("https://pintia.example/andere-seite", "producer")], 0), "mittel", "gleiche Website zählt einmal");
  assert.equal(confidenceFor([src(PRODUCER, "producer"), src(SHOP, "merchant")], 1), "mittel");
  assert.equal(confidenceFor([src(CRITIC, "critic")], 0), "mittel");
  assert.equal(confidenceFor([src(SHOP, "merchant"), src("https://shop2.example", "merchant")], 0), "niedrig", "nur Händler");
  // Gleicher Jahrgang belegt → vintage_year; sonst allgemeines Profil, Jahrgang der Quelle bleibt in sources
  assert.equal(validateTasteProfile(raw(), ctx)!.vintageYear, 2019);
  const general = validateTasteProfile(raw({ same_vintage: false, sources: [{ url: PRODUCER, title: "Ficha", kind: "producer", vintage: 2017 }, { url: CRITIC, title: "K", kind: "critic", vintage: 0 }] }), ctx)!;
  assert.equal(general.vintageYear, null);
  assert.deepEqual(general.sources.map((s) => s.vintage), [2017, null]);
  // Nur genutzte Quellen bleiben
  const used = validateTasteProfile(raw({ sources: [...raw().sources, { url: SHOP, title: "Shop", kind: "merchant", vintage: 2019 }] }), ctx)!;
  assert.deepEqual(used.sources.map((s) => s.url), [PRODUCER, CRITIC]);
  assert.equal(tasteSourceLine({ ...used, source: "research" }), "Laut Recherche · Sicherheit hoch · 2 Quellen");
});

// ---------------------------------------------------------------------------
// Speichern über die Recherche (Stub)

let reply: TasteResearchRaw = raw();
const tasteCalls: string[] = [];
const net: Net = {
  tables: {},
  telegram: [],
  rpc: {},
  claude: (body) => {
    const tools = (body.tools as { name: string; strict?: boolean }[]) ?? [];
    const prompt = String((body.messages as { content: string }[])[0].content);
    if (tools.some((t) => t.name === "report_taste_profile")) {
      tasteCalls.push(prompt);
      return claudeTool("report_taste_profile", reply);
    }
    return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
  },
};
installNet(net);
const db = createAdminClient();

function reset() {
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type: "red", alcohol_content: 14.5, grapes: [], researched_at: null }],
    inventory_items: [{ wine_id: W, vintage_year: 2019, status: "sealed" }],
    wine_encounters: [],
    wine_vintages: [],
    wine_grape_shares: [],
    wine_taste_profiles: [],
    research_suggestions: [],
  };
  net.fail = undefined;
  reply = raw();
}
const profiles = () => net.tables.wine_taste_profiles;

test("Belegtes gilt sofort; keine Quelle → kein Profil und Bestehendes bleibt; Recherche überschreibt Recherche", async () => {
  reset();
  const first = await researchAndFillWine(db, W, "all");
  assert.equal(first.taste, "saved");
  assert.ok(first.filled.includes("Geschmacksprofil"));
  assert.equal(profiles().length, 1);
  const row = profiles()[0];
  assert.deepEqual([row.source, row.vintage_year, row.body, row.acidity, row.confidence], ["research", 2019, "voll", UNKNOWN, "hoch"]);
  assert.match(tasteCalls.at(-1)!, /Pintia/);
  assert.match(tasteCalls.at(-1)!, /kein falsches Profil/);

  // Nichts gefunden: kein neues Profil, das bestehende bleibt unverändert.
  const before = JSON.stringify(row);
  reply = raw({ matches_wine: false, sources: [] });
  const none = await researchAndFillWine(db, W, "all");
  assert.equal(none.taste, "none");
  assert.equal(profiles().length, 1);
  assert.equal(JSON.stringify(profiles()[0]), before, "bestehendes Profil unverändert");
  const only = await researchAndFillWine(db, W, "all", { taste: "only" });
  assert.equal(only.status, "nothing");
  assert.equal(NO_RELIABLE_PROFILE, "Keine verlässlichen Angaben gefunden.");

  // Neue Recherche überschreibt ein Profil aus der Recherche.
  reply = raw({ fields: { ...unknownFields, body: "mittel (+)", sweetness: "trocken", tannin: "hoch" } });
  assert.equal((await researchAndFillWine(db, W, "all")).taste, "saved");
  assert.equal(profiles().length, 1);
  assert.equal(profiles()[0].body, "mittel (+)");

  // Sammellauf: nur Weine ohne Profil.
  const calls = tasteCalls.length;
  assert.equal((await researchAndFillWine(db, W, "all", { taste: "missing" })).taste, "skipped");
  assert.equal(tasteCalls.length, calls);
});

test("Profil von Hand wird nicht überschrieben – es entsteht ein Vorschlag (ohne Migration: nichts passiert)", async () => {
  reset();
  // Von Hand erfasst (✏️ in der Karte) → source manual
  const form = new FormData();
  form.set("kind", "tasteProfile");
  form.set("wineId", W);
  form.set("year", "2019");
  form.set("taste_body", "mittel");
  form.set("taste_sweetness", "trocken");
  form.append("aroma", "Rote Früchte|Himbeere");
  form.set("foodPairing", "Lamm, Käse");
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits), JSON.stringify(edits));
  const saved = await applyEdit(db, edits[0]);
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.deepEqual([profiles()[0].source, profiles()[0].body, profiles()[0].tannin], ["manual", "mittel", UNKNOWN]);
  assert.deepEqual(profiles()[0].aromas, { "Rote Früchte": ["Himbeere"] });
  assert.deepEqual(profiles()[0].food_pairing, ["Lamm", "Käse"]);

  // Ohne Migration lehnt die DB das Feld ab (23514): kein Fehler, Profil bleibt.
  net.fail = (method, table) => (method === "POST" && table === "research_suggestions" ? { status: 400, body: { code: "23514", message: "check" } } : null);
  const blocked = await researchAndFillWine(db, W, "all");
  assert.equal(blocked.taste, "unchanged");
  assert.equal(profiles()[0].source, "manual");
  net.fail = undefined;

  const outcome = await researchAndFillWine(db, W, "all");
  assert.equal(outcome.taste, "suggested");
  assert.equal(profiles().length, 1);
  assert.deepEqual([profiles()[0].source, profiles()[0].body], ["manual", "mittel"], "manual bleibt");
  const [s] = await loadPendingSuggestions(db, { wineId: W });
  assert.equal(s.field, "taste_profile");
  assert.equal(s.label, "Geschmacksprofil 2019");
  assert.equal(s.current, "Mittelkräftig, trocken – Himbeere");
  assert.equal(s.suggested, "Vollmundig, trocken, viel Tannin – Brombeere, Kaffee");
  // Gleiches Ergebnis nochmals: kein zweiter Vorschlag
  assert.equal((await researchAndFillWine(db, W, "all")).taste, "unchanged");
  assert.equal(net.tables.research_suggestions.length, 1);

  // Übernehmen: das recherchierte Profil gilt (wieder source research, mit Belegen).
  const decided = await decideSuggestion(db, s.id, true, null);
  assert.ok(decided.ok, JSON.stringify(decided));
  assert.deepEqual([profiles()[0].source, profiles()[0].body, profiles()[0].confidence], ["research", "voll", "hoch"]);
  assert.ok(Object.keys(profiles()[0].evidence as object).includes("body"));
});

test("Anzeige: Profil des Jahrgangs, sonst das allgemeine; Zeile im Bot", async () => {
  reset();
  reply = raw({ same_vintage: false });
  await researchAndFillWine(db, W, "all");
  assert.equal(profiles()[0].vintage_year, null, "nicht jahrgangsspezifisch");
  const p = (await loadTasteProfile(db, W, 2019))!;
  assert.equal(p.vintageYear, null);
  assert.equal(tasteLine(p), "Vollmundig, trocken, viel Tannin – Brombeere, Kaffee");
  const text = wineDetailsText({
    name: "Pintia", producer: "Vega Sicilia", type: "red", year: 2019, country: null, region: null, appellation: null, alcohol: null,
    grapes: null, drinkFrom: null, drinkUntil: null, bottles: [], ratings: [], lastTasting: null, appUrl: null, taste: tasteLine(p),
  });
  assert.match(text, /👅 Vollmundig, trocken, viel Tannin – Brombeere, Kaffee/);
});
