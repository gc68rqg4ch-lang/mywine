// Bewerten im Bot: eigene Bewertung direkt, für andere Person erst nach Rückfrage; Chat-Vorschläge
// (propose_rating) für die schreibende bzw. genannte Person; Callback-Format der Chat-Vorschläge.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "./fake-db";
import { screenFor } from "@/lib/chat/menu";
import { decodeMenu, encodeMenu } from "@/lib/chat/menu-view";
import {
  REJECT_DATA, confirmKeyboard, decodeProposal, encodeProposal, fillAfterGlasses, glassMl, isChatCallback, personKey, type Proposal,
} from "@/lib/chat/proposals";
import { chatTools, type PendingProposal } from "@/lib/chat/tools";
import { parseCallbackData } from "@/lib/ingest/messages";

const W = "11111111-1111-4111-8111-111111111111", I = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M = "86c222d0-3a8c-4d5f-9564-f5654769ecd6", S = "c7690541-4e68-4051-aa8f-6a2920fea55b";
const tables: Record<string, Record<string, unknown>[]> = {
  persons: [{ id: M, name: "Michel", sort_order: 0 }, { id: S, name: "Sara", sort_order: 1 }],
  wines: [{ id: W, producer: "Tasca", name: "Palermo", type: "red" }],
  cellar_overview: [{ inventory_item_id: I, wine_id: W, producer: "Tasca", name: "Palermo", vintage_year: 2022, type: "red", status: "open", fill_level_percent: 50, date_opened: "2026-10-01", bottle_size_ml: 750 }],
  latest_wine_ratings: [], wine_ratings: [],
};
const db = fakeDb(tables) as never;
const sara = { chatId: 1, actor: { personId: S, name: "Sara" } };
type Screen = { keyboard: { inline_keyboard: unknown[][] } };
const texts = (s: Screen) => (s.keyboard.inline_keyboard.flat() as { text: string }[]).map((b) => b.text);
const data = (s: Screen, label: string) =>
  (s.keyboard.inline_keyboard.flat() as { text: string; callback_data?: string }[]).find((b) => b.text === label)?.callback_data;

test("eigene Bewertung: direkt gespeichert", async () => {
  let { screen } = await screenFor(db, { op: "item", itemId: I, back: { kind: "open" } }, sara);
  assert.ok(texts(screen).includes("⭐ Bewerten") && texts(screen).includes("⭐ für Michel"), texts(screen).join());
  ({ screen } = await screenFor(db, decodeMenu(data(screen, "⭐ Bewerten"))!, sara));
  assert.match(screen.text, /Deine Bewertung/);
  assert.equal(decodeMenu(data(screen, "4 ★"))!.op, "rate");
  await screenFor(db, decodeMenu(data(screen, "4 ★"))!, sara);
  assert.equal(tables.wine_ratings.length, 1);
  assert.deepEqual([tables.wine_ratings[0].person_id, tables.wine_ratings[0].rating], [S, 4]);
});

test("für eine andere Person: Rückfrage vor dem Speichern", async () => {
  let { screen } = await screenFor(db, { op: "item", itemId: I, back: { kind: "open" } }, sara);
  ({ screen } = await screenFor(db, decodeMenu(data(screen, "⭐ für Michel"))!, sara));
  assert.match(screen.text, /Bewertung für Michel/);
  const ask = decodeMenu(data(screen, "3½ ★"))!;
  assert.equal(ask.op, "rateAsk");
  assert.ok(Buffer.byteLength(encodeMenu(ask)) <= 64);
  ({ screen } = await screenFor(db, ask, sara));
  assert.match(screen.text, /Für Michel 3½ ★ speichern\?/);
  assert.equal(tables.wine_ratings.length, 1, "noch nichts gespeichert");
  await screenFor(db, decodeMenu(data(screen, "✅ Ja, für Michel"))!, sara);
  assert.equal(tables.wine_ratings.length, 2);
  assert.deepEqual([tables.wine_ratings[1].person_id, tables.wine_ratings[1].rating], [M, 3.5]);
});

test("Chat: propose_rating ohne Person → wer schreibt, sonst die genannte Person", async () => {
  const pending: PendingProposal[] = [];
  const tool = chatTools(db, pending, [], { personId: S, name: "Sara" }).find((t) => t.name === "propose_rating")!;
  await tool.run({ wine_id: W, vintage_year: 2022, rating: 4.5 } as never);
  await tool.run({ wine_id: W, vintage_year: 2022, person: "Michel", rating: 3 } as never);
  assert.deepEqual(pending.map((p) => p.text), [
    "Bewertung Sara: Tasca Palermo 2022 → 4.5 von 5 Sternen",
    "Bewertung Michel: Tasca Palermo 2022 → 3 von 5 Sternen",
  ]);
  const first = pending[0];
  assert.ok("proposal" in first && first.proposal.kind === "rate" && first.proposal.personKey === S.slice(0, 8));
});

test("Chat-Vorschläge: Callback ≤ 64 Bytes, eindeutig, kollidiert nicht mit der Erfassung", () => {
  const id = "870404bb-a32b-4a2e-8706-1b13e2c69039";
  const cases: Proposal[] = [
    { kind: "fill", itemId: id, percent: 0 },
    { kind: "fill", itemId: id, percent: 100 },
    { kind: "open", itemId: id },
    { kind: "drunk", itemId: id },
    { kind: "rate", wineId: id, vintageYear: 2019, personKey: personKey(S), rating: 4.5 },
    { kind: "rate", wineId: id, vintageYear: null, personKey: "86c222d0", rating: 0 },
  ];
  for (const p of cases) {
    const encoded = encodeProposal(p);
    assert.ok(Buffer.byteLength(encoded) <= 64, encoded);
    assert.ok(isChatCallback(encoded));
    assert.equal(parseCallbackData(encoded), null, `kollidiert mit Erfassungs-Callbacks: ${encoded}`);
    assert.deepEqual(decodeProposal(encoded), p);
    assert.deepEqual(confirmKeyboard(p).inline_keyboard[0].map((b) => b.text), ["Ja", "Nein"]);
  }
  assert.ok(isChatCallback(REJECT_DATA));
  for (const bad of [`cf:${id}:101`, `cr:${id}:2019:zz:9`, `cr:${id}:2019:86c222d0:11`, "co:nope", `save:${id}`, undefined]) {
    assert.equal(decodeProposal(bad), null, String(bad));
  }
  for (const a of ["save", "fix", "drop", "loc", "qty", "vendor", "skipvendor"]) assert.equal(isChatCallback(`${a}:${id}`), false);
});

test("Gläser: Füllstand nach 1–2 Gläsern je Flaschengrösse", () => {
  assert.equal(fillAfterGlasses(100, 1, 750), 80);
  assert.equal(fillAfterGlasses(100, 2, 750), 60);
  assert.equal(fillAfterGlasses(100, 1, 500), 70);
  assert.equal(fillAfterGlasses(100, 1, 1500), 90);
  assert.equal(fillAfterGlasses(30, 2, 750), 0);
  // Glasgrösse nach Art: Wein 15 cl, Likörwein 7 cl, Spirituose 5 cl
  assert.deepEqual([glassMl("red"), glassMl(null), glassMl("fortified"), glassMl("spirit")], [150, 150, 70, 50]);
  assert.equal(fillAfterGlasses(100, 1, 750, "white"), 80, "0,75 l Wein: −20 %");
  assert.equal(fillAfterGlasses(100, 1, 700, "spirit"), 93, "0,7 l Spirituose: −7 %");
  assert.equal(fillAfterGlasses(100, 1, 750, "fortified"), 91, "0,75 l Likörwein: −9 %");
  assert.equal(fillAfterGlasses(100, 2, 700, "spirit"), 86);
  assert.equal(fillAfterGlasses(100, 1, 0), 80);
});

test("Chat-Tools: eindeutige Namen, Objekt-Schemas", () => {
  const tools = chatTools({} as never, []) as { name: string; input_schema?: { type: string } }[];
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of tools) assert.equal(t.input_schema?.type, "object", t.name);
});
