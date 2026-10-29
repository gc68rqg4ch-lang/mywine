// API-Kosten (rein, ohne Netz): Preistabelle je Modell und Kosten eines Aufrufs aus usage.
//
// Stand 29.10.2026, Quelle: Anthropic-Preisliste (platform.claude.com/pricing, Stand der
// Claude-API-Referenz 06.10.2026). Preise in USD pro Million Tokens; Cache schreiben = 1,25 ×
// Input (5-Minuten-Cache), Cache lesen laut Liste. Websuche: 10 USD pro 1000 Suchen; Web-Abruf
// (web_fetch) kostet nur die Tokens. Haiku 5.5: über 100 000 Input-Tokens gilt der höhere Satz.

export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number; long?: { above: number; input: number; output: number }; /** USD je Websuche (Standard WEB_SEARCH_USD) */ webSearch?: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, long: { above: 100_000, input: 0.5, output: 2.5 } },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  // SerpApi (Google Shopping) im Gratis-Plan: Abfragen werden gezählt (web_searches), kosten nichts.
  serpapi: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0 },
};
/** Unbekanntes Modell (z. B. eine Ausweichstufe): vorsichtig wie Opus 5.5 rechnen. */
export const FALLBACK_PRICE = MODEL_PRICES["claude-opus-5-5"];
/** USD pro Websuche (10 USD pro 1000). */
export const WEB_SEARCH_USD = 10 / 1000;

export type Purpose = "recognize" | "chat" | "research_wine" | "research_taste" | "research_window" | "research_keep" | "research_price" | "daily_note" | "other";
export const PURPOSES: readonly Purpose[] = ["recognize", "chat", "research_wine", "research_taste", "research_window", "research_keep", "research_price", "daily_note", "other"];

/** Anzeige auf /recherche. */
export const PURPOSE_LABELS: Record<Purpose, string> = {
  recognize: "Erkennung (Foto/Text)",
  chat: "Chat mit Antoine",
  research_wine: "Recherche Stammdaten",
  research_taste: "Recherche Geschmacksprofil",
  research_window: "Recherche Trinkfenster",
  research_keep: "Recherche Haltbarkeit",
  research_price: "Preissuche",
  daily_note: "Tagestext",
  other: "Sonstiges",
};

/** Ausschnitt aus usage einer Messages-API-Antwort. */
export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
};

export type UsageCounts = { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number; webFetches: number };

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function usageCounts(usage: ApiUsage | null | undefined): UsageCounts {
  return {
    input: n(usage?.input_tokens),
    output: n(usage?.output_tokens),
    cacheRead: n(usage?.cache_read_input_tokens),
    cacheWrite: n(usage?.cache_creation_input_tokens),
    webSearches: n(usage?.server_tool_use?.web_search_requests),
    webFetches: n(usage?.server_tool_use?.web_fetch_requests),
  };
}

/** Preis eines Modells (auch mit Datums- oder Plattform-Zusatz, z. B. „claude-sonnet-5-5-…“). */
export function priceOf(model: string): ModelPrice {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const key = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length).find((k) => model.includes(k));
  return key ? MODEL_PRICES[key] : FALLBACK_PRICE;
}

/** Kosten in USD (gerundet auf 6 Stellen). */
export function costUsd(model: string, usage: ApiUsage | UsageCounts | null | undefined): number {
  const u = usage && "webSearches" in usage ? usage : usageCounts(usage as ApiUsage);
  const p = priceOf(model);
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const rates = p.long && prompt > p.long.above ? { ...p, input: p.long.input, output: p.long.output } : p;
  const usd = (u.input * rates.input + u.output * rates.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000 + u.webSearches * (p.webSearch ?? WEB_SEARCH_USD);
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Erster Tag des Monats in Zürich (YYYY-MM-01) und die Grenzen als ISO-Zeitpunkte. */
export function zurichMonth(now = new Date(), offsetMonths = 0) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const idx = y * 12 + (m - 1) + offsetMonths;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextIdx = idx + 1;
  const next = `${Math.floor(nextIdx / 12)}-${String((nextIdx % 12) + 1).padStart(2, "0")}-01`;
  // Mitternacht Zürich ≈ 22/23 Uhr UTC am Vortag: grosszügig über die Zeitzone rechnen.
  const at = (d: string) => zurichMidnight(d);
  return { month: first, from: at(first), to: at(next) };
}

/** Mitternacht in Zürich an einem Datum, als ISO-Zeitpunkt (UTC). */
function zurichMidnight(date: string) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const hourThere = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hour: "2-digit", hourCycle: "h23" }).format(new Date(utc)));
  return new Date(utc - hourThere * 3_600_000).toISOString();
}

/** Monatsbudget: Grundbetrag aus API_MONTHLY_BUDGET_USD (Standard 20) plus einmalige Erhöhungen. */
export const DEFAULT_MONTHLY_BUDGET_USD = 20;
export const BUDGET_STEP_USD = 10;
export function baseBudget(env: string | undefined = process.env.API_MONTHLY_BUDGET_USD) {
  const v = Number(env);
  return env != null && env.trim() !== "" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_MONTHLY_BUDGET_USD;
}

/** „USD 12.34“ */
export const usd = (v: number) => `USD ${v.toFixed(v < 1 && v > 0 ? 3 : 2)}`;
