// Geschmacksprofil automatisch nach dem Erfassen: nach dem Einbuchen (Foto, Text, Nachkauf
// ohne Profil) und nach „Verkostet“ (Bot und App) im Hintergrund für genau diesen Jahrgang.
// Schon ein Profil → nicht suchen; nichts gefunden oder Fehler → keine Meldung, nur Log.
// Dazu: Upload-Limit 20 MB in App und Bot. Supabase, Telegram, Claude per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { claudeError, claudeTool, installNet, type Net } from "./stub-net";
import { saveJob } from "@/lib/ingest/flow";
import { applyEdit } from "@/lib/edit/edit";
import { runLater } from "@/lib/later";
import { handleUpdate } from "@/lib/ingest/bot";
import { T } from "@/lib/bot/texts";
import { MENU_SOURCE } from "@/lib/chat/pending";
import { MENU_VERSION } from "@/lib/chat/menu-view";
import { DOCUMENT_TOO_BIG, MAX_DOCUMENT_BYTES } from "@/lib/media/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import { UNKNOWN } from "@/lib/taste/profile";

const MICHEL = "86c222d0-3a8c-4d5f-9564-f5654769ecd6";
const W = "11111111-1111-4111-8111-111111111111";
const SRC = "https://pintia.example/ficha-2019";
type Row = Record<string, unknown>;

/** Antwort der Profil-Recherche: belegt für 2019 (bzw. den angefragten Jahrgang). */
const found = (year: number) =>
  claudeTool("report_taste_profile", {
    matches_wine: true, same_vintage: true,
    sources: [{ url: SRC, title: "Ficha", kind: "producer", vintage: year }],
    fields: { sweetness: "trocken", acidity: UNKNOWN, tannin: "hoch", alcohol: UNKNOWN, body: "voll", flavour_intensity: UNKNOWN, finish: UNKNOWN },
    aromas: [], evidence: [{ field: "body", source_url: SRC, quote: "full-bodied" }, { field: "tannin", source_url: SRC, quote: "firm tannins" }],
    contradictions: [], style_summary: "", food_pairing: [],
  });

let tasteReply: (year: number) => Record<string, unknown> = found;
const tasteCalls: string[] = [];
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    const prompt = String((body.messages as { content: string }[])[0].content);
    if (tools.includes("report_taste_profile")) {
      tasteCalls.push(prompt);
      const year = Number(prompt.match(/"jahrgang":(\d{4})/)?.[1] ?? 0);
      return tasteReply(year);
    }
    throw new Error(`unerwarteter Claude-Aufruf: ${tools.join(",")}`);
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function reset(extra: Partial<Record<string, Row[]>> = {}) {
  net.tables = {
    persons: [{ id: MICHEL, name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], wine_vintages: [], wine_grape_shares: [], vendors: [], wine_media: [],
    wine_encounters: [], wine_ratings: [], places: [], wine_taste_profiles: [], research_suggestions: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: "m1", source: MENU_SOURCE, telegram_chat_id: 111, status: "confirmed", extracted: { version: MENU_VERSION }, created_at: minutesAgo(999), updated_at: minutesAgo(999) }],
    ...extra,
  };
  net.telegram.length = 0;
  tasteCalls.length = 0;
  tasteReply = found;
}
const profiles = () => net.tables.wine_taste_profiles;
const sent = () => net.telegram.filter((t) => t.method === "sendMessage").map((m) => String(m.body.text));

function purchaseJob(id: string, source: "photo" | "text", matched: string | null = null, restock = false): Row {
  const job = {
    id, source: source === "text" ? "text" : "telegram", telegram_chat_id: 111, status: "processing", photo_paths: [], matched_wine_id: matched,
    created_at: minutesAgo(1), updated_at: minutesAgo(1),
    extracted: {
      step: "saving", source, restock: restock || undefined,
      proposal: { name: "Pintia", producer: "Vega Sicilia", vintage_year: 2019, country: "Spanien", region: "Toro", appellation: null, type: "red", grape_shares: [], alcohol_content: null, bottle_size_ml: 750 },
      recognition: { model: "x", confidence: 1, notes: null, enriched_fields: [], sources: [] },
      storage_room: "Weinkeller", quantity: 6, vintage_confirmed: true,
    },
  };
  net.tables.ingest_jobs.push(job);
  return job;
}

test("Einbuchen per Foto und per Text: erst speichern und antworten, dann das Profil für genau diesen Jahrgang", async () => {
  for (const source of ["photo", "text"] as const) {
    reset();
    const job = purchaseJob(`aaaaaaaa-0000-4000-8000-00000000000${source === "photo" ? 1 : 2}`, source);
    await saveJob(job as never, 111);
    assert.match(sent().at(-1)!, /ich habe 6 Flaschen Pintia 2019 im Weinkeller eingebucht/, source);
    assert.equal(tasteCalls.length, 0, "die Antwort wartet nicht auf die Recherche");
    assert.equal(profiles().length, 0);
    await runLater();
    assert.equal(tasteCalls.length, 1, source);
    assert.match(tasteCalls[0], /"jahrgang":2019/);
    assert.deepEqual([profiles()[0].vintage_year, profiles()[0].body, profiles()[0].tannin, profiles()[0].source], [2019, "voll", "hoch", "research"]);
    assert.equal(sent().length, 1, "keine weitere Meldung zum Profil");
  }
});

test("Nachkauf: Jahrgang ohne Profil → suchen; Profil schon vorhanden → nicht suchen", async () => {
  const wine = { id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: 14.5, grapes: [] };
  // Profil nur für 2018 → 2019 wird gesucht
  reset({ wines: [wine], inventory_items: [{ id: "i0", wine_id: W, vintage_year: 2019, status: "sealed", quantity: 2 }], wine_taste_profiles: [{ id: "p18", wine_id: W, vintage_year: 2018, source: "research", aromas: {}, food_pairing: [], sources: [], evidence: {} }] });
  await saveJob(purchaseJob("bbbbbbbb-0000-4000-8000-00000000000b", "text", W, true) as never, 111);
  await runLater();
  assert.equal(tasteCalls.length, 1);
  assert.deepEqual(profiles().map((p) => p.vintage_year).sort(), [2018, 2019]);

  // Profil für 2019 schon da → keine Recherche
  reset({ wines: [wine], wine_taste_profiles: [{ id: "p19", wine_id: W, vintage_year: 2019, source: "manual", body: "mittel", aromas: {}, food_pairing: [], sources: [], evidence: {} }] });
  await saveJob(purchaseJob("cccccccc-0000-4000-8000-00000000000c", "photo", W, true) as never, 111);
  await runLater();
  assert.equal(tasteCalls.length, 0, "Profil vorhanden → nicht suchen");
  assert.equal(profiles()[0].body, "mittel");
});

test("Verkostet in Bot und App: Profil für den Jahrgang des Eintrags im Hintergrund", async () => {
  for (const source of ["bot", "app"] as const) {
    reset({ wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", want_to_buy: false, grapes: [] }] });
    const result = await applyEdit(db, { kind: "addEncounter", wine: { wineId: W }, year: 2019, set: {}, personId: MICHEL, source, ratings: [] });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(net.tables.wine_encounters.length, 1);
    assert.equal(tasteCalls.length, 0, "Speichern wartet nicht");
    await runLater();
    assert.equal(tasteCalls.length, 1, source);
    assert.equal(profiles()[0]?.vintage_year, 2019, source);
  }
  // Neuer Wein ohne Jahrgang (NV): Profil für den Wein
  reset();
  tasteReply = () => found(0);
  const nv = await applyEdit(db, { kind: "addEncounter", wine: { new: { name: "Brut Réserve", producer: "Haus X" } }, year: null, set: {}, personId: MICHEL, source: "app", ratings: [] });
  assert.ok(nv.ok, JSON.stringify(nv));
  await runLater();
  assert.match(tasteCalls[0], /ohne Jahrgang/);
  assert.equal(profiles()[0]?.vintage_year, null);
});

test("Nichts gefunden oder API-Limit: keine Meldung, Fehler nur im Log", async () => {
  reset({ wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", want_to_buy: false, grapes: [] }] });
  tasteReply = () => claudeTool("report_taste_profile", { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] });
  assert.ok((await applyEdit(db, { kind: "addEncounter", wine: { wineId: W }, year: 2019, set: {}, personId: MICHEL, source: "bot", ratings: [] })).ok);
  await runLater();
  assert.equal(profiles().length, 0);

  tasteReply = () => claudeError(400, "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.") as never;
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    assert.ok((await applyEdit(db, { kind: "addEncounter", wine: { wineId: W }, year: 2019, set: {}, personId: MICHEL, source: "bot", ratings: [] })).ok);
    await runLater();
  } finally {
    console.error = original;
  }
  assert.ok(logged.some((l) => l.startsWith("taste profile auto failed")), logged.join("\n"));
  assert.equal(profiles().length, 0);
  assert.equal(sent().length, 0, "keine Meldung an die Person");
});

test("Upload-Limit 20 MB in App und Bot, dieselbe Meldung ohne Verweis auf die App", async () => {
  assert.equal(MAX_DOCUMENT_BYTES, 20 * 1024 * 1024);
  assert.equal(T.docTooBig, DOCUMENT_TOO_BIG);
  assert.equal(DOCUMENT_TOO_BIG, "Das PDF ist leider zu gross (über 20 MB). Magst du es verkleinern und nochmals versuchen?");
  assert.doesNotMatch(DOCUMENT_TOO_BIG, /App/);
  // Bot: über 20 MB abgelehnt, bis 20 MB angenommen (Frage nach dem Wein)
  reset();
  const doc = (size: number) => ({ update_id: 1, message: { message_id: 5, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, document: { file_id: "f", file_unique_id: "u", file_name: "gross.pdf", mime_type: "application/pdf", file_size: size } } });
  await handleUpdate(doc(20 * 1024 * 1024 + 1) as never);
  assert.equal(sent().at(-1), DOCUMENT_TOO_BIG);
  await handleUpdate(doc(19 * 1024 * 1024) as never);
  assert.match(sent().at(-1)!, /Zu welchem Wein gehört das\?/);
  // App: Browser-Prüfung und Server-Prüfung nutzen dieselbe Grenze und Meldung
  const page = readFileSync("src/app/(cellar)/wein/[id]/documents.tsx", "utf8");
  assert.ok(page.includes("file.size > MAX_DOCUMENT_BYTES") && page.includes("DOCUMENT_TOO_BIG") && page.includes("max. {MAX_DOCUMENT_MB} MB"));
  assert.ok(!/10 MB|10 \* 1024/.test(page));
  const action = readFileSync("src/app/(cellar)/document-actions.ts", "utf8");
  assert.ok(action.includes("size > MAX_DOCUMENT_BYTES) return discard(DOCUMENT_TOO_BIG)"));
});
