// Google-Suche auf Schweizer Seiten („<Name> <Grösse> site:.ch“) als weitere Quelle der Preissuche:
// liefert echte Händler-Links (anders als Google Shopping bei Serper). Serper (POST
// https://google.serper.dev/search) bzw. SerpApi (engine=google), gl=ch, hl=de, 20 Ergebnisse.
// Rein bis auf die beiden Abfragen.

import { amountInText } from "./price-match";

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  /** Preis aus dem Rich Snippet (nur verwendet, wenn die Seite nicht lesbar ist) */
  price?: { amount: number; currency: string } | null;
};

export const SERPER_SEARCH_URL = "https://google.serper.dev/search";
export const SEARCH_RESULTS = 20;

const str = (x: unknown) => (typeof x === "string" ? x : "");

/** Preis aus Zahl + Währung bzw. Text („CHF 86.90“); nur mit Währung. */
function richPrice(price: unknown, currency: unknown, texts: unknown[]): SearchHit["price"] {
  if (typeof price === "number" && price > 0 && typeof currency === "string" && currency.trim()) {
    const cur = currency.trim().toUpperCase();
    return { amount: price, currency: cur === "FR." || cur === "SFR" ? "CHF" : cur };
  }
  for (const t of [price, ...texts]) {
    const found = typeof t === "string" ? amountInText(t) : null;
    if (found && found.amount > 0) return found;
  }
  return null;
}

/** Treffer aus einer Serper-Antwort (organic; Rich Snippet in price/currency bzw. attributes). */
export function serperSearchHits(json: unknown): SearchHit[] {
  const items = ((json ?? {}) as { organic?: Record<string, unknown>[] }).organic ?? [];
  return items.flatMap((i) => {
    const url = str(i.link);
    if (!url) return [];
    const attributes = i.attributes && typeof i.attributes === "object" ? Object.values(i.attributes as Record<string, unknown>) : [];
    return [{ url, title: str(i.title), snippet: str(i.snippet), price: richPrice(i.price, i.currency, [...attributes, i.priceRange]) }];
  });
}

/** Treffer aus einer SerpApi-Antwort (organic_results; Rich Snippet in rich_snippet.*.detected_extensions). */
export function serpApiSearchHits(json: unknown): SearchHit[] {
  const items = ((json ?? {}) as { organic_results?: Record<string, unknown>[] }).organic_results ?? [];
  return items.flatMap((i) => {
    const url = str(i.link);
    if (!url) return [];
    const rich = (i.rich_snippet ?? {}) as Record<string, { detected_extensions?: Record<string, unknown>; extensions?: unknown[] } | undefined>;
    const parts = [rich.top, rich.bottom].filter(Boolean);
    const ext = parts.map((p) => p?.detected_extensions ?? {}).find((d) => typeof d.price === "number");
    const texts = parts.flatMap((p) => p?.extensions ?? []);
    return [{ url, title: str(i.title), snippet: str(i.snippet), price: richPrice(ext?.price, ext?.currency, texts) }];
  });
}

/** Eine Google-Suche über Serper. Wirft bei Netz-/API-Fehler. */
export async function searchSerperWeb(q: string, apiKey: string, timeoutMs = 15_000): Promise<SearchHit[]> {
  const res = await fetch(SERPER_SEARCH_URL, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl: "ch", hl: "de", num: SEARCH_RESULTS }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok || !json) throw new Error(`serper search ${res.status}${json?.message ? `: ${String(json.message).slice(0, 120)}` : ""}`);
  return serperSearchHits(json);
}

/** Adresse der SerpApi-Suche (Schlüssel nur hier angehängt). */
export function serpApiSearchUrl(q: string, apiKey: string) {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google");
  u.searchParams.set("q", q);
  u.searchParams.set("gl", "ch");
  u.searchParams.set("hl", "de");
  u.searchParams.set("google_domain", "google.ch");
  u.searchParams.set("num", String(SEARCH_RESULTS));
  u.searchParams.set("api_key", apiKey);
  return u.toString();
}

/** Eine Google-Suche über SerpApi. Wirft bei Netz-/API-Fehler. */
export async function searchSerpApiWeb(q: string, apiKey: string, timeoutMs = 15_000): Promise<SearchHit[]> {
  const res = await fetch(serpApiSearchUrl(q, apiKey), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (json?.error && /hasn't returned any results|no results/i.test(json.error)) return [];
  if (!res.ok || !json || json.error) throw new Error(`serpapi search ${res.status}${json?.error ? `: ${String(json.error).slice(0, 120)}` : ""}`);
  return serpApiSearchHits(json);
}
