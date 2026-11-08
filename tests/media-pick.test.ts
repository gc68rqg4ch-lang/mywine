import assert from "node:assert/strict";
import { test } from "node:test";
import { labelFromHint, labelKinds, newestVintage, pickLabels, thumbPathFor, vintagePhotos, winePagePhotos, type MediaRow } from "@/lib/media/pick";

let n = 0;
const row = (p: Partial<MediaRow>): MediaRow => ({
  id: `m${++n}`,
  wine_id: "w1",
  inventory_item_id: null,
  kind: "label_front",
  vintage_year: 2020,
  storage_path: `p${n}.jpg`,
  thumb_path: null,
  sort_order: 0,
  created_at: `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z`,
  ...p,
});

test("pickLabels: gewählter Jahrgang, sonst neuester; Rückseite zum selben Jahrgang", () => {
  const f19 = row({ vintage_year: 2019 });
  const f21 = row({ vintage_year: 2021 });
  const b21 = row({ kind: "label_back", vintage_year: 2021 });
  const b19 = row({ kind: "label_back", vintage_year: 2019 });
  const rows = [f19, f21, b21, b19];
  assert.deepEqual(pickLabels(rows, 2019), { front: f19, back: b19 });
  assert.deepEqual(pickLabels(rows, 2018), { front: f21, back: b21 });
  assert.deepEqual(pickLabels(rows, undefined), { front: f21, back: b21 });
  assert.equal(pickLabels([b21], 2021), null);
});

test("pickLabels: neuestes Foto gewinnt, Rückseite derselben Charge bevorzugt", () => {
  const old = row({ inventory_item_id: "i1" });
  const fresh = row({ inventory_item_id: "i2" });
  const backOther = row({ kind: "label_back", inventory_item_id: "i1" });
  const backSame = row({ kind: "label_back", inventory_item_id: "i2", created_at: "2026-01-01T00:00:00Z" });
  assert.deepEqual(pickLabels([old, fresh, backOther, backSame], 2020), { front: fresh, back: backSame });
});

test("labelKinds: Erkennung, sonst Reihenfolge; nie zwei Vorderseiten", () => {
  assert.deepEqual(labelKinds(2), ["label_front", "label_back"]);
  assert.deepEqual(labelKinds(3, ["back", "front", "other"]), ["label_back", "label_front", "photo"]);
  assert.deepEqual(labelKinds(2, ["front", "front"]), ["label_front", "photo"]);
  assert.deepEqual(labelKinds(2, ["back", "other"]), ["label_back", "label_front"]);
  assert.deepEqual(labelKinds(2, ["front"]), ["label_front", "label_back"]);
});

test("vintagePhotos, newestVintage, thumbPathFor", () => {
  const p = row({ kind: "photo" });
  const b = row({ kind: "label_back" });
  const f = row({});
  const other = row({ vintage_year: 2018 });
  assert.deepEqual(vintagePhotos([p, b, f, other], 2020), [f, b, p]);
  assert.equal(newestVintage([2018, null, 2021]), 2021);
  assert.equal(newestVintage([null]), null);
  assert.equal(newestVintage([]), undefined);
  assert.equal(thumbPathFor("telegram/abc/12.jpg"), "telegram/abc/12.thumb.webp");
  assert.equal(thumbPathFor("app/w/x.y/z"), "app/w/x.y/z.thumb.webp");
});

test("winePagePhotos: eigene Fotos des Jahrgangs haben Vorrang; sonst dieselben Etiketten wie die Liste mit Hinweis", () => {
  const f91 = row({ vintage_year: 1991, inventory_item_id: "i91" });
  const fNv = row({ vintage_year: null });
  const bNv = row({ kind: "label_back", vintage_year: null });
  const p91 = row({ kind: "photo", vintage_year: 1991 });
  // Jahrgang 1991 ohne eigene Fotos, Etikett ohne Jahrgang → dieses, wie pickLabels (Liste)
  assert.deepEqual(winePagePhotos([fNv, bNv], 1991), { photos: [fNv, bNv], from: null });
  assert.deepEqual(pickLabels([fNv, bNv], 1991), { front: fNv, back: bNv }, "Liste zeigt dasselbe");
  // anderer Jahrgang mit Fotos
  const f20 = row({ vintage_year: 2020 });
  assert.deepEqual(winePagePhotos([f20, fNv], 2018), { photos: [f20], from: 2020 });
  // eigene Fotos (auch nur „Weiteres“) → nur diese, kein Hinweis
  assert.deepEqual(winePagePhotos([f91, fNv, bNv, f20], 1991), { photos: [f91] });
  assert.deepEqual(winePagePhotos([p91, f20], 1991), { photos: [p91] });
  // gar keine Vorderseite → nichts
  assert.deepEqual(winePagePhotos([bNv], 1991), { photos: [] });
  assert.equal(labelFromHint(1991), "Etikett von 1991");
  assert.equal(labelFromHint(null), "Etikett ohne Jahrgang");
});
