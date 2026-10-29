// Preissuche (rein, ohne Netz): Marke aus dem Produzenten, feste Suchbegriffe, direkte Suchen in
// Schweizer Shops (Adressen und Auswertung), URLs aus den Websuche-Ergebnissen sammeln und den
// besten Treffer wählen. Netz, Modell und DB kommen in price.ts dazu.

import { formatMoney } from "@/lib/format";
import { GENERIC_NAMES, brandFromProducer, brandInName, genericName, sameProduct, sizeFromText, wordsOf } from "./price-match";
export { brandFromProducer, genericName } from "./price-match";
import { SHOP_DOMAINS } from "./shops/match";
import { swissDomain } from "./merchant";

export const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Schweizer Händler: Domain .ch/.swiss bzw. einer der bekannten Schweizer Shops (moevenpick-wein.com). */
export function swissMerchantUrl(url: string) {
  const host = hostOf(url);
  return host != null && (swissDomain(host) || SHOP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)));
}

// ——— Marke und Suchbegriffe ———

/**
 * Produkt für die Suche: bei Gattungsnamen Marke + Name („Lazzaroni Amaretto“, „Capel Premium
 * Pisco“); bei eigenständigen Produktnamen der Name allein („Noah's Mill“, „Disaronno“, „Lagavulin
 * 16“) – die Firma dahinter (Willett Distillery) steht in Shops meist nicht im Titel.
 */
export function productTerm(want: { name: string; producer?: string | null }) {
  const name = want.name.trim();
  const brand = brandFromProducer(want.producer);
  if (!brand || brandInName(brand, name) || !genericName(name)) return name;
  return `${brand} ${name}`;
}

/** Schreibweisen mit Apostroph: „Noah's Mill“, „Noahs Mill“, „Noah s Mill“ (ohne Doppel). */
export function apostropheVariants(term: string) {
  const t = term.trim();
  return unique([t, t.replace(/['’`´]/g, ""), t.replace(/['’`´]/g, " ").replace(/\s+/g, " ").trim()]);
}

const unique = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((q) => {
    const k = normQuery(q);
    if (!q || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
/** Suchbegriff vereinheitlicht (Gross/Klein, Leerzeichen) – für das Erkennen doppelter Suchen. */
export const normQuery = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Begriffe für die direkten Shop-Suchen, der Reihe nach bis zum ersten Treffer: Name (bzw. bei
 * Gattungsnamen Marke + Name), ohne Apostroph, Apostroph als Leerzeichen, erst dann Marke + Name.
 */
export function shopSearchTerms(want: { name: string; producer?: string | null }) {
  const first = productTerm(want);
  const brand = brandFromProducer(want.producer);
  const withBrand = brand && first === want.name.trim() && !brandInName(brand, want.name) ? [`${brand} ${want.name.trim()}`] : [];
  return unique([...apostropheVariants(first), ...withBrand]);
}

/** „70cl“, „75cl“, „150cl“ – so wie in Shop-Titeln. */
export const clTerm = (ml: number) => `${Math.round(ml / 10)}cl`;

/**
 * Feste Suchbegriffe in dieser Reihenfolge (jeder nur einmal): „<Produkt> <Grösse>“, „… kaufen
 * CHF“, „… site:.ch“, mit Händler „<Händler> <Produkt>“, die Schreibweise ohne Apostroph, bei
 * eigenständigen Namen zuletzt Marke + Name. Jahrgang hinten am Produkt. Der Händler (auch Ketten
 * wie Coop, Denner) nur mit dem ganzen Produkt.
 */
export function priceQueries(want: { name: string; producer?: string | null; year?: number | null; sizeMl: number; vendor?: string | null }) {
  const product = productTerm(want);
  const y = want.year != null ? ` ${want.year}` : "";
  const p = `${product}${y}`;
  const size = clTerm(want.sizeMl);
  const vendor = want.vendor?.trim();
  const variants = apostropheVariants(product).slice(1, 2).map((v) => `${v}${y} ${size}`);
  const brand = brandFromProducer(want.producer);
  const withBrand = brand && product === want.name.trim() && !brandInName(brand, want.name) ? [`${brand} ${want.name.trim()}${y} ${size}`] : [];
  return unique([`${p} ${size}`, `${p} kaufen CHF`, `${p} site:.ch`, ...(vendor ? [`${vendor} ${p}`] : []), ...variants, ...withBrand]);
}

/** Wiederholte Suchbegriffe im Protokoll (gleicher Text, Gross/Klein egal): je Begriff, wie oft. */
export function duplicateQueries(queries: string[]): { query: string; count: number }[] {
  const counts = new Map<string, { query: string; count: number }>();
  for (const q of queries) {
    const k = normQuery(q);
    if (!k) continue;
    const e = counts.get(k) ?? { query: q, count: 0 };
    e.count++;
    counts.set(k, e);
  }
  return [...counts.values()].filter((e) => e.count > 1);
}

// ——— Direkte Suche in Schweizer Shops ———
// Geprüft am 29.10.2026 (ohne Login, robots.txt erlaubt die Suche): Shopify-Suche
// /search/suggest.json bei casapoli.ch, napawine.ch, finespirits.ch, bringts.ch; HTML-Suche bei drinks.ch
// (/de/search?q=), flaschenpost.ch (/wein?search=, nur Wein), piemont-weine.ch (/search?q=) und
// bauraulacvins.ch (/de/search.html?query=). Produktseiten mit schema.org bzw. Microdata.
// flaschenpost.ch nur für Wein: die Spirituosen-Suche (/spirituosen?search=) lädt Treffer erst per
// JavaScript – im HTML stehen keine Produktlinks.
// Nicht dabei: galaxus.ch, globus.ch, decantalo.ch (403/Bot-Schutz), ullrich.ch, bottlebutler.ch,
// manor.ch (Suche per robots.txt gesperrt), moevenpick-wein.com (robots.txt sperrt Adressen mit „?“),
// casadeltabacco.ch (keine Verbindung), bottega.ch (400), schuewo.ch und boucherville.ch (keine
// abfragbare Such-Adresse gefunden).

export type DirectShop = {
  id: string;
  origin: string;
  kind: "shopify" | "html";
  /** Nur für Wein (Flaschenpost führt keine Spirituosen). */
  wineOnly?: boolean;
  search: (q: string) => string;
  /** Produktlinks in der HTML-Trefferliste (Gruppe 1 = Pfad). */
  link?: RegExp;
  /** Markenseiten in der Trefferliste (Gruppe 1 = Pfad) – deren Produktlinks werden geprüft. */
  brandLink?: RegExp;
};

const enc = (q: string) => encodeURIComponent(q).replace(/%20/g, "+");

export const DIRECT_SHOPS: DirectShop[] = [
  {
    id: "drinks.ch",
    origin: "https://www.drinks.ch",
    kind: "html",
    search: (q) => `https://www.drinks.ch/de/search?q=${enc(q)}`,
    link: /href="(?:https:\/\/www\.drinks\.ch)?(\/de\/[a-z0-9-]+\.html)"/g,
    brandLink: /href="(?:https:\/\/www\.drinks\.ch)?(\/de\/marken\/[a-z0-9-]+\.html)"/g,
  },
  { id: "casapoli.ch", origin: "https://casapoli.ch", kind: "shopify", search: (q) => `https://casapoli.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
  { id: "finespirits.ch", origin: "https://finespirits.ch", kind: "shopify", search: (q) => `https://finespirits.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
  { id: "bringts.ch", origin: "https://www.bringts.ch", kind: "shopify", search: (q) => `https://www.bringts.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
  { id: "napawine.ch", origin: "https://napawine.ch", kind: "shopify", search: (q) => `https://napawine.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
  { id: "flaschenpost.ch", origin: "https://www.flaschenpost.ch", kind: "html", wineOnly: true, search: (q) => `https://www.flaschenpost.ch/wein?search=${enc(q)}`, link: /href="(\/[a-z0-9-]+_[a-z0-9-]+\?_size=\d+(?:&amp;|&)_vintage=\d+)"/g },
  { id: "piemont-weine.ch", origin: "https://piemont-weine.ch", kind: "html", search: (q) => `https://piemont-weine.ch/search?q=${enc(q)}`, link: /href="(?:https:\/\/piemont-weine\.ch)?(\/p\/[a-z0-9-]+)"/g },
  { id: "bauraulacvins.ch", origin: "https://www.bauraulacvins.ch", kind: "html", search: (q) => `https://www.bauraulacvins.ch/de/search.html?query=${enc(q)}`, link: /href="(?:https:\/\/www\.bauraulacvins\.ch)?(\/de\/p\/[a-z0-9/-]+\.html)"/g },
];

/** Shops für diese Art (Spirituose: ohne reine Weinshops). */
export const directShopsFor = (type: string | null | undefined) => DIRECT_SHOPS.filter((s) => !(s.wineOnly && type === "spirit"));

export type ShopHit = { url: string; label: string };

/** Shopify /search/suggest.json → Produkte (Adresse ohne Such-Parameter, Titel). */
export function shopifySuggestHits(json: unknown, origin: string): ShopHit[] {
  const products = (json as { resources?: { results?: { products?: { title?: string; url?: string }[] } } } | null)?.resources?.results?.products ?? [];
  return products.flatMap((p) => {
    if (!p.title || !p.url) return [];
    const path = p.url.split("?")[0];
    return [{ url: path.startsWith("http") ? path : `${origin}${path}`, label: p.title }];
  });
}

/** HTML-Trefferliste → Produktlinks; Bezeichnung aus der Adresse („lazzaroni-amaretto-70cl“). */
export function htmlSearchHits(html: string, shop: DirectShop): ShopHit[] {
  if (!shop.link) return [];
  const seen = new Set<string>();
  const hits: ShopHit[] = [];
  for (const m of html.matchAll(new RegExp(shop.link.source, "g"))) {
    const path = m[1].replace(/&amp;/g, "&");
    const url = `${shop.origin}${path}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const slug = path.split("?")[0].split("/").pop()!.replace(/\.html$/, "");
    const extra = path.match(/_size=(\d+)/) ? ` ${Math.round(Number(path.match(/_size=(\d+)/)![1]) / 10)}cl` : "";
    const year = path.match(/_vintage=(\d{4})/)?.[1];
    hits.push({ url, label: `${slug.replace(/[-_]+/g, " ")}${extra}${year ? ` ${year}` : ""}` });
  }
  return hits;
}

/** Spirituosen-Wörter: in einem Treffer für einen Wein ein anderes Produkt („Grappa di Barolo“). */
const SPIRIT_WORDS = new Set("grappa brandy cognac whisky whiskey gin rum vodka likor liqueur liquore marc tresterbrand destillat".split(" "));

/** Markenseiten in einer HTML-Trefferliste, deren Adresse zum Namen passt („…/marken/noah-s-mill.html“). */
export function brandPageHits(html: string, shop: DirectShop, want: { name: string }): string[] {
  if (!shop.brandLink) return [];
  const need = wordsOf(want.name.replace(/['’`´]/g, "")).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(shop.brandLink.source, "g"))) {
    const url = `${shop.origin}${m[1]}`;
    const slug = wordsOf(m[1].split("/").pop()!.replace(/\.html$/, "")).join("");
    if (!out.includes(url) && need.length && need.every((w) => slug.includes(w))) out.push(url);
  }
  return out;
}

/**
 * Treffer einer Shop-Suche, die zum gesuchten Produkt passen (Name bzw. Marke im Titel/Slug), die
 * genauesten zuerst: Marke im Titel, gleiche Grösse, kein abweichender Zusatz, wenig fremde Wörter
 * („Disaronno 70cl“ vor „Disaronno Velvet 70cl“ und „Disaronno 50cl“). Höchstens max.
 */
export function rankHits(hits: ShopHit[], want: { name: string; producer?: string | null; year?: number | null; sizeMl?: number | null; type?: string | null }, max = 2): ShopHit[] {
  const brand = brandFromProducer(want.producer);
  const known = new Set([...wordsOf(want.name), ...wordsOf(brand), ...wordsOf(want.producer)]);
  const scored = hits.flatMap((h) => {
    const same = sameProduct({ name: want.name, producer: want.producer, year: want.year ?? null }, h.label, brand);
    if (!same.same) return [];
    const words = wordsOf(h.label);
    // Wein gesucht, Treffer ist eine Spirituose (oder umgekehrt egal: Spirituosen-Shops führen beides).
    if (want.type && want.type !== "spirit" && words.some((w) => SPIRIT_WORDS.has(w)) && !wordsOf(want.name).some((w) => SPIRIT_WORDS.has(w))) return [];
    // Marke im Titel: genauer (bei Gattungsnamen wie „Amaretto“ entscheidend).
    const brandHit = brand ? brandInName(brand, h.label) : false;
    if (genericName(want.name) && brand && !brandHit) return [];
    const size = sizeFromText(h.label);
    const sizeScore = want.sizeMl && size ? (size === want.sizeMl ? 2 : -2) : 0;
    const extra = words.filter((w) => !known.has(w) && !/^\d+(cl|ml|l)?$/.test(w) && !GENERIC_NAMES.has(w) && w !== "cl" && w !== "ml").length;
    return [{ h, score: (brandHit ? 2 : 0) + (same.mismatch ? 0 : 1) + sizeScore - extra * 0.5 }];
  });
  const sorted = scored.sort((a, b) => b.score - a.score);
  // Nur die genauesten: deutlich schlechtere (z. B. „Velvet“ neben dem Original) fallen weg.
  return sorted.filter((x) => x.score >= sorted[0].score - 0.5).slice(0, max).map((x) => x.h);
}

// ——— Websuche auswerten ———

export type SearchLog = { query: string; urls: string[]; error?: string };

type Block = { type: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown };

/**
 * Aus den Antworten des Modells: ausgeführte Suchen (server_tool_use web_search) in Reihenfolge, je
 * Suche die gefundenen Adressen (web_search_tool_result) bzw. der Fehler (z. B. max_uses_exceeded).
 */
export function searchLog(blocks: Block[]): SearchLog[] {
  const out: SearchLog[] = [];
  const byId = new Map<string, SearchLog>();
  for (const b of blocks) {
    if (b.type === "server_tool_use" && b.name === "web_search") {
      const entry: SearchLog = { query: String((b.input as { query?: unknown } | null)?.query ?? ""), urls: [] };
      out.push(entry);
      if (b.id) byId.set(b.id, entry);
    } else if (b.type === "web_search_tool_result") {
      const entry = (b.tool_use_id && byId.get(b.tool_use_id)) || { query: "", urls: [] };
      if (!out.includes(entry)) out.push(entry);
      if (Array.isArray(b.content)) entry.urls.push(...b.content.flatMap((r) => (typeof (r as { url?: unknown })?.url === "string" ? [(r as { url: string }).url] : [])));
      else entry.error = String((b.content as { error_code?: unknown } | null)?.error_code ?? "error");
    }
  }
  return out;
}

/** Titel zu jeder Adresse aus den Suchergebnissen (für die Reihenfolge der eigenen Prüfung). */
export function searchTitles(blocks: Block[]) {
  const titles = new Map<string, string>();
  for (const b of blocks) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content as { url?: string; title?: string }[]) if (r.url && r.title && !titles.has(r.url)) titles.set(r.url, r.title);
  }
  return titles;
}

/** Such-, Kategorie- und Übersichtsseiten – keine Produktseiten. */
const NOT_PRODUCT = /\/(search|suche|recherche|catalogsearch|collections\/?$|blogs?|news|magazin|ratgeber)(\/|\?|$)|[?&](q|search|query)=/i;

/**
 * Adressen Schweizer Shops aus den Suchergebnissen – unabhängig davon, was das Modell meldet. Zum
 * gesuchten Produkt passende Titel zuerst, ohne Such-/Übersichtsseiten, je Shop höchstens zwei,
 * insgesamt höchstens max.
 */
export function swissResultUrls(searches: SearchLog[], titles: Map<string, string>, want: { name: string; producer?: string | null; year?: number | null }, max = 8): string[] {
  const seen = new Set<string>();
  const candidates: { url: string; score: number; order: number }[] = [];
  let order = 0;
  for (const s of searches) {
    for (const url of s.urls) {
      if (seen.has(url) || !swissMerchantUrl(url) || NOT_PRODUCT.test(url)) continue;
      seen.add(url);
      const title = titles.get(url) ?? "";
      const label = `${title} ${decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ")}`;
      const same = sameProduct({ name: want.name, producer: want.producer, year: want.year ?? null }, label, brandFromProducer(want.producer));
      candidates.push({ url, score: same.same ? (same.mismatch ? 1 : 2) : 0, order: order++ });
    }
  }
  const perHost = new Map<string, number>();
  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .filter((c) => {
      const host = hostOf(c.url) ?? "";
      const n = perHost.get(host) ?? 0;
      perHost.set(host, n + 1);
      return n < 2;
    })
    .slice(0, max)
    .map((c) => c.url);
}

/** Diagnose: Adressen gekürzt (ohne Such-Parameter, höchstens 120 Zeichen), höchstens 10 je Suche. */
export const shortUrl = (url: string) => url.replace(/[?#].*$/, "").slice(0, 120);
export const compactSearches = (searches: SearchLog[]) =>
  searches.map((s) => ({ query: s.query.slice(0, 120), urls: s.urls.slice(0, 10).map(shortUrl), ...(s.error ? { error: s.error } : {}) }));

// ——— Bester Treffer ———

/**
 * source „model“: Preis nur laut Antwort des Modells (Seite selbst nicht lesbar, z. B. Bot-Sperre) –
 * zählt nie vor einem selbst geprüften Treffer. soldOut: ausverkauft (Preis gilt, Vermerk im price_note).
 */
export type Found = {
  kind: "exact" | "other";
  amount: number;
  merchant: string;
  url: string;
  year: number | null;
  sizeMl: number;
  why?: string;
  reason?: string;
  soldOut?: boolean;
  source?: "model";
  /** Händler-Domain, falls die URL keine Händlerseite ist (Google-Link) – für „je Händler ein Angebot“. */
  domain?: string | null;
};

/** Höchstens so weit (×1.25) dürfen exakte Preise auseinanderliegen, um als gleich zu gelten. */
export const PRICE_SPREAD = 1.25;

const chf = (n: number) => formatMoney(n, "CHF")!;

/**
 * Bester Treffer: selbst geprüfte exakte vor Modell-Treffern, exakt vor „other“. Mehrere exakte
 * Händler (je Händler ein Angebot): die Preise müssen beieinander liegen (höchstens 25 %
 * auseinander). Ausreisser fallen weg, wenn die Mehrheit beieinander liegt; sonst „other“ mit
 * Rückfrage und beiden Preisen (reason price_spread). Innerhalb der Gruppe: bei zwei Händlern der
 * höhere (eher Normal- als Aktionspreis), sonst der häufigste bzw. mittlere Preis.
 */
export function pickBest(found: Found[]): (Found & { merchants: number }) | null {
  const verified = found.filter((f) => f.kind === "exact" && f.source !== "model");
  if (!verified.length) {
    const fallback = found.find((f) => f.kind === "exact") ?? found.find((f) => f.kind === "other" && f.source !== "model") ?? found.find((f) => f.kind === "other");
    return fallback ? { ...fallback, merchants: 1 } : null;
  }
  // Je Händler (Host) nur ein Angebot.
  const byHost = new Map<string, Found>();
  for (const f of verified) {
    const key = f.domain ?? hostOf(f.url) ?? f.url;
    if (!byHost.has(key)) byHost.set(key, f);
  }
  const list = [...byHost.values()].sort((a, b) => a.amount - b.amount);
  if (list.length === 1) return { ...list[0], merchants: 1 };
  // Grösste Gruppe, deren Preise höchstens 25 % auseinanderliegen.
  let group: Found[] = [];
  for (let i = 0; i < list.length; i++) {
    const g = list.filter((f) => f.amount >= list[i].amount && f.amount <= list[i].amount * PRICE_SPREAD);
    if (g.length > group.length) group = g;
  }
  if (group.length * 2 <= list.length) {
    // Uneindeutig (z. B. 15.90 und 29.90): nachfragen, mit den Preisen der anderen Händler.
    const top = list[list.length - 1];
    const others = list.slice(0, -1).map((f) => `${chf(f.amount)} (${f.merchant})`).join(", ");
    return { ...top, kind: "other", reason: "price_spread", why: `Preise uneinheitlich, auch ${others}`, merchants: list.length };
  }
  if (group.length === 2) return { ...group[1], merchants: group.length };
  const counts = new Map<number, number>();
  for (const f of group) counts.set(f.amount, (counts.get(f.amount) ?? 0) + 1);
  const most = Math.max(...counts.values());
  const pick = most > 1 ? group.find((f) => counts.get(f.amount) === most)! : group[Math.floor((group.length - 1) / 2)];
  return { ...pick, merchants: group.length };
}
