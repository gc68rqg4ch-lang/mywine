// API-Fehler einordnen: Nutzungslimit (sofort stoppen, Datum nennen) vs. andere Fehler. Ausführen: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { apiProblem, apiProblemForBot, usageLimit } from "@/lib/ai/api-errors";
import { formatDate } from "@/lib/format";

const DAY = formatDate("2026-11-01");

const sdkError = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "invalid_request_error", message } }, undefined, new Headers());

test("Nutzungslimit: erkannt, Datum aus der Meldung", () => {
  const error = sdkError(400, "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.");
  assert.deepEqual(usageLimit(error), { until: DAY });
  assert.deepEqual(apiProblem(error), {
    kind: "usage_limit",
    until: DAY,
    message: `API-Limit erreicht (wieder verfügbar am ${DAY}). Limit in der Claude Console (Settings → Limits) erhöhen oder später nochmals starten.`,
  });
  assert.equal(apiProblemForBot(error), `Ich mache gerade eine kleine Pause – mein Kontingent für diesen Monat ist aufgebraucht. Ab ${DAY} bin ich wieder ganz für dich da.`);
  // auch als reiner Text (z. B. aus einem Log) und ohne Datum
  assert.ok(usageLimit(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits."}}')));
  assert.equal(apiProblem(sdkError(400, "You have reached your specified API usage limits."))!.message, "API-Limit erreicht. Limit in der Claude Console (Settings → Limits) erhöhen oder später nochmals starten.");
});

test("andere Fehler: API mit Status, sonst null", () => {
  const other = apiProblem(sdkError(500, "Internal server error"));
  assert.equal(other?.kind, "api");
  assert.match(other!.message, /Claude API \(500\): .*Internal server error/);
  assert.equal(usageLimit(sdkError(400, "tools.1.custom: For 'integer' type, properties maximum, minimum are not supported")), null);
  assert.equal(apiProblem(new Error("permission denied for schema private")), null, "Datenbankfehler sind keine API-Fehler");
});
