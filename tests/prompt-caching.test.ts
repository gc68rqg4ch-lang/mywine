// Prompt-Caching: Recherchen mit Websuche setzen cache_control (fester Teil und automatischer,
// mitwandernder Marker – erst damit cacht die API die Schritte der Suchschleife), ohne Suche nicht;
// der Chat cacht System und Tools. Stubs – ohne DB, Schlüssel und Netz.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { claudeText, claudeTool, installNet, type Net } from "./stub-net";
import { webResearch } from "@/lib/ingest/recognize";
import { answerChat } from "@/lib/chat/agent";
import { createAdminClient } from "@/lib/supabase/admin";

const bodies: Record<string, unknown>[] = [];
let reply: (n: number) => Record<string, unknown> = () => claudeTool("report_x", { value: "ok" });
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: (body) => {
    bodies.push(body);
    return reply(bodies.length);
  },
};
installNet(net);
const schema = z.object({ value: z.string() });
const run = (extra: Partial<Parameters<typeof webResearch>[0]> = {}) =>
  webResearch({ prompt: "Recherchiere.", toolName: "report_x", toolDescription: "x", schema, maxSearches: 3, ...extra });
type Msg = { role: string; content: string | { type: string; cache_control?: unknown }[] };

test("Recherche mit Websuche: automatischer Marker auf der Anfrage; mit Beilagen zusätzlich am Ende des Prompts", async () => {
  bodies.length = 0;
  assert.deepEqual(await run(), { value: "ok" });
  assert.deepEqual(bodies[0].cache_control, { type: "ephemeral" });
  bodies.length = 0;
  await run({ pages: [{ url: "https://shop.ch/p", title: "Shop", text: "Pintia 2019 …" }] });
  const content = (bodies[0].messages as Msg[])[0].content as { type: string; cache_control?: unknown }[];
  assert.deepEqual(content.map((b) => [b.type, b.cache_control ?? null]), [["document", null], ["text", { type: "ephemeral" }]]);
  assert.deepEqual(bodies[0].cache_control, { type: "ephemeral" });
});

test("Folgerunden (pause_turn) und Nachfrage tragen die Marker ebenso", async () => {
  bodies.length = 0;
  reply = (n) => (n === 1 ? { ...claudeText({}), stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } }] } : claudeTool("report_x", { value: "ok" }));
  await run({ pages: [{ url: "https://shop.ch/p", title: "Shop", text: "…" }] });
  assert.equal(bodies.length, 2);
  for (const b of bodies) {
    assert.deepEqual(b.cache_control, { type: "ephemeral" });
    assert.deepEqual(((b.messages as Msg[])[0].content as { cache_control?: unknown }[]).at(-1)?.cache_control, { type: "ephemeral" });
  }
  // Nachfrage bei ungültiger Antwort
  bodies.length = 0;
  reply = (n) => claudeTool("report_x", { value: n === 1 ? "kaputt" : "ok" });
  const repaired = await run({ repair: (x) => ((x as { value: string }).value === "kaputt" ? "value ungültig" : null) });
  assert.deepEqual(repaired, { value: "ok" });
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].cache_control, { type: "ephemeral" });
  assert.match(JSON.stringify(bodies[1].messages), /"is_error":true/);
  reply = () => claudeTool("report_x", { value: "ok" });
});

test("Ohne Websuche (nur schätzen): kein Caching – eine einzelne Anfrage zahlte nur den Aufschlag", async () => {
  bodies.length = 0;
  await run({ maxSearches: 0 });
  assert.equal(bodies[0].cache_control, undefined);
  assert.equal(typeof (bodies[0].messages as Msg[])[0].content, "string");
});

test("Chat: System und Tools werden gecacht (automatischer Marker)", async () => {
  bodies.length = 0;
  net.tables = {};
  reply = () => ({ ...claudeText({}), content: [{ type: "text", text: "Hallo!" }] });
  await answerChat(createAdminClient(), [], "Hallo", { telegramUserId: 111, personId: null, name: "Michel" });
  assert.ok(bodies.length >= 1);
  assert.deepEqual(bodies[0].cache_control, { type: "ephemeral" });
});
