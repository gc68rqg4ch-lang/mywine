// Trinkreife: fünf Stufen aus dem Trinkfenster des Jahrgangs, Gruppierung in Bestand/Offen,
// Status in der Kachel und dieselbe Einteilung im Bot-Menü „⏰ Trinkreif“. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import {
  DRINK_STATUS_ORDER,
  buildCellarWines,
  currentYear,
  drinkBadges,
  drinkStatus,
  drinkStatusHref,
  drinkStatusText,
  groupWines,
  toVintageRow,
  type SummaryWine,
  type VintageRow,
} from "@/lib/cellar/overview";


const Y = 2026;

test("Einteilung: über dem Höhepunkt, jetzt trinken, trinkreif, noch lagern, unbekannt", () => {
  assert.equal(drinkStatus(2015, 2025, Y), "overdue");
  assert.equal(drinkStatus(2020, 2026, Y), "now");
  assert.equal(drinkStatus(2024, 2032, Y), "ready");
  assert.equal(drinkStatus(2026, 2032, Y), "ready");
  assert.equal(drinkStatus(2027, 2035, Y), "wait");
  assert.equal(drinkStatus(null, null, Y), "unknown");
  // Nur eine Grenze bekannt
  assert.equal(drinkStatus(2024, null, Y), "ready");
  assert.equal(drinkStatus(2030, null, Y), "wait");
  assert.equal(drinkStatus(null, 2026, Y), "now");
  assert.equal(drinkStatus(null, 2020, Y), "overdue");
  assert.equal(drinkStatusText(2024, 2032, Y), "Trinkreif · 2024–2032");
  assert.equal(drinkStatusText(null, null, Y), "Unbekannt · kein Trinkfenster");
  assert.equal(drinkStatusHref("ready"), "/?gruppe=trinkreife&reife=ready#gruppe-trinkreife-ready");
});

const wine = (id: string, name: string): SummaryWine => ({
  wine_id: id, name, producer: "P", country: "Spanien", region: null, type: "red", grapes: [],
});
const row = (wine_id: string, year: number | null, from: number | null, until: number | null, sealed: number, room = "Weinkeller"): VintageRow => ({
  wine_id, vintage_year: year, bottle_size_ml: 750, avg_price: null, price_class: null,
  drink_status: drinkStatus(from, until, Y), drink_from_year: from, drink_until_year: until,
  locations: [{ storage_house: null, storage_room: room, sealed, open: 0 }],
});

test("Gruppierung „Trinkreife“: Reihenfolge, je Jahrgang, Lagerort-Filter", () => {
  const wines = buildCellarWines(
    [wine("a", "Alpha"), wine("b", "Beta"), wine("c", "Gamma")],
    [
      row("a", 2010, 2015, 2025, 2),
      row("a", 2020, 2027, 2035, 3),
      row("b", 2019, 2024, 2032, 4),
      row("b", 2016, 2020, 2026, 1, "Kühlschrank"),
      row("c", null, null, null, 6),
    ],
    null,
  );
  const groups = groupWines(wines, "trinkreife", Y);
  assert.deepEqual(groups.map((g) => g.label), ["Über dem Höhepunkt", "Jetzt trinken", "Trinkreif", "Noch lagern", "Unbekannt"]);
  assert.deepEqual(groups.map((g) => g.key), DRINK_STATUS_ORDER);
  // Alpha erscheint zweimal, je mit den Flaschen des passenden Jahrgangs.
  assert.deepEqual(groups[0].items.map((i) => [i.wine.name, i.bottles, i.vintages]), [["Alpha", 2, [2010]]]);
  assert.deepEqual(groups[3].items.map((i) => [i.wine.name, i.bottles, i.vintages]), [["Alpha", 3, [2020]]]);

  // Kachel: ein Jahrgang → ohne Jahr; mehrere mit verschiedenem Status → je Jahrgang.
  const beta = wines.find((w) => w.name === "Beta")!;
  assert.deepEqual(drinkBadges(beta, [2019], Y), [{ status: "ready", text: "Trinkreif · 2024–2032" }]);
  assert.deepEqual(
    drinkBadges(beta, beta.vintages, Y).map((b) => [b.year, b.text]),
    [[2016, "Jetzt trinken · 2020–2026"], [2019, "Trinkreif · 2024–2032"]],
  );

  // Lagerort: nur der Weinkeller → „Jetzt trinken“ (Kühlschrank) fällt weg.
  const cellar = buildCellarWines([wine("b", "Beta")], [row("b", 2019, 2024, 2032, 4), row("b", 2016, 2020, 2026, 1, "Kühlschrank")], {
    house: null,
    room: "Weinkeller",
  });
  assert.deepEqual(groupWines(cellar, "trinkreife", Y).map((g) => g.key), ["ready"]);
});

test("toVintageRow rechnet den Status aus dem Fenster (nicht aus der View)", () => {
  const r = toVintageRow({ wine_id: "a", vintage_year: 2018, drink_from_year: 2020, drink_until_year: currentYear(), drink_status: "ready", locations: [] } as never);
  assert.equal(r?.drink_status, "now");
});

test("Bot „⏰ Trinkreif“: dieselbe Einteilung und Reihenfolge", async () => {
  const y = currentYear();
  const net: Net = {
    tables: {
      cellar_wine_summary: [
        { wine_id: "a", name: "Alpha", producer: "Bodega", country: null, region: null, type: "red", grapes: [] },
        { wine_id: "b", name: "Beta", producer: "Domaine", country: null, region: null, type: "white", grapes: [] },
      ],
      cellar_wines: [
        { wine_id: "a", vintage_year: 2015, drink_from_year: y - 6, drink_until_year: y, drink_status: "ready", sealed_bottles: 2, locations: [{ storage_room: "Weinkeller", sealed: 2, open: 0 }] },
        { wine_id: "b", vintage_year: 2022, drink_from_year: y + 2, drink_until_year: y + 9, drink_status: "wait", sealed_bottles: 1, locations: [{ storage_room: "Weinkeller", sealed: 1, open: 0 }] },
        { wine_id: "b", vintage_year: 2012, drink_from_year: y - 10, drink_until_year: y - 1, drink_status: "overdue", sealed_bottles: 3, locations: [{ storage_room: "Weinkeller", sealed: 3, open: 0 }] },
      ],
    },
    telegram: [],
    rpc: {},
    claude: () => {
      throw new Error("unerwarteter Claude-Aufruf");
    },
  };
  installNet(net);
  const { screenFor } = await import("@/lib/chat/menu");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { screen } = await screenFor(createAdminClient(), { op: "list", list: { kind: "ready" }, offset: 0 }, { chatId: 111 });
  assert.match(screen.text, /⚠️ Über dem Höhepunkt 3 · ⏰ Jetzt trinken 2 · ✅ Trinkreif 0 · ⏳ Noch lagern 1 · ❔ Unbekannt 0/);
  const lines = screen.text.split("\n").filter((l) => /Fl\.$/.test(l));
  assert.deepEqual(lines.map((l) => l.split(" ")[0]), ["⚠️", "⏰", "⏳"]);
});
