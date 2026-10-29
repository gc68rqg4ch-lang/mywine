import "server-only";

// API-Verbrauch protokollieren: Der Anthropic-Client bekommt einen eigenen fetch (meteredFetch),
// der nach jeder Messages-Antwort usage auswertet und eine Zeile in api_usage schreibt – so ist
// jeder Aufruf erfasst, auch jede Runde einer Websuche und jeder Schritt im Chat (toolRunner).
// Zweck, Wein und Auftrag kommen aus dem Kontext (withUsage, AsyncLocalStorage). Fehler beim
// Protokollieren stören den eigentlichen Ablauf nie (nur ein Log-Eintrag).

import { AsyncLocalStorage } from "node:async_hooks";
import { costUsd, usageCounts, type ApiUsage, type Purpose } from "./cost";

export type UsageContext = { purpose?: Purpose; wineId?: string | null; jobRef?: string | null };

const context = new AsyncLocalStorage<UsageContext>();

/** Zweck (und Wein/Auftrag) für alle Claude-Aufrufe in fn; Angaben von aussen bleiben, wenn hier leer. */
export function withUsage<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  const outer = context.getStore() ?? {};
  const merged: UsageContext = {
    purpose: ctx.purpose ?? outer.purpose,
    wineId: ctx.wineId !== undefined ? ctx.wineId : outer.wineId,
    jobRef: ctx.jobRef !== undefined ? ctx.jobRef : outer.jobRef,
  };
  return context.run(merged, fn);
}

export const currentUsageContext = () => context.getStore() ?? {};

export type UsageRow = {
  purpose: Purpose;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_searches: number;
  web_fetches: number;
  cost_usd: number;
  wine_id: string | null;
  job_ref: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zeile für api_usage aus einer Antwort (rein). */
export function usageRow(model: string, usage: ApiUsage | null | undefined, ctx: UsageContext): UsageRow {
  const u = usageCounts(usage);
  return {
    purpose: ctx.purpose ?? "other",
    model: model.slice(0, 80),
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    web_searches: u.webSearches,
    web_fetches: u.webFetches,
    cost_usd: costUsd(model, u),
    wine_id: ctx.wineId && UUID_RE.test(ctx.wineId) ? ctx.wineId : null,
    job_ref: ctx.jobRef?.slice(0, 120) ?? null,
  };
}

/** Schreiben (Admin-Client); wirft nie. Ersetzbar für Tests. */
let writer: (row: UsageRow) => Promise<void> = async (row) => {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { error } = await createAdminClient().from("api_usage").insert(row);
  if (error) throw new Error(error.message);
};
export function setUsageWriter(w: typeof writer) {
  writer = w;
}

let missingWarned = false;

export async function recordUsage(model: string, usage: ApiUsage | null | undefined, ctx: UsageContext = currentUsageContext()) {
  try {
    await writer(usageRow(model, usage, ctx));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Vor der Migration fehlt die Tabelle: nur einmal pro Instanz melden.
    if (/api_usage/.test(message) && /find the table|does not exist|PGRST205/i.test(message)) {
      if (!missingWarned) console.warn("api usage log unavailable (migration missing)");
      missingWarned = true;
      return;
    }
    console.error("api usage log failed", message);
  }
}

const isMessagesCall = (url: string, init?: RequestInit) => (init?.method ?? "GET").toUpperCase() === "POST" && /\/v1\/messages(\?|$)/.test(url);

/**
 * fetch für den Anthropic-Client: leitet weiter und protokolliert danach den Verbrauch jeder
 * erfolgreichen Messages-Antwort (JSON, nicht Stream). Nutzt das globale fetch zur Laufzeit.
 */
export const meteredFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (response.ok && isMessagesCall(url, init) && /json/i.test(response.headers.get("content-type") ?? "")) {
      const body = (await response.clone().json()) as { model?: string; usage?: ApiUsage };
      if (body?.usage) await recordUsage(body.model ?? "unknown", body.usage);
    }
  } catch (error) {
    console.error("api usage read failed", error instanceof Error ? error.message : error);
  }
  return response;
};
