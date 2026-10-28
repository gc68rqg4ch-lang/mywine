// Chargen-Formular: „Geschenk“ mit „Geschenk von“ (inventory_items.gift_from). Speicher-Logik:
// Name getrimmt, leer → NULL (ohne Fehler), Häkchen aus → NULL (DB-Check gift_from nur mit
// is_gift); Anzeige „Geschenk von <Name>“ bzw. „Geschenk“. Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { editsFromForm } from "@/lib/edit/form";
import { applyEdits } from "@/lib/edit/edit";
import { giftLabel } from "@/lib/cellar/wine-units";

const W = "11111111-1111-4111-8111-111111111111";
const I = "22222222-2222-4222-8222-222222222222";
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => { throw new Error("kein Claude erwartet"); } };
// Nachbildung des DB-Checks inventory_items_gift_from_requires_gift
net.fail = (method, table, body) => {
  if (method !== "PATCH" || table !== "inventory_items") return null;
  const row = { ...net.tables.inventory_items.find((r) => r.id === I), ...(body as object) } as { gift_from?: string | null; is_gift?: boolean };
  return row.gift_from != null && !row.is_gift ? { status: 400, body: { code: "23514", message: "inventory_items_gift_from_requires_gift" } } : null;
};
installNet(net);
const db = createAdminClient();

function reset(extra: Record<string, unknown> = {}) {
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia" }],
    vendors: [],
    inventory_items: [{
      id: I, wine_id: W, vintage_year: 2019, status: "sealed", quantity: 6, bottle_size_ml: 750, purchased_at: "2026-03-01", vendor_id: null,
      is_gift: false, gift_from: null, purchase_price: null, regular_price: null, currency: "CHF", storage_house: "Zuhause", storage_room: "Weinkeller",
      storage_compartment: null, storage_location: null, drunk_at: null, wine: { name: "Pintia", producer: "Vega Sicilia" }, vendor: null, open: null,
      ...extra,
    }],
  };
}
const row = () => net.tables.inventory_items[0];
/** Formular wie im Browser: das Feld „von“ wird nur mitgeschickt, wenn „Geschenk“ angehakt ist. */
async function save(fields: { isGift: boolean; giftFrom?: string }) {
  const form = new FormData();
  form.set("kind", "batch");
  form.set("itemId", I);
  form.set("giftField", "1");
  if (fields.isGift) form.set("isGift", "on");
  if (fields.isGift && fields.giftFrom !== undefined) form.set("giftFrom", fields.giftFrom);
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits), JSON.stringify(edits));
  return applyEdits(db, edits);
}

test("Name wird getrimmt und gespeichert", async () => {
  reset();
  const result = await save({ isGift: true, giftFrom: "   Anna   Muster  " });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual([row().is_gift, row().gift_from], [true, "Anna Muster"]);
});

test("Leeres Feld: speichert ohne Fehler, gift_from = NULL", async () => {
  reset();
  const result = await save({ isGift: true, giftFrom: "   " });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual([row().is_gift, row().gift_from], [true, null]);
  // Name entfernen: wieder NULL
  reset({ is_gift: true, gift_from: "Anna" });
  assert.ok((await save({ isGift: true, giftFrom: "" })).ok);
  assert.equal(row().gift_from, null);
});

test("Häkchen aus: gift_from = NULL (sonst greift der DB-Check)", async () => {
  reset({ is_gift: true, gift_from: "Anna" });
  const result = await save({ isGift: false });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual([row().is_gift, row().gift_from], [false, null]);
  // Auch wenn ein Name mitkommt (z. B. altes Formular), wird ohne Häkchen nichts gespeichert.
  reset({ is_gift: true, gift_from: "Anna" });
  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "batch", itemId: I, giftField: "1", giftFrom: "Bob" })) form.set(k, v);
  assert.ok((await applyEdits(db, editsFromForm(form) as never)).ok);
  assert.deepEqual([row().is_gift, row().gift_from], [false, null]);
});

test("Unverändert: keine Änderung; anderer Name: nur der Name", async () => {
  reset({ is_gift: true, gift_from: "Anna" });
  const same = await save({ isGift: true, giftFrom: " Anna " });
  assert.equal(same.ok, false, "nichts zu ändern");
  const other = await save({ isGift: true, giftFrom: "Bob" });
  assert.ok(other.ok, JSON.stringify(other));
  assert.equal(row().gift_from, "Bob");
});

test("Anzeige und Formular", () => {
  assert.equal(giftLabel(true, "Anna"), "Geschenk von Anna");
  assert.equal(giftLabel(true, null), "Geschenk");
  assert.equal(giftLabel(true, "  "), "Geschenk");
  assert.equal(giftLabel(false, null), null);
  const field = readFileSync("src/app/(cellar)/wein/[id]/gift-field.tsx", "utf8");
  assert.match(field, /<label className="gift-check">\s*<input name="isGift" type="checkbox"/, "Label umschliesst die Checkbox");
  assert.match(field, /\{checked && \(/, "„von“ nur sichtbar, wenn angehakt");
  assert.match(field, /name="giftFrom"/);
  assert.ok(!/required/.test(field), "freiwillig");
  const form = readFileSync("src/app/(cellar)/wein/[id]/edit-sections.tsx", "utf8");
  assert.ok(form.includes("<GiftField ") && !form.includes('name="isGift"'));
});
