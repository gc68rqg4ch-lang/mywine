// API-Ausgabenlimit erreicht: Sammellauf stoppt sofort (nacheinander, keine weiteren Anfragen),
// gescheiterte Weine bleiben „nicht recherchiert“, klare Meldungen in App und Bot (offene
// Erfassung bleibt), 429/529 = vorübergehend. Claude, Telegram und Supabase per Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { claudeError, claudeTool, installNet, type Net } from "./stub-net";
import { apiProblem, apiProblemForBot, temporaryProblem, usageLimit } from "@/lib/ai/api-errors";
import { limitHaltMessage, runBatch } from "@/lib/research/batch";
import { researchSummary } from "@/lib/research/summary";
import { researchAndFillWine, type ResearchOutcome } from "@/lib/research/wine";
import { handleUpdate, processJob } from "@/lib/ingest/bot";
import { jobIdFor, photoFolder } from "@/lib/ingest/jobs";
import type { IngestState } from "@/lib/ingest/schema";
import { createAdminClient } from "@/lib/supabase/admin";

const LIMIT = "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
const W = "11111111-1111-4111-8111-111111111111";
let claudeCalls = 0;
let reply: () => Record<string, unknown> = () => claudeError(400, LIMIT) as never;
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: () => {
    claudeCalls++;
    return reply();
  },
};
installNet(net);
const db = createAdminClient();
const sdkError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

/** Console mitschreiben. */
async function capture<T>(fn: () => Promise<T>) {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

test("Einordnung: Ausgabenlimit vs. vorübergehend (429/529) vs. andere", () => {
  assert.equal(apiProblem(sdkError(400, "invalid_request_error", LIMIT))?.kind, "usage_limit");
  for (const [status, type] of [[429, "rate_limit_error"], [529, "overloaded_error"]] as const) {
    const error = sdkError(status, type, status === 429 ? "Number of request tokens has exceeded your per-minute rate limit" : "Overloaded");
    assert.equal(usageLimit(error), null, `${status} ist kein Ausgabenlimit`);
    assert.equal(temporaryProblem(error), true);
    assert.equal(apiProblem(error)?.kind, "temporary", String(status));
    assert.match(apiProblem(error)!.message, /vorübergehend/);
    assert.match(apiProblemForBot(error)!, /in ein paar Minuten/, "Bot: vorübergehend, nicht „Kontingent aufgebraucht“");
    assert.doesNotMatch(apiProblemForBot(error)!, /Kontingent/);
  }
  assert.equal(apiProblem(sdkError(400, "invalid_request_error", "messages: text content blocks must be non-empty"))?.kind, "api");
});

test("Sammellauf mit 5 Weinen, Limit beim 2. → genau 2 Anfragen, „1 von 5 erledigt“, gestoppt, ein Log", async () => {
  const ok: ResearchOutcome = { status: "filled", filled: ["Region"], suggested: 0, seconds: 1 };
  const limit: ResearchOutcome = { status: "error", filled: [], suggested: 0, seconds: 0, error: { kind: "usage_limit", message: "API-Limit erreicht." } };
  const asked: number[] = [];
  const { result, logged } = await capture(() =>
    runBatch([1, 2, 3, 4, 5], async (n) => {
      asked.push(n);
      return n === 2 ? limit : ok;
    }),
  );
  assert.deepEqual(asked, [1, 2], "keine weiteren Anfragen");
  assert.equal(result.halt, limitHaltMessage(1, 5));
  assert.equal(result.halt, "API-Limit erreicht – Lauf gestoppt. 1 von 5 erledigt. Limit in der Claude Console (Settings → Limits) erhöhen oder später nochmals starten.");
  assert.equal(logged.filter((l) => l.startsWith("api limit reached")).length, 1, "ein Eintrag pro Lauf");

  // Nacheinander: der nächste Wein startet erst, wenn der vorige fertig ist.
  let running = 0;
  let maxRunning = 0;
  await runBatch([1, 2, 3], async () => {
    maxRunning = Math.max(maxRunning, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return ok;
  });
  assert.equal(maxRunning, 1);

  // Echt: Weine recherchieren, der 2. trifft das Limit → der 3. wird nicht mehr angefragt.
  const wines = ["a", "b", "c", "d", "e"].map((x, i) => `${x.repeat(8)}-0000-4000-8000-00000000000${i}`);
  net.tables = {
    wines: wines.map((id, i) => ({ id, name: `Wein ${i}`, producer: "P", country: "Spanien", region: null, appellation: null, type: "red", alcohol_content: null, grapes: [], researched_at: null })),
    inventory_items: wines.map((id) => ({ wine_id: id, vintage_year: 2019, status: "sealed" })),
    wine_encounters: [], wine_vintages: [], wine_grape_shares: [], wine_taste_profiles: [], wine_media: [], research_suggestions: [],
  };
  claudeCalls = 0;
  reply = () => (claudeCalls === 1
    ? claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] })
    : claudeError(400, LIMIT)) as never;
  const research = async (id: string): Promise<ResearchOutcome> => {
    try {
      return await researchAndFillWine(db, id, "all", { taste: "missing", skipRecent: false });
    } catch (error) {
      const problem = apiProblem(error);
      return { status: "error", filled: [], suggested: 0, seconds: 0, ...(problem ? { error: problem } : {}) };
    }
  };
  const { result: real } = await capture(() => runBatch(wines, research));
  assert.match(real.halt!, /^API-Limit erreicht – Lauf gestoppt\. \d von 5 erledigt\./);
  assert.ok(net.tables.wines.slice(2).every((w) => w.researched_at == null), "Weine nach dem Stopp unberührt");
});

test("Gescheiterter Wein: researched_at und taste_profile_checked_at bleiben unverändert", async () => {
  const before = "2025-01-01T00:00:00.000Z";
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: null, appellation: null, type: "red", alcohol_content: null, grapes: [], researched_at: before }],
    inventory_items: [{ wine_id: W, vintage_year: 2019, status: "sealed" }],
    wine_encounters: [], wine_vintages: [{ id: "v19", wine_id: W, vintage_year: 2019, drink_from_year: null, drink_until_year: null, taste_profile_checked_at: before }],
    wine_grape_shares: [], wine_taste_profiles: [], wine_media: [], research_suggestions: [],
  };
  reply = () => claudeError(400, LIMIT) as never;
  for (const taste of ["always", "only"] as const) {
    await assert.rejects(researchAndFillWine(db, W, "all", { taste, year: 2019 }), (e: unknown) => usageLimit(e) != null);
    assert.equal(net.tables.wines[0].researched_at, before, taste);
    assert.equal(net.tables.wine_vintages[0].taste_profile_checked_at, before, taste);
  }
  // Limit erst beim Profil (Stammdaten schon ergänzt): Ergänztes bleibt, Fehler wird gemeldet, Profil nicht als geprüft vermerkt
  claudeCalls = 0;
  reply = () => (claudeCalls === 1
    ? claudeTool("report_wine_details", { producer: null, country: null, region: "Toro", appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] })
    : claudeError(400, LIMIT)) as never;
  const { result: outcome } = await capture(() => researchAndFillWine(db, W, "all", { taste: "always", year: 2019 }));
  assert.equal(outcome.status, "filled");
  assert.equal(outcome.error?.kind, "usage_limit", "Sammellauf hält an");
  assert.equal(net.tables.wine_vintages[0].taste_profile_checked_at, before);
});

test("Einzelne Recherche mit Limit-Fehler → verständliche Meldung", () => {
  const problem = apiProblem(sdkError(400, "invalid_request_error", LIMIT))!;
  const summary = researchSummary({ status: "error", filled: [], suggested: 0, error: problem as ResearchOutcome["error"] });
  assert.ok("error" in summary);
  assert.match(summary.error, /^API-Limit erreicht \(wieder verfügbar am .+\)\. Limit in der Claude Console \(Settings → Limits\) erhöhen/);
  const busy = researchSummary({ status: "error", filled: [], suggested: 0, error: apiProblem(sdkError(529, "overloaded_error", "Overloaded")) as ResearchOutcome["error"] });
  assert.ok("error" in busy && /vorübergehend/.test(busy.error));
});

test("Bot: Foto bei Limit-Fehler → Meldung, Erfassung bleibt offen (Fotos bleiben, Text geht weiter)", async () => {
  const JOB = jobIdFor(111, "album-limit");
  net.tables = {
    persons: [{ id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: 111 }],
    wines: [], inventory_items: [], vendors: [], wine_vintages: [], wine_grape_shares: [], wine_media: [], telegram_chat_messages: [],
    ingest_jobs: [{ id: JOB, source: "telegram", telegram_chat_id: 111, status: "received", photo_paths: [], extracted: { step: "received", caption: "6 Flaschen" }, updated_at: new Date(Date.now() - 60_000).toISOString() }],
  };
  net.telegram.length = 0;
  const jpg = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#802030" } }).jpeg().toBuffer();
  net.storage!.set(`wine-photos/${photoFolder(JOB)}/10.jpg`, { bytes: jpg, type: "image/jpeg" });
  reply = () => claudeError(400, LIMIT) as never;
  const { logged } = await capture(() => processJob(JOB, 111));
  const job = net.tables.ingest_jobs.find((j) => j.id === JOB)!;
  const last = String(net.telegram.filter((t) => t.method === "sendMessage").at(-1)?.body.text);
  assert.match(last, /Kontingent .*aufgebraucht – .*Etikett .*nicht lesen\. Beschreib mir den Wein als Text oder versuch es später/);
  assert.match(last, /Deine Fotos behalte ich/);
  assert.equal(job.status, "needs_review", "nicht „failed“");
  assert.equal((job.extracted as IngestState).step, "describe");
  assert.equal((job.extracted as IngestState).caption, "6 Flaschen");
  assert.ok((job.photo_paths as string[]).length > 0 || net.storage!.has(`wine-photos/${photoFolder(JOB)}/10.jpg`), "Fotos bleiben");
  assert.ok(logged.some((l) => l.startsWith("api limit reached")));
  const buttons = ((net.telegram.at(-1)!.body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard).flat().map((b) => b.text);
  assert.deepEqual(buttons, ["✖️ Abbrechen"]);

  // Beschreibung als Text: dieselbe Erfassung geht weiter
  await handleUpdate({ update_id: 3, message: { message_id: 6, from: { id: 111, is_bot: false, first_name: "M" }, chat: { id: 111, type: "private" }, date: 0, text: "Pintia 2019 gekauft, 6 Flaschen" } } as never);
  assert.notEqual(net.tables.ingest_jobs.find((j) => j.id === JOB)!.status, "failed");
  assert.equal(net.tables.ingest_jobs.find((j) => j.id === JOB)!.status, "processing", "Text-Erfassung auf demselben Eintrag");
});
