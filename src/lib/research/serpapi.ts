// Google Shopping Schweiz über SerpApi (engine=google_shopping, gl=ch, hl=de, google.ch) als Quelle
// der Preissuche – Anbieter 1 (zweiter: Serper, serper.ts). Rein bis auf searchShopping (Netz).
// Schlüssel in SERPAPI_API_KEY; Kontingent 250 Abfragen pro Monat (Gratis-Plan).

import { merchantOf, type MerchantVia } from "./merchant";

/** Gratis-Plan: 250 Abfragen pro Monat. Ab SOFT nur noch eine Abfrage pro Flasche, ab HARD keine. */
export const SERPAPI_MONTHLY_LIMIT = 250;
export const SERPAPI_SOFT_LIMIT = 230;
/** Höchstens so viele (Schweizer) Kandidaten gehen an den Abgleich. */
export const MAX_CANDIDATES = 30;
/** Ausländische Kandidaten (Domain bekannt, nicht Schweiz): höchstens so viele fürs Protokoll. */
const MAX_FOREIGN = 20;

export type ShoppingCandidate = {
  title: string;
  /** Händler laut Google („drinks.ch“, „Flaschenpost“) */
  source: string;
  price: number;
  /** Normalpreis, falls Google einen alten Preis zeigt („statt“) */
  regular: number | null;
  /** Händlerseite, falls bekannt, sonst der Link des Anbieters (Google) */
  url: string;
  /** Link laut Anbieter (unverändert) */
  link?: string;
  /** Händler-Domain und ob Schweizer Händler; woher die Erkennung stammt */
  domain?: string | null;
  swiss?: boolean;
  via?: MerchantVia | null;
  /** Quelle: Google Shopping, direkte Shop-Suche, Google-Suche site:.ch (je mit eigener Seitenprüfung) */
  origin?: "shopping" | "direct" | "search";
  soldOut?: boolean;
};

type RawResult = {
  title?: unknown;
  source?: unknown;
  price?: unknown;
  extracted_price?: unknown;
  old_price?: unknown;
  extracted_old_price?: unknown;
  link?: unknown;
  product_link?: unknown;
  second_hand_condition?: unknown;
};

/** Marktplätze und Auktionen – keine Händlerpreise. */
const MARKETPLACE_RE = /\b(ebay|ricardo|tutti|anibis|kleinanzeigen|catawiki|whiskyauction|whisky-auction|auction|auktion)\b/i;

/** Preistext in Franken? „CHF 29.90“, „29,90 CHF“, „Fr. 29.90“. */
const chfText = (s: string) => /\bCHF\b|\bFr\.|SFr/i.test(s);

/** Rohes Angebot eines Anbieters (SerpApi, Serper), schon in Zahl und Währung zerlegt. */
export type RawOffer = { title: string; source: string; price: number; currency: string; regular?: number | null; url: string; used?: boolean };

/**
 * Gemeinsamer Filter: nur CHF, ohne Marktplätze/Auktionen und Gebrauchtware, ohne Doppelte; je
 * Kandidat Händler-Domain und swiss aus Link bzw. Namen (die Tabelle merchants prüft der Ablauf
 * danach). Höchstens max mögliche Schweizer (Schweizer oder Domain unbekannt), dazu bekannt
 * ausländische fürs Protokoll – die gehen nicht in den Abgleich.
 */
export function filterCandidates(offers: RawOffer[], max = MAX_CANDIDATES): ShoppingCandidate[] {
  const out: ShoppingCandidate[] = [];
  const seen = new Set<string>();
  let swiss = 0;
  let foreign = 0;
  for (const o of offers) {
    const title = o.title.trim();
    const source = o.source.trim();
    if (!title || !(o.price > 0) || o.currency !== "CHF" || o.used) continue;
    if (MARKETPLACE_RE.test(source) || MARKETPLACE_RE.test(o.url)) continue;
    const key = `${source.toLowerCase()}|${title.toLowerCase()}|${o.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = merchantOf(source, o.url);
    const maybeSwiss = m.swiss || m.domain == null;
    if (maybeSwiss ? swiss >= max : foreign >= MAX_FOREIGN) continue;
    if (maybeSwiss) swiss++;
    else foreign++;
    out.push({ title, source, price: o.price, regular: o.regular != null && o.regular > o.price ? o.regular : null, url: m.url ?? o.url, link: o.url, domain: m.domain, swiss: m.swiss, via: m.via, origin: "shopping" });
    if (swiss >= max) break;
  }
  return out;
}

/** Kandidaten aus einer SerpApi-Antwort (shopping_results und inline_shopping_results). */
export function shoppingCandidates(json: unknown, max = MAX_CANDIDATES): ShoppingCandidate[] {
  const data = (json ?? {}) as { shopping_results?: RawResult[]; inline_shopping_results?: RawResult[] };
  const offers = [...(data.inline_shopping_results ?? []), ...(data.shopping_results ?? [])].map(
    (r): RawOffer => ({
      title: typeof r.title === "string" ? r.title : "",
      source: typeof r.source === "string" ? r.source : "",
      price: typeof r.extracted_price === "number" ? r.extracted_price : NaN,
      currency: chfText(typeof r.price === "string" ? r.price : "") ? "CHF" : "",
      regular: typeof r.extracted_old_price === "number" ? r.extracted_old_price : null,
      url: typeof r.link === "string" ? r.link : typeof r.product_link === "string" ? r.product_link : "",
      used: Boolean(r.second_hand_condition),
    }),
  );
  return filterCandidates(offers, max);
}

/** Adresse der Abfrage (ohne Schlüssel im Protokoll – der wird nur hier angehängt). */
export function shoppingUrl(q: string, apiKey: string) {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_shopping");
  u.searchParams.set("q", q);
  u.searchParams.set("gl", "ch");
  u.searchParams.set("hl", "de");
  u.searchParams.set("google_domain", "google.ch");
  u.searchParams.set("api_key", apiKey);
  return u.toString();
}

/** Eine Google-Shopping-Abfrage. Wirft bei Netz-/API-Fehler (auch erschöpftem Kontingent). */
export async function searchShopping(q: string, apiKey: string, timeoutMs = 15_000): Promise<ShoppingCandidate[]> {
  const res = await fetch(shoppingUrl(q, apiKey), { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  // Keine Treffer ist kein Fehler.
  if (json?.error && /hasn't returned any results|no results/i.test(json.error)) return [];
  if (!res.ok || !json || json.error) throw new Error(`serpapi ${res.status}${json?.error ? `: ${String(json.error).slice(0, 120)}` : ""}`);
  return shoppingCandidates(json);
}
