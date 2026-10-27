// Weinseite (/wein/[id]): Link mit Jahrgang, Jahrgangs-Auswahl und die Flasche, an der
// jahrgangsbezogene Aktionen hängen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorItem, parseVintageParam, pickVintage, vintageOptions, wineHref, type PageItem } from "@/lib/cellar/wine-page";

const it = (id: string, y: number | null, status: PageItem["status"], q = 1, drunk_at: string | null = null): PageItem =>
  ({ inventory_item_id: id, vintage_year: y, status, quantity: q, drunk_at });
const items = [it("a", 2019, "sealed", 6), it("b", 2019, "sealed", 4), it("c", 2019, "open"), it("d", 2016, "drunk", 1, "2026-01-01"), it("e", 2021, "drunk", 1, "2026-10-01"), it("f", null, "sealed", 2)];

test("Link und Jahrgangs-Parameter", () => {
  assert.equal(wineHref("w"), "/wein/w");
  assert.equal(wineHref("w", 2019), "/wein/w?jahrgang=2019");
  assert.equal(wineHref("w", null, { geoeffnet: "1" }), "/wein/w?jahrgang=ohne&geoeffnet=1");
  assert.equal(parseVintageParam("2019"), 2019);
  assert.equal(parseVintageParam("ohne"), null);
  assert.equal(parseVintageParam("x"), undefined);
});

test("Jahrgänge: alle (auch nur getrunkene), Auswahl mit Rückfall", () => {
  const opts = vintageOptions(items);
  assert.deepEqual(opts.map((o) => [o.year, o.sealed, o.open, o.drunk]), [[2016, 0, 0, 1], [2019, 10, 1, 0], [2021, 0, 0, 1], [null, 2, 0, 0]]);
  assert.equal(pickVintage(opts, 2021, items), 2021);
  assert.equal(pickVintage(opts, 1999, items), 2019, "unbekannt → ältester im Bestand");
  assert.equal(pickVintage(opts, undefined, items), 2019);
  assert.equal(pickVintage(opts, null, items), null);
  const drunkOnly = [it("d", 2016, "drunk", 1, "2026-01-01"), it("e", 2021, "drunk", 1, "2026-10-01")];
  assert.equal(pickVintage(vintageOptions(drunkOnly), undefined, drunkOnly), 2021, "sonst zuletzt getrunken");
});

test("Anker für Bewertung/Verkostung: offen vor ungeöffnet vor getrunken", () => {
  assert.equal(anchorItem(items.filter((i) => i.vintage_year === 2019))?.inventory_item_id, "c");
  assert.equal(anchorItem([it("x", 2019, "drunk", 1, "2026-01-01"), it("y", 2019, "drunk", 1, "2026-05-01")])?.inventory_item_id, "y");
  assert.equal(anchorItem([]), null);
});
