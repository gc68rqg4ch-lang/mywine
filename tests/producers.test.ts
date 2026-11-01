// Produzenten einheitlich: Abgleich mit den vorhandenen (gleich → deren Schreibweise, ähnlich →
// Rückfrage bzw. Hinweis, neu), beim neuen Wein, in der Recherche und beim Bearbeiten. Stubs –
// ohne DB, Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { MIN_SIMILAR, matchProducer, producerKey, sameOrSimilarProducer, sameProducer, similarProducers } from "@/lib/producers/match";
import { resolveWine } from "@/lib/ingest/wines";
import { nextPurchaseStep, producerPatch } from "@/lib/ingest/flow";
import { recordSuggestion } from "@/lib/research/suggestions";
import { applyEdit } from "@/lib/edit/edit";
import { PRODUCER_HINT } from "@/lib/format";
import type { IngestState, WineProposal } from "@/lib/ingest/schema";

const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => { throw new Error("kein Claude-Aufruf beim Abgleich"); } };
installNet(net);
const db = createAdminClient();

test("Normalisierung: Gross/Klein, Akzente, Satzzeichen, Leerzeichen, Klammerinhalt weg", () => {
  assert.equal(producerKey("Jürg Obrecht (Weingut Obrecht, Jenins)"), "jurgobrecht");
  assert.equal(producerKey("Distilleria Giovannipoli (Casa Grappa)"), "distilleriagiovannipoli");
  assert.equal(producerKey("Gunzwiler Destillate (Urs Hecht AG)", { keepParens: true }), "gunzwilerdestillateurshechtag");
  assert.ok(sameProducer("Quinta de la Rosa", "Quinta de la Rosa (Quinta da Rosa Vinhos SA)"));
  assert.ok(sameProducer("Jürg Obrecht", "Jürg Obrecht (Weingut Obrecht, Jenins)"));
  assert.ok(sameProducer("Giovannipoli", "Giovanni Poli"), "Leerzeichen zählen nicht");
});

test("Abgleich mit den Beispielen: gleich / ähnlich / neu", () => {
  const existing = ["Giovanni Poli", "Fin Bec", "Jürg Obrecht", "Quinta de la Rosa", "Urs Hecht", "Illva Saronno", "Hendrick's", "Vega Sicilia"];
  assert.deepEqual(matchProducer("Jürg Obrecht (Weingut Obrecht, Jenins)", existing), { kind: "same", producer: "Jürg Obrecht" });
  assert.deepEqual(matchProducer("quinta de la rosa (Quinta da Rosa Vinhos SA)", existing), { kind: "same", producer: "Quinta de la Rosa" });
  assert.deepEqual(matchProducer("Distilleria Giovanni Poli", existing), { kind: "similar", candidates: ["Giovanni Poli"] });
  assert.deepEqual(matchProducer("Distilleria Giovannipoli (Casa Grappa)", existing), { kind: "similar", candidates: ["Giovanni Poli"] });
  assert.deepEqual(matchProducer("Cave Fin Bec SA", existing), { kind: "similar", candidates: ["Fin Bec"] });
  assert.deepEqual(matchProducer("Gunzwiler Destillate (Urs Hecht AG)", existing), { kind: "similar", candidates: ["Urs Hecht"] });
  assert.deepEqual(matchProducer("Illva Saronno S.p.A.", existing), { kind: "similar", candidates: ["Illva Saronno"] });
  assert.deepEqual(matchProducer("Hendrick's Gin Distillery (William Grant & Sons), Girvan", existing), { kind: "similar", candidates: ["Hendrick's"] });
  assert.deepEqual(matchProducer("Bodegas Alion", existing), { kind: "new" });
  assert.deepEqual(matchProducer("", existing), { kind: "new" });
  // Häufigste Schreibweise zuerst, wenn mehrere gleich sind
  assert.deepEqual(matchProducer("FIN BEC", ["Fin bec", "Fin Bec", "Fin Bec"]), { kind: "same", producer: "Fin Bec" });
});

test("Kurze Namen: kein Fehltreffer (Mindestlänge)", () => {
  assert.equal(MIN_SIMILAR, 6);
  assert.deepEqual(matchProducer("Rosa", ["Quinta de la Rosa"]), { kind: "new" });
  assert.deepEqual(matchProducer("Poli", ["Giovanni Poli"]), { kind: "new" });
  assert.deepEqual(matchProducer("Bec", ["Cave Fin Bec SA"]), { kind: "new" });
  assert.ok(!similarProducers("Vega", "Vega Sicilia"));
  assert.ok(sameOrSimilarProducer("Paolo Lazzaroni & Figli", "Paolo Lazzaroni & Figli S.p.A."));
});

const proposal = (producer: string | null, name = "Douro Tinto"): WineProposal => ({
  name, producer, vintage_year: 2020, country: null, region: null, appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750,
});
const otherWine = (id: string, name: string, producer: string) => ({ id, name, producer, type: "red", country: null, region: null, appellation: null, alcohol_content: null, grapes: [] });

test("Neuer Wein eines bekannten Produzenten übernimmt die vorhandene Schreibweise", async () => {
  net.tables = { wines: [otherWine("w1", "Reserva", "Quinta de la Rosa")] };
  const id = await resolveWine(db, proposal("QUINTA DE LA ROSA (Quinta da Rosa Vinhos SA)"), null);
  assert.equal(net.tables.wines.find((w) => w.id === id)?.producer, "Quinta de la Rosa");
  // Schon im Ablauf (vor dem Speichern): gleich → Schreibweise, ähnlich → Rückfrage, neu → wie angegeben
  const state = (producer: string) => ({ step: "review", source: "telegram", proposal: proposal(producer) }) as unknown as IngestState;
  net.tables = { wines: [otherWine("w1", "Reserva", "Quinta de la Rosa"), otherWine("w2", "Grappa", "Giovanni Poli")] };
  assert.deepEqual(await producerPatch(db, state("Quinta de la Rosa (Vinhos SA)"), null), { proposal: proposal("Quinta de la Rosa"), producer_checked: "Quinta de la Rosa", producer_options: undefined });
  const similar = await producerPatch(db, state("Distilleria Giovanni Poli"), null);
  assert.deepEqual(similar, { producer_options: ["Giovanni Poli"] });
  assert.equal(nextPurchaseStep({ ...state("Distilleria Giovanni Poli"), ...similar }), "producer_match");
  assert.notEqual(nextPurchaseStep({ ...state("Distilleria Giovanni Poli"), ...similar, producer_checked: "Distilleria Giovanni Poli" }), "producer_match", "bestätigt: keine zweite Frage");
  assert.deepEqual(await producerPatch(db, state("Bodegas Alion"), null), { producer_checked: "Bodegas Alion", producer_options: undefined });
  assert.deepEqual(await producerPatch(db, state("Distilleria Giovanni Poli"), "w9"), {}, "bekannter Wein: kein Abgleich");
});

test("Recherche: kein Vorschlag bei Rechtsform/Zusatz, Vorschlag bei anderem Produzenten (in vorhandener Schreibweise)", async () => {
  net.tables = { wines: [otherWine("w1", "Amaretto", "Illva Saronno"), otherWine("w2", "X", "Alion")], research_suggestions: [] };
  const rec = (current: string, suggested: string) => recordSuggestion(db, { wineId: "w1", year: null, field: "producer", current, suggested, note: null });
  assert.equal(await rec("Illva Saronno", "Illva Saronno S.p.A."), "skipped");
  assert.equal(await rec("Paolo Lazzaroni & Figli", "Paolo Lazzaroni & Figli S.p.A."), "skipped");
  assert.equal(await rec("Hendrick's", "Hendrick's Gin Distillery (William Grant & Sons), Girvan"), "skipped");
  assert.equal(net.tables.research_suggestions.length, 0);
  assert.equal(await rec("Vega Sicilia", "ALION"), "created");
  assert.equal(net.tables.research_suggestions[0].suggested_value, "Alion", "vorhandene Schreibweise");
  assert.match(PRODUCER_HINT, /ohne Rechtsform, Ortszusatz oder Mutterfirma/);
});

test("Bearbeiten (App und Antoine): gleich → vorhandene Schreibweise, ähnlich → Hinweis ohne Blockieren", async () => {
  net.tables = { wines: [otherWine("w1", "Grappa Moscato", "Giovanni Poli"), otherWine("w2", "Nosiola", "Poli"), otherWine("w3", "Vin", "Fin Bec")] };
  const similar = await applyEdit(db, { kind: "wine", wineId: "w2", set: { producer: "Distilleria Giovanni Poli" } });
  assert.ok(similar.ok, JSON.stringify(similar));
  assert.match(similar.ok ? similar.message : "", /Ähnlicher Produzent schon vorhanden: «Giovanni Poli»/);
  assert.equal(net.tables.wines.find((w) => w.id === "w2")?.producer, "Distilleria Giovanni Poli", "nicht blockiert");
  const same = await applyEdit(db, { kind: "wine", wineId: "w2", set: { producer: "FIN BEC" } });
  assert.ok(same.ok);
  assert.equal(net.tables.wines.find((w) => w.id === "w2")?.producer, "Fin Bec");
});
