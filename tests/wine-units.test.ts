// Weinseite aufgeräumt: Bearbeiten direkt in der Karte (immer nur eine Einheit offen, Rückfrage
// bei ungespeicherten Änderungen), Büroklammer für Dokumente, Reihenfolge in „Zum Wein“,
// kompakte Verkostet-Einträge und ein Formular je Charge/Flasche. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_UNIT,
  WINE_DETAIL_FIELDS,
  WINE_SECTIONS,
  closeUnit,
  discardQuestion,
  BUY_MARK,
  WINE_EXTRA_ROWS,
  docClipLines,
  drinkRow,
  encounterLine,
  encounterRows,
  grapeLine,
  markDirty,
  openUnit,
} from "@/lib/cellar/wine-units";
import { encounterSummary } from "@/lib/edit/encounters";
import { editsFromForm } from "@/lib/edit/form";

const I = "22222222-2222-4222-8222-222222222222";
const charge = { id: "item:a", label: "Charge Weinkeller" };
const wine = { id: "wine", label: "Zum Wein" };
const never = () => assert.fail("keine Rückfrage erwartet");

test("Nur eine Einheit offen: ✏️ schliesst die bisherige, ohne Änderungen ohne Rückfrage", () => {
  let s = openUnit(NO_UNIT, charge, never);
  assert.deepEqual(s.open, charge);
  s = openUnit(s, wine, never);
  assert.deepEqual(s.open, wine, "die Charge ist zu, nur „Zum Wein“ offen");
  assert.equal(openUnit(s, wine, never), s, "dieselbe nochmals: nichts passiert");
  assert.equal(closeUnit(s, "item:a"), s, "andere Einheit schliessen: nichts passiert");
  s = closeUnit(s, "wine", "Gespeichert.");
  assert.equal(s.open, null);
  assert.deepEqual(s.flash, { id: "wine", text: "Gespeichert." }, "Meldung in der Anzeige der Einheit");
  assert.equal(openUnit(s, charge, never).flash, null, "Meldung verschwindet beim nächsten ✏️");
});

test("Ungespeicherte Änderungen: Rückfrage vor dem Wechsel; Nein behält, Ja verwirft", () => {
  let s = markDirty(openUnit(NO_UNIT, charge, never), "item:a");
  assert.equal(s.dirty, true);
  assert.equal(markDirty(s, "wine"), s, "Eingabe ausserhalb der offenen Einheit zählt nicht");
  const asked: string[] = [];
  const kept = openUnit(s, wine, (q) => (asked.push(q), false));
  assert.equal(kept, s, "Nein: Charge bleibt offen, Änderungen bleiben");
  assert.deepEqual(asked, [discardQuestion("Charge Weinkeller", "Zum Wein")]);
  assert.match(asked[0], /„Charge Weinkeller“ hat ungespeicherte Änderungen\. Verwerfen und „Zum Wein“ bearbeiten\?/);
  s = openUnit(s, wine, () => true);
  assert.deepEqual([s.open, s.dirty], [wine, false], "Ja: neue Einheit offen, sauber");
  // Abbrechen schliesst ohne Rückfrage.
  assert.equal(closeUnit(markDirty(s, "wine"), "wine").open, null);
});

test("Büroklammer: je Dokument eine Zeile mit vollem Namen und 📎 rechts; ohne Dokument nur 📎", () => {
  assert.deepEqual(docClipLines([]), { lines: [], label: "Dokument hinzufügen" });
  assert.deepEqual(docClipLines(["Preisliste.pdf"]), { lines: ["Preisliste.pdf"], label: "Dokument verwalten" });
  const long = "Technisches Datenblatt Pintia 2019 Vega Sicilia – Ausbau, Lagerung und Trinkfenster.pdf";
  assert.deepEqual(docClipLines([long]).lines, [long], "lange Namen werden nicht gekürzt (umbrechen)");
  assert.deepEqual(docClipLines(["a.pdf", long, "c.pdf"]), { lines: ["a.pdf", long, "c.pdf"], label: "3 Dokumente verwalten" });
});

test("Reihenfolge in „Zum Wein“: eine Tabelle mit Rebsorten und Trinkreife, die Fotos als letzte Zeile, dann Recherche", () => {
  assert.deepEqual(WINE_DETAIL_FIELDS, ["Typ", "Land", "Region", "Appellation", "Alkohol", "Flasche", "Rebsorten", "Trinkreife"]);
  assert.deepEqual(WINE_EXTRA_ROWS, ["Laut Verkostung", "Jahrgang", "Notiz", "Fotos"], "Fotos zuletzt, ohne eigenen Abschnitt");
  assert.deepEqual(WINE_SECTIONS, ["details", "research"], "kein Abschnitt „Fotos“ mehr");
});

test("Karte „Verkostet“: leer, Zeilen „2022 · 28.10.2026 · Kronenhalle · ★ 4“, mit/ohne Merker", () => {
  assert.deepEqual(encounterRows([], true), [], "ohne Einträge keine Zeilen (nur Titel und ＋ Erfassen)");
  const plain = (t: string | null) => t?.replace(/\u00a0/g, " ") ?? null;
  const full = { id: "e1", year: 2022, tastedOn: "2026-10-28", place: { name: "Kronenhalle" }, ratings: [{ rating: 4 }] };
  assert.equal(plain(encounterLine(full)), "2022 · 28.10.2026 · Kronenhalle · ★ 4");
  assert.ok(encounterLine(full).endsWith("★\u00a04"), "„★ 4“ bricht nicht um");
  assert.equal(plain(encounterLine({ ...full, place: null, ratings: [] })), "2022 · 28.10.2026", "Fehlendes fällt weg");
  assert.equal(plain(encounterLine({ ...full, year: null, ratings: [{ rating: 4 }, { rating: 4.5 }] })), "NV · 28.10.2026 · Kronenhalle · ★ 4/4½");
  const second = { ...full, id: "e2", tastedOn: "2026-09-01", place: null };
  assert.deepEqual(encounterRows([full, second], false).map((r) => [plain(r.line), r.buy]), [
    ["2022 · 28.10.2026 · Kronenhalle · ★ 4", null],
    ["2022 · 01.09.2026 · ★ 4", null],
  ]);
  assert.deepEqual(encounterRows([full], true).map((r) => r.buy), [BUY_MARK]);
  assert.equal(plain(BUY_MARK), "🛒 kaufen");
});

test("Merker „Kaufen?“ im ✏️-Formular eines Eintrags (nur dort bzw. beim Erfassen)", () => {
  const W = "11111111-1111-4111-8111-111111111111";
  const E = "33333333-3333-4333-8333-333333333333";
  const form = (extra: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ kind: "encounter", encounterId: E, wineId: W, wantToBuyField: "1", tastedOn: "2026-10-28", ...extra })) f.set(k, v);
    return f;
  };
  const on = editsFromForm(form({ wantToBuy: "on" }));
  assert.ok(Array.isArray(on));
  assert.deepEqual(on.map((e) => e.kind), ["encounter", "wantToBuy"]);
  assert.deepEqual(on[1], { kind: "wantToBuy", wineId: W, value: true });
  const off = editsFromForm(form({}));
  assert.ok(Array.isArray(off));
  assert.deepEqual(off[1], { kind: "wantToBuy", wineId: W, value: false });
});

test("Zeilen „Rebsorten“ und „Trinkreife“: mit/ohne Prozent, leere Zeilen fehlen", () => {
  assert.equal(
    grapeLine([{ grape: "Cabernet Sauvignon", percent: 95 }, { grape: "Malbec", percent: 5 }]),
    "Cabernet Sauvignon 95 % · Malbec 5 %",
  );
  assert.equal(grapeLine([{ grape: "Tempranillo", percent: null }, { grape: "Garnacha", percent: null }]), "Tempranillo · Garnacha");
  assert.equal(grapeLine([{ grape: "Merlot", percent: 60 }, { grape: "Cabernet Franc", percent: null }]), "Merlot 60 % · Cabernet Franc");
  assert.equal(grapeLine([]), null, "keine Rebsorten → Zeile fehlt");
  assert.deepEqual(drinkRow("ready", "2025–2029"), { status: "ready", window: "2025–2029" });
  assert.deepEqual(drinkRow("wait", null), { status: "wait", window: null });
  assert.equal(drinkRow("unknown", null), null, "unbekannt ohne Fenster → Zeile fehlt");
});

test("Formular „Zum Wein“: Stammdaten, Rebsorten und Trinkfenster mit einem Speichern", () => {
  const W = "11111111-1111-4111-8111-111111111111";
  const form = (extra: Record<string, string>) => {
    const f = new FormData();
    const base = { kind: "wineCard", wineId: W, from: "2019", name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", drinkFrom: "2025", drinkUntil: "2029", to: "2019" };
    for (const [k, v] of Object.entries({ ...base, ...extra })) f.set(k, v);
    return f;
  };
  const before = JSON.stringify([{ grape: "Tinta de Toro", percent: "" }]);
  const changed = editsFromForm(form({ sharesBefore: before, shares: JSON.stringify([{ grape: "Tinta de Toro", percent: "95" }, { grape: "Garnacha", percent: "5 %" }, { grape: "", percent: "" }]) }));
  assert.ok(Array.isArray(changed), JSON.stringify(changed));
  assert.deepEqual(changed.map((e) => e.kind), ["wine", "grapes", "drinkWindow", "vintage"], "Jahrgang zuletzt");
  assert.deepEqual(changed[1], { kind: "grapes", wineId: W, year: 2019, shares: [{ grape: "Tinta de Toro", percent: 95 }, { grape: "Garnacha", percent: 5 }] });
  assert.deepEqual(changed[2], { kind: "drinkWindow", wineId: W, year: 2019, from: 2025, until: 2029 });
  // Rebsorten unverändert: keine Bearbeitung (Angaben „alle Jahrgänge“ bleiben, wie sie sind).
  const same = editsFromForm(form({ sharesBefore: before, shares: before }));
  assert.ok(Array.isArray(same));
  assert.deepEqual(same.map((e) => e.kind), ["wine", "drinkWindow", "vintage"]);
  // Ungültiger Anteil / Anteil ohne Sorte: Fehlermeldung, nichts gespeichert
  assert.deepEqual(editsFromForm(form({ sharesBefore: before, shares: JSON.stringify([{ grape: "Merlot", percent: "120" }]) })), { error: "Ungültiger Anteil bei Merlot (1–100 %)." });
  assert.deepEqual(editsFromForm(form({ sharesBefore: before, shares: JSON.stringify([{ grape: "", percent: "40" }]) })), { error: "Bitte bei jedem Anteil auch die Rebsorte angeben." });
});

test("Verkostet-Eintrag kompakt: Datum · Ort · Preis · Sterne", () => {
  const e = {
    tastedOn: "2026-10-12",
    place: { id: "p", name: "Kronenhalle", kind: "restaurant", city: "Zürich" },
    price: 14,
    priceUnit: "glass",
    currency: "CHF",
    ratings: [
      { personId: "m", name: "Michel", rating: 4.5 },
      { personId: "s", name: "Sara", rating: 4 },
    ],
  };
  assert.match(encounterSummary(e), /^12\.10\.2026 · Kronenhalle · CHF\s14\.00 \/ Glas · Michel 4½ ★, Sara 4 ★$/);
  assert.equal(encounterSummary({ ...e, place: null, price: null, ratings: [] }), "12.10.2026");
});

test("Ein Formular je offene/getrunkene Flasche (ein „Speichern“): Angaben + Status-Felder", () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };
  const base = { kind: "batch", itemId: I, giftField: "1", vintage: "2019", vintageBefore: "2019" };
  const open = editsFromForm(form({ ...base, room: "Küche", roomBefore: "Küche", fill: "60", openedOn: "2026-10-20" }));
  assert.deepEqual(Array.isArray(open) && open.map((e) => e.kind), ["batch", "openBottle"]);
  assert.deepEqual(Array.isArray(open) && open[1], { kind: "openBottle", itemId: I, fill: 60, openedOn: "2026-10-20" });
  const drunk = editsFromForm(form({ ...base, drunkOn: "2026-10-01", reopenFill: "50" }));
  assert.deepEqual(Array.isArray(drunk) && drunk.map((e) => e.kind), ["batch", "drunkBottle"]);
  const reopen = editsFromForm(form({ ...base, drunkOn: "2026-10-01", reopen: "on", reopenFill: "40" }));
  assert.deepEqual(Array.isArray(reopen) && reopen.at(-1), { kind: "reopen", itemId: I, fill: 40 }, "„Zurück auf offen“ statt Datum");
  assert.equal(Array.isArray(reopen) && reopen.some((e) => e.kind === "drunkBottle"), false);
});
