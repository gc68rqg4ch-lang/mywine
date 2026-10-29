// Preis auch bei offenen Flaschen: dieselbe Preisanzeige (bezahlt · normal, Händler, Geschenk,
// „Preis recherchiert“) bei offenen, ungeöffneten und getrunkenen Flaschen; ✏️ speichert den Preis
// der offenen Charge. Ohne DB, API-Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { editsFromForm } from "@/lib/edit/form";
import { applyEdits } from "@/lib/edit/edit";
import { priceDetails } from "@/lib/cellar/wine-units";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const PAGE = read("app/(cellar)/wein/[id]/page.tsx");

test("Preisangaben: Händler (nicht bei Geschenken), Geschenk von …, Hinweis „Preis recherchiert“", () => {
  assert.deepEqual(priceDetails({ vendor_name: "Mövenpick", is_gift: false, gift_from: null, price_hint: "Preis recherchiert: Mövenpick, 29.10.2026" }), {
    vendor: "bei Mövenpick", gift: null, hint: "Preis recherchiert: Mövenpick, 29.10.2026",
  });
  assert.deepEqual(priceDetails({ vendor_name: null, is_gift: true, gift_from: "Dad", price_hint: null }), { vendor: null, gift: "Geschenk von Dad", hint: null });
  assert.deepEqual(priceDetails({ vendor_name: "Coop", is_gift: true, gift_from: null }), { vendor: null, gift: "Geschenk", hint: null });
  assert.deepEqual(priceDetails({}), { vendor: null, gift: null, hint: null });
});

test("Weinseite: offene Spirituose, offene Flasche (Wein), Bestand und Getrunken zeigen dieselbe Preisanzeige mit ✏️", () => {
  // Spirituose mit nur einer offenen Flasche: Karte „Offene Flasche“ mit Preis, in einer Einheit mit Bearbeiten-Formular
  assert.match(PAGE, /\{spirit &&\s*open\.map\(\(o\) => \(\s*<EditUnit [^\n]*label=\{`Offene Flasche[^\n]*form=\{batchForm\(o\)\}>\s*<SpiritBottle[\s\S]*?price=\{itemPrice\(o\)\}\s*\/>/);
  // Wein/Likörwein: offene Flasche
  assert.match(PAGE, /<OpenBottleControls[\s\S]*?price=\{itemPrice\(o\)\}\s*\/>/);
  // Im Bestand und Getrunken: gleiche Anzeige
  assert.match(PAGE, /label=\{`Charge \$\{place\(b\)\}`\}[\s\S]*?\{itemPrice\(b\)\}/);
  assert.match(PAGE, /label=\{`Getrunkene Flasche[\s\S]*?\{itemPrice\(d\)\}/);
  // Eine Anzeige: Preis, Händler, Hinweis, Geschenk
  assert.match(PAGE, /function ItemPrice[\s\S]*?<PriceLine[\s\S]*?\{vendor && [\s\S]*?\{hint && [\s\S]*?\{gift && /);
  assert.match(read("app/(cellar)/wein/[id]/spirit-bottle.tsx"), /\{keep && <p className="small">\{keep\}<\/p>\}\s*\{price\}/);
  assert.match(read("app/(cellar)/wein/[id]/bottle-actions.tsx"), /\{bottle\.label\}<\/span>\s*\{price\}/);
  // Bestandswert/Ausgaben unverändert: Bestand zählt weiter nur ungeöffnete (bzw. bei Spirituosen offene dazu)
  assert.match(PAGE, /const sealed = inVintage\.filter\(\(i\) => i\.status === "sealed" && i\.quantity > 0\);/);
});

// --- ✏️ bei der offenen Flasche: Preis und Händler werden bei dieser Charge gespeichert

const W = "11111111-1111-4111-8111-111111111111";
const OPEN = "22222222-2222-4222-8222-222222222222";
const SEALED = "33333333-3333-4333-8333-333333333333";
const row = (id: string, extra: Record<string, unknown>) => ({
  id, wine_id: W, vintage_year: null, status: "sealed", quantity: 1, bottle_size_ml: 700, purchased_at: null, vendor_id: null,
  is_gift: false, purchase_price: null, regular_price: null, currency: "CHF", storage_house: "Zuhause", storage_room: "Wohnzimmer",
  storage_compartment: null, storage_location: null, drunk_at: null, wine: { name: "Lagavulin 16", producer: "Lagavulin" }, vendor: null, open: null,
  ...extra,
});
const net: Net = {
  tables: {
    wines: [{ id: W, name: "Lagavulin 16", producer: "Lagavulin", type: "spirit", country: "Schottland", region: null, appellation: null, alcohol_content: 43 }],
    inventory_items: [row(OPEN, { status: "open", fill_level_percent: 60, date_opened: "2026-09-01" }), row(SEALED, { purchase_price: 79, regular_price: 85 })],
    wine_vintages: [], vendors: [{ id: "ven1", name: "Mövenpick" }], ingest_jobs: [], persons: [],
  },
  telegram: [], rpc: {},
  claude: () => {
    throw new Error("unerwarteter Claude-Aufruf");
  },
};
installNet(net);
const db = createAdminClient();

test("✏️ bei der offenen Spirituose speichert Preis und Händler der offenen Charge; die ungeöffnete bleibt", async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "batch", itemId: OPEN, giftField: "1", purchasePrice: "74.90", regularPrice: "82", vendor: "Mövenpick" })) form.set(k, v);
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits), JSON.stringify(edits));
  const result = await applyEdits(db, edits);
  assert.ok(result.ok, JSON.stringify(result));
  const [open, sealed] = net.tables.inventory_items;
  assert.deepEqual([open.purchase_price, open.regular_price, open.vendor_id, open.status], [74.9, 82, "ven1", "open"]);
  assert.deepEqual([sealed.purchase_price, sealed.regular_price], [79, 85], "andere Charge unverändert");
});
