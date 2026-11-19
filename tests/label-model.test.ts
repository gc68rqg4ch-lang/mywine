// Erkennung (Foto, Text-Eintrag, „Nur verkostet“) mit Opus 5.5: kein „thinking disabled“ (bei
// Opus 5.5 ein 400), effort low, keine Sampling-Parameter, fester Systemteil mit Cache-Marker;
// bei Fehler Rückfall auf Sonnet 5.5 (nie auf dasselbe Modell). Preisabgleich und Chat bleiben bei
// Haiku. Produzent ohne Besitzerfirma. Stubs – ohne DB, Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeError, claudeText, installNet, type Net } from "./stub-net";
import { FALLBACK_MODEL, LABEL_MODEL, RECOGNITION_MODEL, fallbackFor, parseTastedText, parseTextEntry, recognizeLabel } from "@/lib/ingest/recognize";
import { JUDGE_MODEL } from "@/lib/research/price-judge";
import { PRODUCER_HINT } from "@/lib/format";

const bodies: Record<string, unknown>[] = [];
let failFirst = false;
const label = {
  name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: "Toro", appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750,
  confidence: 0.5, uncertain_notes: null, vintage_certain: true, image_sides: ["front"], best_before: "",
  spirit: { kind: "wine", category: "", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 },
  purchase: { quantity: 1, storage_room: "", price: 0, regular_price: 0, vendor: "", gift: false, gift_from: "" },
  tasting: { tasted_on: "", place: "", price: 0, price_unit: "", currency: "", occasion: "", companions: "", note: "", rating: 4, want_to_buy: false },
};
const net: Net = {
  tables: { spirit_categories: [] }, telegram: [], rpc: {},
  claude: (body) => {
    bodies.push(body);
    if (failFirst && bodies.length === 1) return claudeError(400, "boom");
    return { ...claudeText(label), model: body.model };
  },
};
installNet(net);
const image = { mediaType: "image/jpeg" as const, base64: "AAAA" };

test("Modelle: Erkennung Opus 5.5, Rückfall Sonnet 5.5 (nie dasselbe), Preisabgleich und Chat Haiku", () => {
  assert.equal(LABEL_MODEL, "claude-opus-5-5");
  assert.equal(FALLBACK_MODEL, "claude-sonnet-5-5");
  assert.equal(fallbackFor(LABEL_MODEL), "claude-sonnet-5-5");
  assert.equal(fallbackFor(FALLBACK_MODEL), null);
  assert.equal(RECOGNITION_MODEL, "claude-haiku-5-5");
  assert.equal(JUDGE_MODEL, "claude-haiku-5-5");
});

test("Foto, Text, verkostet: Opus 5.5 mit effort low, ohne thinking/temperature, System mit Cache-Marker; ein Durchgang auch bei tiefer Konfidenz", async () => {
  bodies.length = 0;
  failFirst = false;
  const photo = await recognizeLabel([image]);
  assert.equal(photo.model, LABEL_MODEL);
  assert.equal(bodies.length, 1, "tiefe Konfidenz: kein zweiter Durchgang");
  await parseTextEntry("Pintia 2019, 6 Flaschen");
  await parseTastedText("Pintia 2019 probiert, 4 Sterne", "2026-11-05");
  assert.equal(bodies.length, 3);
  for (const b of bodies) {
    assert.equal(b.model, LABEL_MODEL);
    assert.equal(b.thinking, undefined, "Opus 5.5: thinking disabled wäre ein 400");
    for (const k of ["temperature", "top_p", "top_k"]) assert.equal(b[k], undefined, k);
    assert.equal((b.output_config as { effort?: string }).effort, "low");
    const system = b.system as { text: string; cache_control?: unknown }[];
    assert.deepEqual(system.map((s) => s.cache_control), [{ type: "ephemeral" }]);
  }
  // Foto und Text: fester Systemteil deutlich über 512 Tokens (Mindestlänge Opus 5.5) – „verkostet“ ist kürzer.
  for (const b of bodies.slice(0, 2)) assert.ok((b.system as { text: string }[])[0].text.length > 4000);
  assert.deepEqual(bodies.map((b) => b.max_tokens), [16000, 8000, 4000], "max_tokens wie bisher");
  // Verkostet: Datum in der Nachricht, nicht im (gecachten) Systemteil
  assert.doesNotMatch((bodies[2].system as { text: string }[])[0].text, /2026-11-05/);
  assert.match(JSON.stringify(bodies[2].messages), /Heute ist 2026-11-05/);
});

test("Fehler bei Opus 5.5 → einmal Sonnet 5.5 (ohne effort); Modell im Ergebnis ist das genutzte", async () => {
  for (const run of [() => recognizeLabel([image]), () => parseTextEntry("Pintia 2019"), () => parseTastedText("Pintia probiert", "2026-11-05")]) {
    bodies.length = 0;
    failFirst = true;
    const result = await run();
    assert.deepEqual(bodies.map((b) => b.model), [LABEL_MODEL, FALLBACK_MODEL]);
    assert.equal((bodies[1].output_config as { effort?: string }).effort, undefined);
    if ("model" in result) assert.equal(result.model, FALLBACK_MODEL);
  }
  failFirst = false;
});

test("Produzent: Weingut bzw. Marke, nie die Besitzerfirma", () => {
  assert.match(PRODUCER_HINT, /nie die Besitzer-, Holding- oder Mutterfirma/);
  assert.match(PRODUCER_HINT, /«Château Petit Gravet Aîné», nicht «Vignobles J\.J\. Nouvel»/);
});
