// Verkostung (WSET SAT): Bewertungslogik der App, Erfassung im Bot per Erzählen (Extraktion,
// nur gültige Werte, fehlende Kategorien), Verkostungs-Karte und Start aus dem Wein-Menü.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { applyExtraction, draftSummary, extractableFields, missingCategories } from "@/lib/tasting/bot-draft";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { cardScreen, isTastingCallback, type TastingDraft } from "@/lib/chat/tasting";
import { decodeMenu, encodeMenu, isMenuCallback } from "@/lib/chat/menu-view";
import { extractionSchema } from "@/lib/tasting/extract";
import { isChatCallback } from "@/lib/chat/proposals";
import {
  SAT_TYPES, autoEvaluate, currentScore, freshData, manualScoresFromData, newTastingData, normalizeData, satTypeForWine, switchType, toggleField, toText,
} from "@/lib/tasting/sat";
import { parseCallbackData } from "@/lib/ingest/messages";
import { screenFor } from "@/lib/chat/menu";
import { tastingRow } from "@/lib/tasting/store";

const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", W = "11111111-1111-4111-8111-111111111111";

test("SAT: manuelle Werte bleiben beim Laden, Qualität von Hand, fehlerhaft ist Pflicht", () => {
  const today = "2026-10-27";
  // Gespeicherte Verkostung mit manueller Balance 0.5 → bleibt beim Laden erhalten
  let d = autoEvaluate(freshData(today), new Set()).data;
  d = autoEvaluate(toggleField(d, { key: "balance" }, "0.5"), new Set(["balance"])).data;
  d = autoEvaluate(toggleField(d, { key: "abgang" }, "lang"), new Set(["balance"])).data;
  const reloaded = normalizeData(JSON.parse(JSON.stringify(d)), today);
  const manual = manualScoresFromData(reloaded);
  assert.deepEqual([...manual], ["balance"]);
  assert.equal(autoEvaluate(reloaded, manual).data.fields.balance, "0.5");
  // Abweichung vom Tool: Qualität von Hand gilt
  let q = autoEvaluate(toggleField(d, { key: "geschmackIntensitaet" }, "ausgeprägt"), manual).data;
  q = autoEvaluate({ ...q, aromas: { "Rote Früchte": ["Erdbeere"] } }, manual).data;
  assert.equal(q.fields.qualitaet, "gut"); // 0.5 + 1 + 1 + 0
  q = autoEvaluate(toggleField(q, { key: "qualitaet" }, "sehr gut"), manual).data;
  assert.equal(q.fields.qualitaet, "sehr gut");
  // fehlerhaft bleibt Pflicht
  q = autoEvaluate(toggleField(q, { key: "klarheit" }, "trüb (fehlerhaft?)"), manual).data;
  assert.equal(q.fields.qualitaet, "fehlerhaft");
  assert.equal(satTypeForWine("red"), "rot"); assert.equal(satTypeForWine("fortified"), "suess"); assert.equal(satTypeForWine(null), "weiss");
  const s = switchType(freshData(today), "schaum");
  assert.ok(toText(s).includes("Mousse:")); assert.ok(!toText(s).includes("Tannin:"));
});

test("Bot: Erzählen → Felder und Aromen (nur gültige), Punkte, fehlende Kategorien, DB-Zeile", () => {
  // Schema für alle Weinarten erzeugbar (strukturierte Ausgabe)
  for (const { type } of SAT_TYPES) {
    const fmt = betaZodOutputFormat(extractionSchema(type)) as { schema: Record<string, unknown> };
    assert.ok(JSON.stringify(fmt.schema).length > 1000, type);
  }
  assert.ok(!extractableFields("weiss").some((f) => f.key === "tannin"));
  assert.ok(extractableFields("rot").some((f) => f.key === "tannin"));
  assert.ok(extractableFields("schaum").some((f) => f.key === "mousse"));
  assert.ok(!extractableFields("rot").some((f) => f.key === "qualitaet"), "Qualität rechnet die App-Logik");

  const wine = { name: "Palermo", producer: "Tasca", region: "Sizilien", country: "Italien", type: "red" };
  let sat = newTastingData(wine, 2022, "Nero d'Avola", "2026-10-27");
  assert.equal(sat.type, "rot"); assert.equal(sat.meta.vintage, "2022"); assert.equal(sat.fields.balance, "1");
  assert.deepEqual(missingCategories(sat), ["Geschmacksintensität", "Abgang", "Aromen", "Entwicklungsstadium", "Süsse", "Säure", "Tannin", "Körper", "Trinkreife"]);
  assert.match(draftSummary(sat).result, /noch offen/);

  // 1. Erzählen: ungültige Werte werden verworfen, nichts erfunden
  sat = applyExtraction(sat, {
    fields: { saeure: "mittel (+)", tannin: "sehr hoch", geschmackIntensitaet: "ausgeprägt", suesse: "trocken", koerper: null, aromaauspraegung: ["primär", "quatsch"] },
    aromas_add: [
      { group: "Rote Früchte", aroma: "rote Kirsche" }, { group: "Floral", aroma: "Veilchen" },
      { group: "Eiche", aroma: "Vanille" }, { group: "Rote Früchte", aroma: "Vanille" }, // falsche Gruppe → weg
    ],
    aromas_remove: [],
    notes: "zu Pasta",
  });
  assert.equal(sat.fields.saeure, "mittel (+)"); assert.equal(sat.fields.tannin, undefined); assert.equal(sat.fields.koerper, undefined);
  assert.deepEqual(sat.fields.aromaauspraegung, ["primär"]);
  assert.deepEqual(sat.aromas, { "Rote Früchte": ["rote Kirsche"], Floral: ["Veilchen"], Eiche: ["Vanille"] });
  assert.equal(sat.fields.intensitaet, "1", "Intensität aus Geschmacksintensität");
  assert.equal(sat.fields.komplexitaet, "0", "3 Aromen → 0");
  assert.equal(currentScore(sat), null, "Länge fehlt noch");
  assert.deepEqual(missingCategories(sat), ["Abgang", "Entwicklungsstadium", "Tannin", "Körper", "Trinkreife"]);

  // 2. Ergänzen: Abgang, Korrektur eines Aromas, mehr Aromen
  sat = applyExtraction(sat, {
    fields: { abgang: "lang", entwicklung: "jugendlich", tannin: "mittel", koerper: "voll", trinkreife: "kann jetzt getrunken werden, hat aber noch Reifungspotenzial" },
    aromas_add: [
      { group: "Schwarze Früchte", aroma: "Brombeere" }, { group: "Scharfe Gewürze", aroma: "schwarzer Pfeffer" },
      { group: "Eiche", aroma: "Zedernholz" }, { group: "Schwarze Früchte", aroma: "schwarze Pflaume" },
    ],
    aromas_remove: [{ group: "Eiche", aroma: "Vanille" }],
    notes: null,
  });
  assert.deepEqual(sat.aromas.Eiche, ["Zedernholz"]);
  assert.equal(sat.fields.laenge, "1");
  assert.equal(sat.fields.komplexitaet, "0.5", "6 Aromen in 5 Gruppen → 0.5");
  assert.equal(currentScore(sat), 3.5);
  assert.equal(sat.fields.qualitaet, "sehr gut");
  assert.deepEqual(missingCategories(sat), []);
  assert.equal(sat.notes, "zu Pasta");
  const sum = draftSummary(sat);
  assert.equal(sum.result, "sehr gut · 3.5 / 4 Punkte");
  assert.match(sum.nose, /rote Kirsche/); assert.match(sum.palate, /Säure mittel \(\+\) · Tannin mittel · Körper voll · Intensität ausgeprägt · Abgang lang/);
  assert.equal(sat.byType.rot.fields.abgang, "lang", "byType synchron wie in der App");

  const row = tastingRow({ item: { id: "i", wine_id: "w", vintage_year: 2022 }, personId: "p", sat, today: "2026-10-27", source: "bot" });
  assert.equal(row.source, "bot"); assert.equal(row.quality_points, 3.5); assert.equal(row.quality_level, "sehr gut");
  assert.equal(row.wine_style, "Rotwein"); assert.equal(row.tasted_at, "2026-10-27"); assert.equal(row.notes, "zu Pasta");

  // Fehlerton → fehlerhaft
  const faulty = applyExtraction(sat, { fields: { reintoenigkeit: "unsauber (fehlerhaft?)" }, aromas_add: [], aromas_remove: [], notes: null });
  assert.equal(faulty.fields.qualitaet, "fehlerhaft");
});

test("Callbacks der Verkostung: eindeutig gegenüber Menü, Chat und Erfassung", () => {
  // Callbacks
  for (const a of [
    { op: "tasting", subject: { kind: "item", itemId: ITEM }, back: { kind: "open" } },
    { op: "tell", subject: { kind: "vintage", wineId: W, year: 2022 }, back: { kind: "type", code: "r" } },
  ] as const) {
    const data = encodeMenu(a);
    assert.ok(Buffer.byteLength(data) <= 64 && isMenuCallback(data) && !isTastingCallback(data) && !isChatCallback(data) && !parseCallbackData(data));
    assert.deepEqual(decodeMenu(data), a);
  }
  assert.ok(isTastingCallback(`Y:s:${ITEM}`) && !isMenuCallback(`Y:s:${ITEM}`) && !parseCallbackData(`Y:s:${ITEM}`));
});

// Menü: Startbildschirm und „Erzählen“ gegen Fake-DB
test("Bot-Menü: Start der Verkostung (offene Flasche bevorzugt), „Erzählen“ legt einen Entwurf an", async () => {
  const tables: Record<string, Record<string, unknown>[]> = {
    persons: [{ id: "c7690541-4e68-4051-aa8f-6a2920fea55b", name: "Sara", sort_order: 1 }, { id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0 }],
    wines: [{ id: W, name: "Palermo", producer: "Tasca", region: "Sizilien", country: "Italien", type: "red", grapes: ["Nero d'Avola"] }],
    inventory_items: [
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", wine_id: W, vintage_year: 2022, status: "sealed", drunk_at: null },
      { id: ITEM, wine_id: W, vintage_year: 2022, status: "open", drunk_at: null },
    ],
    cellar_wines: [], latest_wine_ratings: [], wine_grape_shares: [], ingest_jobs: [],
    cellar_overview: [{ inventory_item_id: ITEM, wine_id: W, producer: "Tasca", name: "Palermo", vintage_year: 2022, type: "red", status: "open", fill_level_percent: 50, date_opened: "2026-10-01", bottle_size_ml: 750 }],
  };
  const db = fakeDb(tables) as never;
  const start = await screenFor(db, { op: "tasting", subject: { kind: "vintage", wineId: W, year: 2022 }, back: { kind: "none" } }, { chatId: 1 });
  const app = start.screen.keyboard.inline_keyboard.flat().find((b) => "url" in b);
  assert.equal(app && "url" in app ? app.url : null, `https://mywine.example/flasche/${ITEM}/verkostung`, "offene Flasche bevorzugt");
  const item = await screenFor(db, { op: "item", itemId: ITEM, back: { kind: "open" } }, { chatId: 1 });
  assert.ok(item.screen.keyboard.inline_keyboard.flat().some((b) => b.text === "📝 Verkostung"));
  const tell = await screenFor(db, { op: "tell", subject: { kind: "item", itemId: ITEM }, back: { kind: "open" } }, { chatId: 1 });
  assert.match(tell.screen.text, /Erzähl mir deine Eindrücke/);
  assert.equal(tables.ingest_jobs.length, 1);
  const job = tables.ingest_jobs[0] as { source: string; status: string; extracted: { step: string; personId: string; sat: { type: string; meta: { vintage: string } } } };
  assert.equal(job.source, "telegram_tasting"); assert.equal(job.status, "needs_review");
  assert.equal(job.extracted.step, "text"); assert.equal(job.extracted.personId, "86c222d0-3a8c-4d5f-9564-f5654769ecd6", "Michel vorausgewählt");
  assert.equal(job.extracted.sat.type, "rot"); assert.equal(job.extracted.sat.meta.vintage, "2022");
});

test("Verkostungs-Karte im Bot: offene Kategorien, Person wechseln, Speichern", async () => {
  const M = "86c222d0-3a8c-4d5f-9564-f5654769ecd6", S = "c7690541-4e68-4051-aa8f-6a2920fea55b", J = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const db = fakeDb({ persons: [{ id: M, name: "Michel", sort_order: 0 }, { id: S, name: "Sara", sort_order: 1 }] }) as never;
  const base = newTastingData({ name: "Palermo", producer: "Tasca", region: null, country: "Italien", type: "red" }, 2022, "", "2026-10-27");
  const sat = applyExtraction(base, { fields: { saeure: "mittel (+)", geschmackIntensitaet: "mittel", suesse: "trocken" }, aromas_add: [{ group: "Rote Früchte", aroma: "rote Kirsche" }], aromas_remove: [], notes: null });
  const draft: TastingDraft = { kind: "tasting", step: "review", itemId: "i", wineId: "w", vintageYear: 2022, title: "Palermo 2022", personId: M, sat, cardMessageId: null, texts: [] };
  let card = await cardScreen(db, J, draft);
  assert.match(card.text, /Noch offen: Abgang, Entwicklungsstadium, Tannin, Körper, Trinkreife – ergänzen\?/);
  assert.deepEqual(card.keyboard.inline_keyboard.map((r) => r.map((b) => b.text)), [["✏️ Ergänzen", "💾 Trotzdem speichern"], ["👤 Für Sara", "📱 In der App bearbeiten"], ["✖️ Verwerfen"]]);
  for (const b of card.keyboard.inline_keyboard.flat()) if ("callback_data" in b) assert.ok(Buffer.byteLength(b.callback_data) <= 64);

  const full = applyExtraction(sat, { fields: { abgang: "mittel", entwicklung: "jugendlich", tannin: "mittel", koerper: "mittel", trinkreife: "zu jung" }, aromas_add: [], aromas_remove: [], notes: null });
  card = await cardScreen(db, J, { ...draft, sat: full, personId: S });
  assert.ok(!card.text.includes("Noch offen"));
  assert.match(card.text, /Palermo 2022<\/b> · Sara/);
  assert.match(card.text, /Resultat: durchschnittlich · 2 \/ 4 Punkte|Resultat: gut · 2 \/ 4 Punkte/);
  assert.deepEqual(card.keyboard.inline_keyboard[0].map((b) => b.text), ["💾 Speichern", "✏️ Korrigieren"]);
  assert.equal(card.keyboard.inline_keyboard[1][0].text, "👤 Für Michel");
});
