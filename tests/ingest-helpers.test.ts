// Bausteine der Erfassung: Job-IDs, Callback-Format, Preis-/Mengen-Parser, Normalisierung des
// Vorschlags, Rebsorten mit %, Vorschlagstext (Ich-Form), Normalpreis- und Händler-Knöpfe.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatShares, hasAnyPercent, hasCompletePercents, normalizeGrapeShares, percentSum } from "@/lib/grapes/shares";
import { parsePrice, priceDiscount } from "@/lib/format";
import { jobIdFor } from "@/lib/ingest/jobs";
import {
  callbackData, locationKeyboard, parseCallbackData, parsePrice as botParsePrice, parseQuantity, proposalMessage,
  regularPriceKeyboard, reviewKeyboard, skipVendorKeyboard, vendorKeyboard,
} from "@/lib/ingest/messages";
import { missingEnrichableFields, normalizeProposal } from "@/lib/ingest/schema";
import type { TgInlineButton } from "@/lib/telegram/types";

const id = jobIdFor(123, "album-1");
/** callback_data eines Knopfs (URL-Knöpfe haben keine). */
const cbd = (b: TgInlineButton) => ("callback_data" in b ? b.callback_data : "");

test("Job-ID: stabil pro Chat und Album (UUID v5)", () => {
  assert.equal(jobIdFor(123, "album-1"), id);
  assert.notEqual(jobIdFor(123, "album-2"), id);
  assert.notEqual(jobIdFor(124, "album-1"), id);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("Callbacks: ≤ 64 Bytes, nur bekannte Aktionen mit gültiger Job-ID", () => {
  for (const kb of [reviewKeyboard(id), locationKeyboard(id)]) {
    for (const btn of kb.inline_keyboard.flat()) {
      assert.ok(Buffer.byteLength(cbd(btn)) <= 64, cbd(btn));
      assert.ok(parseCallbackData(cbd(btn)));
    }
  }
  assert.deepEqual(parseCallbackData(callbackData("loc", id, "keller")), { action: "loc", jobId: id, value: "keller" });
  assert.equal(parseCallbackData(`evil:${id}`), null);
  assert.equal(parseCallbackData("save:not-a-uuid"), null);
});

test("Preis und Menge aus Text", () => {
  assert.equal(botParsePrice, parsePrice);
  assert.equal(parsePrice("24.50"), 24.5);
  assert.equal(parsePrice("24,50"), 24.5);
  assert.equal(parsePrice("CHF 24.-"), 24);
  assert.equal(parsePrice("1'250"), 1250);
  assert.equal(parsePrice("gratis"), null);
  assert.equal(parseQuantity("6"), 6);
  assert.equal(parseQuantity("12 Flaschen"), 12);
  assert.equal(parseQuantity("0"), null);
  assert.equal(parseQuantity("abc"), null);
});

test("Rabatt gegenüber Normalpreis", () => {
  assert.deepEqual(priceDiscount(20, 25), { amount: 5, percent: 20 });
  assert.deepEqual(priceDiscount(24.9, 29.9), { amount: 5, percent: 16.7 });
  assert.deepEqual(priceDiscount(30, 25), { amount: -5, percent: -20 });
  for (const [paid, regular] of [[25, 25], [null, 25], [25, null], [0, 0]] as const) assert.equal(priceDiscount(paid, regular), null);
});

test("Vorschlag normalisieren: Leeres → null, unplausibler Jahrgang weg, Trauben bereinigt", () => {
  const n = normalizeProposal({
    name: "  Reserva ", producer: "", vintage_year: 1700, country: "Spanien", region: null, appellation: " ", type: "red",
    grape_shares: [{ grape: " Tempranillo", percent: 85 }, { grape: "tempranillo", percent: 10 }, { grape: "", percent: null }],
    alcohol_content: 14.04, bottle_size_ml: 750,
  });
  assert.deepEqual(n, {
    name: "Reserva", producer: null, vintage_year: null, country: "Spanien", region: null, appellation: null, type: "red",
    grape_shares: [{ grape: "Tempranillo", percent: 85 }], alcohol_content: 14, bottle_size_ml: 750,
  });
  assert.deepEqual(missingEnrichableFields(n), ["producer", "region", "appellation"]);
});

test("Rebsorten mit %: Summe > 100 verwirft %, ungültige % → null, Duplikate weg", () => {
  assert.deepEqual(normalizeGrapeShares([{ grape: " Cabernet  Sauvignon ", percent: 60.004 }, { grape: "Merlot", percent: 40 }]),
    [{ grape: "Cabernet Sauvignon", percent: 60 }, { grape: "Merlot", percent: 40 }]);
  assert.deepEqual(normalizeGrapeShares([{ grape: "A", percent: 80 }, { grape: "B", percent: 40 }]),
    [{ grape: "A", percent: null }, { grape: "B", percent: null }]);
  assert.equal(normalizeGrapeShares([{ grape: "A", percent: 33.4 }, { grape: "B", percent: 33.4 }, { grape: "C", percent: 33.4 }])[0].percent, 33.4, "Rundungstoleranz");
  assert.deepEqual(normalizeGrapeShares([{ grape: "A", percent: 0 }, { grape: "B", percent: 120 }, { grape: "a", percent: 10 }]),
    [{ grape: "A", percent: null }, { grape: "B", percent: null }]);
  assert.equal(percentSum([{ grape: "A", percent: 60 }, { grape: "B", percent: null }]), 60);
  assert.equal(hasCompletePercents([]), false);
  assert.equal(hasCompletePercents([{ grape: "A", percent: 100 }]), true);
  assert.equal(hasCompletePercents([{ grape: "A", percent: 60 }, { grape: "B", percent: null }]), false);
  assert.equal(hasAnyPercent([{ grape: "A", percent: null }]), false);
  assert.equal(formatShares([{ grape: "Syrah", percent: 92.5 }, { grape: "Viognier", percent: null }]), "Syrah 92.5 %, Viognier");
});

test("Vorschlagstext: HTML maskiert, ohne Technik (Modell/Prozent), bekannter Wein, Recherche in der Ich-Form", () => {
  const proposal = { name: "Reserva", producer: "Bodega <A&B>", vintage_year: 2019, country: "Spanien", region: null, appellation: null, type: "red" as const,
    grape_shares: [{ grape: "Tempranillo", percent: 85 }], alcohol_content: 14, bottle_size_ml: 750 };
  const recognition = { model: "claude-haiku-5-5", confidence: 0.86, notes: null, enriched_fields: ["region" as const], sources: [] };
  const msg = proposalMessage({ step: "review", proposal, recognition, grape_source: "research" }, true);
  assert.ok(msg.includes("Bodega &lt;A&amp;B&gt;"));
  assert.ok(!msg.includes("Haiku") && !msg.includes("86 %") && !msg.includes("Erkennung"), "keine technischen Angaben");
  assert.ok(msg.includes("Trauben: Tempranillo 85 %"));
  assert.ok(msg.includes("📅 Jahrgang: 2019"));
  assert.ok(msg.includes("Die Rebsorten habe ich für diesen Jahrgang recherchiert"));
  assert.ok(msg.includes("Diesen Wein kenne ich schon – ich lege nur eine neue Charge an."));
  assert.ok(msg.includes("Im Web ergänzt habe ich: Region"));
  const fromLabel = proposalMessage({ step: "review", proposal, recognition: { ...recognition, enriched_fields: [] }, grape_source: "label" }, false);
  assert.ok(!fromLabel.includes("recherchiert") && !fromLabel.includes("kenne ich schon"));
});

test("Normalpreis-Knöpfe: „✅ Ja, gleich“ und „✏️ Anderer Betrag“ nur mit bezahltem Preis", () => {
  const withPaid = regularPriceKeyboard(id, 20).inline_keyboard.slice(0, 2).flat();
  assert.deepEqual(withPaid.map((b) => b.text), ["✅ Ja, gleich", "✏️ Anderer Betrag", "🤷 Weiss ich nicht"]);
  assert.deepEqual(withPaid.map((b) => parseCallbackData(cbd(b))?.action), ["sameprice", "regother", "skipregular"]);
  for (const b of withPaid) assert.ok(Buffer.byteLength(cbd(b)) <= 64);
  assert.deepEqual(regularPriceKeyboard(id, null).inline_keyboard[0].map((b) => b.text), ["🤷 Weiss ich nicht"]);
});

test("Händler-Knöpfe: zwei pro Zeile, höchstens 12, plus Neu/Überspringen und Abbrechen", () => {
  const names = Array.from({ length: 12 }, (_, i) => ({ name: `Händler ${i + 1} mit langem Namen` }));
  const kb = vendorKeyboard(id, names).inline_keyboard;
  assert.equal(kb.length, 8);
  assert.deepEqual(kb[7].map((b) => b.text), ["✖️ Abbrechen"]);
  assert.deepEqual(kb[0].map((b) => b.text), ["Händler 1 mit langem Namen", "Händler 2 mit langem Namen"]);
  assert.deepEqual(kb[6].map((b) => b.text), ["➕ Neuer Händler", "Überspringen"]);
  for (const b of kb.flat()) {
    assert.ok(Buffer.byteLength(cbd(b)) <= 64, cbd(b));
    assert.ok(parseCallbackData(cbd(b)), cbd(b));
  }
  assert.deepEqual(parseCallbackData(cbd(kb[5][1])), { action: "vendor", jobId: id, value: "11" });
  assert.equal(vendorKeyboard(id, []).inline_keyboard.length, 2);
  assert.equal(vendorKeyboard(id, [{ name: "A" }]).inline_keyboard[0].length, 1);
  assert.equal(parseCallbackData(cbd(skipVendorKeyboard(id).inline_keyboard[0][0]))?.action, "skipvendor");
});
