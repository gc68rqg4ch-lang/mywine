// Weinseite „Zum Wein“ → ✏️: Name und Produzent ändern. Name Pflicht und getrimmt, Produzent
// leer → NULL, gleicher Name + Produzent (Gross-/Kleinschreibung egal) → nicht speichern, Meldung
// mit Link zum bestehenden Wein; alles andere bleibt am Wein. Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { editsFromForm } from "@/lib/edit/form";
import { applyEdits } from "@/lib/edit/edit";

const W = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => { throw new Error("kein Claude erwartet"); } };
installNet(net);
const db = createAdminClient();

function reset() {
  net.tables = {
    wines: [
      { id: W, name: "Reserva", producer: "Legaris", type: "red", country: "Spanien", region: "Ribera del Duero", appellation: null, alcohol_content: 14 },
      { id: OTHER, name: "Legaris Reserva", producer: "Bodegas Legaris", type: "red", country: "Spanien", region: null, appellation: null, alcohol_content: null },
    ],
    inventory_items: [{ id: "i1", wine_id: W, vintage_year: 2019, quantity: 6 }],
    wine_ratings: [{ id: "r1", wine_id: W, vintage_year: 2019, rating: 4 }],
    wine_media: [{ id: "m1", wine_id: W, kind: "document" }],
    wine_taste_profiles: [{ id: "p1", wine_id: W, vintage_year: 2019 }],
  };
}
const wine = () => net.tables.wines.find((w) => w.id === W)!;
/** Formular „Zum Wein“ wie im Browser (nur die Felder, um die es geht). */
function save(name: string, producer: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "wineCard", wineId: W, from: "2019", name, producer })) form.set(k, v);
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits), JSON.stringify(edits));
  return applyEdits(db, edits);
}

test("Formular: Name und Produzent zuoberst in „Zum Wein“", () => {
  const form = readFileSync("src/app/(cellar)/wein/[id]/edit-sections.tsx", "utf8");
  const card = form.slice(form.indexOf("export function WineCardForm"));
  const fields = [...card.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(fields.slice(0, 2), ["name", "producer"]);
  assert.match(card, /name="name" defaultValue=\{wine\.name\} required/);
});

test("Name ändern → gespeichert und getrimmt; der Rest bleibt am Wein", async () => {
  reset();
  const before = JSON.stringify([net.tables.inventory_items, net.tables.wine_ratings, net.tables.wine_media, net.tables.wine_taste_profiles]);
  const result = await save("   Legaris   Reserva  ", "  Legaris ");
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual([wine().name, wine().producer], ["Legaris Reserva", "Legaris"]);
  assert.deepEqual([wine().country, wine().region, wine().alcohol_content], ["Spanien", "Ribera del Duero", 14], "übrige Angaben unverändert");
  assert.equal(JSON.stringify([net.tables.inventory_items, net.tables.wine_ratings, net.tables.wine_media, net.tables.wine_taste_profiles]), before);
});

test("Leerer Name → nicht gespeichert, Meldung", async () => {
  reset();
  const result = await save("   ", "Legaris");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /Der Name darf nicht leer sein/);
  assert.equal(wine().name, "Reserva");
});

test("Produzent leer → NULL", async () => {
  reset();
  const result = await save("Reserva", "   ");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(wine().producer, null);
});

test("Doppelter Name + Produzent (andere Schreibweise) → nicht gespeichert, Meldung mit Link", async () => {
  reset();
  const result = await save("LEGARIS reserva", "bodegas legaris");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /^Diesen Wein gibt es schon: „Legaris Reserva“ von Bodegas Legaris\./);
  assert.deepEqual(result.link?.href, `/wein/${OTHER}`);
  assert.match(result.link!.label, /Zum bestehenden Wein/);
  assert.deepEqual([wine().name, wine().producer], ["Reserva", "Legaris"], "nichts geändert, nichts zusammengeführt");
  assert.equal(net.tables.wines.length, 2);
  // Die Meldung samt Link kommt in der App an
  const action = readFileSync("src/app/(cellar)/edit-actions.ts", "utf8");
  assert.ok(action.includes("...(result.link ? { link: result.link } : {})"));
  const form = readFileSync("src/app/(cellar)/wein/[id]/edit-form.tsx", "utf8");
  assert.ok(form.includes("<Link href={state.link.href}"));
});
