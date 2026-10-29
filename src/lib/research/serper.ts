// Google Shopping Schweiz über Serper (POST https://google.serper.dev/shopping, Header X-API-KEY)
// – zweiter Anbieter der Preissuche neben SerpApi. Schlüssel in SERPER_API_KEY; Gratis-Abfragen und
// Prepaid-Credits verwaltet Serper (kein eigenes Kontingent in der App). Rein bis auf searchSerper.

import { amountInText } from "./price-match";
import { filterCandidates, type RawOffer, type ShoppingCandidate } from "./serpapi";

/** Preistext → Zahl und Währung: „CHF 86.90“, „86,90 CHF“, „CHF 1'234.50“, „Fr. 34.–“; ohne Währung → null. */
export function parsePriceText(text: string | null | undefined): { amount: number; currency: string } | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const found = amountInText(t);
  if (found) return found.amount > 0 ? found : null;
  const other = t.match(/^\s*(?:\$|US\$|USD|£|GBP)\s*([\d.,]+)|([\d.,]+)\s*(?:USD|GBP)\b/i);
  return other ? { amount: Number((other[1] ?? other[2]).replace(/,/g, "")), currency: /£|GBP/i.test(t) ? "GBP" : "USD" } : null;
}

type SerperItem = { title?: unknown; source?: unknown; price?: unknown; link?: unknown };

/** Kandidaten aus einer Serper-Antwort ({ shopping: [...] }). */
export function serperCandidates(json: unknown): ShoppingCandidate[] {
  const items = ((json ?? {}) as { shopping?: SerperItem[] }).shopping ?? [];
  const offers = items.flatMap((i): RawOffer[] => {
    const price = parsePriceText(typeof i.price === "string" ? i.price : null);
    if (!price) return [];
    return [{ title: typeof i.title === "string" ? i.title : "", source: typeof i.source === "string" ? i.source : "", price: price.amount, currency: price.currency, url: typeof i.link === "string" ? i.link : "" }];
  });
  return filterCandidates(offers);
}

export const SERPER_URL = "https://google.serper.dev/shopping";

/** Eine Abfrage bei Serper. Wirft bei Netz-/API-Fehler (auch ohne Guthaben). */
export async function searchSerper(q: string, apiKey: string, timeoutMs = 15_000): Promise<ShoppingCandidate[]> {
  const res = await fetch(SERPER_URL, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q, gl: "ch", hl: "de", location: "Switzerland" }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok || !json) throw new Error(`serper ${res.status}${json?.message ? `: ${String(json.message).slice(0, 120)}` : ""}`);
  return serperCandidates(json);
}
