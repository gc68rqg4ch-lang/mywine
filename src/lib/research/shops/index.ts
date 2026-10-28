// Schweizer Händler-Shops als zusätzliche Quelle für Recherche, Geschmacksprofil und
// Trinkfenster – serverseitig, ohne API-Kosten. Zuerst der Shop des Händlers der Flasche, dann die
// übrigen. Nur Seiten zu genau diesem Wein und Jahrgang (match.ts); höchstens 3 Seiten pro Wein,
// Text gekürzt. Zurückhaltend: Zeitlimit 5 s pro Abruf, wenige Abrufe, alles nacheinander.
// Fehler, Sperre oder Zeitlimit → ohne diese Quelle weiter, nur ein Log-Eintrag „shop research failed“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SHOPS, type Fetched, type Get, type ShopAdapter, type ShopPage } from "./adapters";
import { pageMatches, pickCandidate, type ShopWine } from "./match";

export type { ShopPage } from "./adapters";
export type { ShopWine } from "./match";

type Db = SupabaseClient<Database>;

export const SHOP_TIMEOUT_MS = 5000;
/** Höchstens so viele Abrufe pro Wein (alle Shops und Jahrgänge zusammen). */
export const MAX_SHOP_REQUESTS = 12;
export const MAX_SHOP_PAGES = 3;
/** Pro Shop und Jahrgang höchstens so viele Produktseiten lesen. */
const READS_PER_SHOP = 2;

const log = (shop: string, detail: string) => console.warn("shop research failed", shop, detail);

/** Abrufe mit Zeitlimit, Budget und Zwischenspeicher (gleiche Adresse nur einmal). */
export function createGetter(options: { maxRequests?: number; timeoutMs?: number } = {}): Get {
  const cache = new Map<string, Promise<Fetched | null>>();
  let left = options.maxRequests ?? MAX_SHOP_REQUESTS;
  return (url) => {
    const hit = cache.get(url);
    if (hit) return hit;
    if (left <= 0) return Promise.resolve(null);
    left--;
    const run = (async () => {
      const host = new URL(url).hostname;
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; MyWine/1.0)", accept: "text/html,application/json" },
          signal: AbortSignal.timeout(options.timeoutMs ?? SHOP_TIMEOUT_MS),
          redirect: "follow",
          cache: "no-store",
        });
        const text = res.ok ? await res.text() : "";
        // 404: Seite gibt es nicht (z. B. anderer Jahrgang) – kein Fehler.
        if (!res.ok && res.status !== 404) log(host, `HTTP ${res.status} ${url}`);
        const result = { url: res.url || url, status: res.status, text };
        // Weiterleitung (Mövenpick: einziger Treffer → Produktseite): auch unter der Zieladresse merken.
        if (result.url !== url && !cache.has(result.url)) cache.set(result.url, Promise.resolve(result));
        return result;
      } catch (error) {
        log(host, `${error instanceof Error ? error.message : String(error)} ${url}`);
        return null;
      }
    })();
    cache.set(url, run);
    return run;
  };
}

/** Shop des Händlers der Flasche zuerst (in der Reihenfolge der Händler), dann die übrigen. */
export function orderShops(vendors: string[], shops: ShopAdapter[] = SHOPS) {
  const first: ShopAdapter[] = [];
  for (const v of vendors) for (const s of shops) if (s.vendor.test(v) && !first.includes(s)) first.push(s);
  return [...first, ...shops.filter((s) => !first.includes(s))];
}

/** Eine passende Seite in einem Shop (oder null). */
async function findInShop(shop: ShopAdapter, wine: ShopWine, get: Get): Promise<ShopPage | null> {
  const candidates = await shop.search(wine, get);
  const picked = pickCandidate(candidates, wine, shop.labelHasProducer);
  // Gesuchter Jahrgang zuerst; Mövenpick: anderer Jahrgang → dieselbe Adresse mit dem gesuchten Jahr.
  const urls: string[] = [];
  for (const c of [...picked].sort((a, b) => Number(b.year === wine.year) - Number(a.year === wine.year))) {
    if (c.year === wine.year || (c.year == null && !shop.withYear)) urls.push(c.url);
    else if (wine.year != null && c.year != null && shop.withYear) {
      const url = shop.withYear(c.url, wine.year);
      if (url) urls.push(url);
    }
  }
  for (const url of [...new Set(urls)].slice(0, READS_PER_SHOP)) {
    const page = await shop.read(url, get);
    // Falscher Jahrgang, anderer Wein oder Produzent nicht erkennbar → verwerfen.
    if (page && pageMatches(page, wine)) return { ...page, year: wine.year };
  }
  return null;
}

/**
 * Seiten zu genau diesem Wein suchen – für die angegebenen Jahrgänge (wichtigster zuerst).
 * Pro Shop und Jahrgang höchstens eine Seite, insgesamt höchstens maxPages. Wirft nie.
 */
export async function findShopPages(
  wine: Omit<ShopWine, "year">,
  years: (number | null)[],
  options: { vendors?: string[]; maxPages?: number; get?: Get; shops?: ShopAdapter[] } = {},
): Promise<ShopPage[]> {
  if (!wine.name.trim() || !years.length) return [];
  const get = options.get ?? createGetter();
  const max = options.maxPages ?? MAX_SHOP_PAGES;
  const shops = orderShops(options.vendors ?? [], options.shops);
  const pages: ShopPage[] = [];
  for (const year of [...new Set(years)]) {
    for (const shop of shops) {
      if (pages.length >= max) return pages;
      try {
        const page = await findInShop(shop, { ...wine, year }, get);
        if (page && !pages.some((p) => p.url === page.url)) pages.push(page);
      } catch (error) {
        log(shop.id, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return pages;
}

/** Händler der Flaschen dieses Weins – die des gesuchten Jahrgangs zuerst. */
export async function loadWineVendors(db: Db, wineId: string, years: (number | null)[]): Promise<string[]> {
  const { data, error } = await db.from("inventory_items").select("vintage_year, vendor:vendors(name)").eq("wine_id", wineId);
  if (error) {
    log("vendors", error.message);
    return [];
  }
  const rows = (data ?? []) as { vintage_year: number | null; vendor: { name: string | null } | null }[];
  const rank = (y: number | null) => (years.includes(y) ? years.indexOf(y) : years.length);
  return [
    ...new Set(
      [...rows].sort((a, b) => rank(a.vintage_year) - rank(b.vintage_year)).flatMap((r) => (r.vendor?.name ? [r.vendor.name] : [])),
    ),
  ];
}

/** Für Recherche, Profil und Trinkfenster: Händler laden, dann Seiten suchen. Wirft nie. */
export async function loadShopPages(
  db: Db,
  wine: Omit<ShopWine, "year"> & { id: string },
  years: (number | null)[],
): Promise<ShopPage[]> {
  try {
    const vendors = await loadWineVendors(db, wine.id, years);
    return await findShopPages(wine, years, { vendors });
  } catch (error) {
    log("all", error instanceof Error ? error.message : String(error));
    return [];
  }
}

/** Als Text-Dokumente für den Recherche-Aufruf (neben PDFs und Websuche). */
export const shopDocuments = (pages: ShopPage[]) => pages.map((p) => ({ url: p.url, title: p.title, text: p.text }));

/** Hinweis im Prompt: welche Händlerseiten beiliegen und wie zitieren. */
export function shopPagesNote(pages: ShopPage[]) {
  if (!pages.length) return "";
  return `\nBeigelegte Händlerseiten (Schweizer Shops, zusätzlich zur Websuche; gelten nur für den genannten Jahrgang):\n${pages
    .map((p) => `- „${p.title}“ – Jahrgang ${p.year ?? "ohne (NV)"}; als Quelle mit url "${p.url}" und kind "merchant" angeben`)
    .join("\n")}\nZitate aus einer Händlerseite wörtlich aus deren Text; es gelten dieselben Regeln wie für andere Quellen.`;
}
