// Preissuche (rein, ohne Netz): Marke aus dem Produzenten, feste Suchbegriffe, direkte Suchen in
// Schweizer Shops (Adressen und Auswertung), URLs aus den Websuche-Ergebnissen sammeln und den
// besten Treffer wählen. Netz, Modell und DB kommen in price.ts dazu.

import { sameProduct, sizeFromText, wordsOf } from "./price-match";
import { SHOP_DOMAINS } from "./shops/match";

export const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Schweizer Händler: Domain .ch bzw. einer der bekannten Schweizer Shops (moevenpick-wein.com). */
export function swissMerchantUrl(url: string) {
  const host = hostOf(url);
  return host != null && (host.endsWith(".ch") || SHOP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)));
}

// ——— Marke und Suchbegriffe ———

/** Familienzusatz am Ende: „& Figli“, „e Figli“, „& Fils“, „& Sons“, „& Söhne“, „Fratelli“ … */
const FAMILY_RE = /\s*(?:&|\+|\be\b|\bet\b|\bund\b|\band\b|\by\b)\s*(?:figli|figlio|fils|sons?|söhne|soehne|hijos|filhos|nipoti|co\.?|cie\.?|c\.?)\s*\.?$/i;
/** Rechtsformen (auch mit Punkten: „S.p.A.“, „S.r.l.“). */
const LEGAL_RE = /(?:^|\s)(?:s\.?\s?p\.?\s?a|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?s|s\.?\s?a|s\.?\s?a\.?\s?r\.?\s?l|sarl|ag|gmbh|ltd|inc|llc|bv|nv|kg)\.?(?=\s|$|,)/gi;
/** Betriebswörter – gehören nicht zur Marke („Distilleria“, „Cantina“, „Weingut“, „Bodega“ …). */
const BUSINESS = new Set(
  "distilleria distillerie distilleries distillery distilerias destilerias destileria brennerei destillerie weingut weinbau weinkellerei kellerei domaine domaines chateau château cantina cantine bodega bodegas tenuta azienda agricola vinicola vitivinicola fattoria maison winery wines estate estates casa fratelli famiglia family famille cooperativa caves cave vignobles vigneti agriturismo società societa compagnia company".split(" "),
);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Marke aus dem Produzenten: Klammerzusatz (oft die Marke) bzw. der Name ohne Rechtsform,
 * Betriebswörter und Familienzusatz; mit Familienzusatz nur der Familienname.
 * „Paolo Lazzaroni & Figli“ → „Lazzaroni“, „Distilleria Giovannipoli (Casa Grappa)“ → „Casa Grappa“,
 * „Illva Saronno S.p.A.“ → „Illva Saronno“. Leer → null.
 */
export function brandFromProducer(producer: string | null | undefined): string | null {
  const p = (producer ?? "").trim();
  if (!p) return null;
  const inner = p.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (inner && inner.length >= 2) return inner;
  let s = p.replace(/\([^)]*\)/g, " ").replace(LEGAL_RE, " ").replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim();
  const family = FAMILY_RE.test(s);
  s = s.replace(FAMILY_RE, "").trim();
  const words = s.split(/\s+/).filter((w) => w && !BUSINESS.has(fold(w).replace(/[^a-z]/g, "")) && !/^(di|de|del|della|dei|des|du|da|von|van|la|le|el)$/i.test(w));
  if (!words.length) return s || null;
  // „Paolo Lazzaroni & Figli“: die Marke ist der Familienname.
  return family ? words[words.length - 1] : words.join(" ");
}

/** Gattungsnamen – allein nichtssagend, immer mit Marke suchen. */
const GENERIC_NAMES = new Set(
  "amaretto grappa gin rum rhum ron vodka whisky whiskey cognac brandy likor liquor liqueur liquore limoncello sambuca vermouth wermut vermut pisco tequila mezcal calvados armagnac kirsch williams obstbrand pflumli zwetschgen schnaps bitter aperitivo americano port porto sherry madeira marsala chardonnay merlot pinot noir grigio gris blanc bianco blanco rosso rouge rot weiss rose rosato rosado sauvignon cabernet syrah shiraz riesling prosecco champagne cava cremant spumante chianti nebbiolo barbera dolcetto primitivo sangiovese tempranillo malbec zinfandel moscato muscat premium original originale classic classico reserve riserva reserva selection vino wine wein extra dry old fine special superior".split(" "),
);

/** Name nur aus Gattungswörtern („Amaretto“, „Premium Pisco“, „Grappa Riserva“) bzw. sehr kurz. */
export function genericName(name: string) {
  const w = wordsOf(name).filter((x) => !/^\d+$/.test(x));
  return w.length === 0 || w.every((x) => GENERIC_NAMES.has(x) || x.length <= 2) || name.trim().length <= 4;
}

/** Ist die Marke schon im Namen? („Disaronno“ enthält „Saronno“ aus „Illva Saronno“.) */
const brandInName = (brand: string, name: string) => {
  const nameJoined = wordsOf(name).join("");
  return wordsOf(brand).some((b) => b.length >= 4 && nameJoined.includes(b));
};

/**
 * Produkt für die Suche: Marke + Name („Lazzaroni Amaretto“, „Wildhaber Creanza“); steckt die Marke
 * schon im Namen, der Name allein („Disaronno“). Ohne Produzent: der Name.
 */
export function productTerm(want: { name: string; producer?: string | null }) {
  const name = want.name.trim();
  const brand = brandFromProducer(want.producer);
  if (!brand || brandInName(brand, name)) return name;
  return `${brand} ${name}`;
}

/** „70cl“, „75cl“, „150cl“ – so wie in Shop-Titeln. */
export const clTerm = (ml: number) => `${Math.round(ml / 10)}cl`;

/**
 * Feste Suchbegriffe in dieser Reihenfolge: „<Marke> <Name> <Grösse>“, „… kaufen CHF“, „… site:.ch“,
 * mit Händler „<Händler> <Marke> <Name>“, bei eigenständigem Namen zuletzt der Name mit Grösse.
 * Jahrgang hinten am Produkt. Der Händler (auch Ketten wie Coop, Denner) nur mit dem ganzen Produkt.
 */
export function priceQueries(want: { name: string; producer?: string | null; year?: number | null; sizeMl: number; vendor?: string | null }) {
  const product = productTerm(want);
  const p = want.year != null ? `${product} ${want.year}` : product;
  const size = clTerm(want.sizeMl);
  const vendor = want.vendor?.trim();
  const own = !genericName(want.name) && wordsOf(want.name).length >= 2 && product !== want.name.trim();
  const name = want.year != null ? `${want.name.trim()} ${want.year}` : want.name.trim();
  return [
    ...new Set([`${p} ${size}`, `${p} kaufen CHF`, `${p} site:.ch`, ...(vendor ? [`${vendor} ${p}`] : []), ...(own ? [`${name} ${size}`] : [])]),
  ];
}

// ——— Direkte Suche in Schweizer Shops ———
// Geprüft am 29.10.2026 (ohne Login, robots.txt erlaubt die Suche): Shopify-Suche
// /search/suggest.json bei casapoli.ch, napawine.ch, finespirits.ch; HTML-Suche bei drinks.ch
// (/de/search?q=), flaschenpost.ch (/wein?search=, nur Wein), piemont-weine.ch (/search?q=) und
// bauraulacvins.ch (/de/search.html?query=). Produktseiten mit schema.org bzw. Microdata.
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
};

const enc = (q: string) => encodeURIComponent(q).replace(/%20/g, "+");

export const DIRECT_SHOPS: DirectShop[] = [
  { id: "drinks.ch", origin: "https://www.drinks.ch", kind: "html", search: (q) => `https://www.drinks.ch/de/search?q=${enc(q)}`, link: /href="(?:https:\/\/www\.drinks\.ch)?(\/de\/[a-z0-9-]+\.html)"/g },
  { id: "casapoli.ch", origin: "https://casapoli.ch", kind: "shopify", search: (q) => `https://casapoli.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
  { id: "finespirits.ch", origin: "https://finespirits.ch", kind: "shopify", search: (q) => `https://finespirits.ch/search/suggest.json?q=${enc(q)}&resources%5Btype%5D=product&resources%5Blimit%5D=10` },
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

export type Found = { kind: "exact" | "other"; amount: number; merchant: string; url: string; year: number | null; sizeMl: number; why?: string; reason?: string };

/**
 * Bester Treffer: exakt (Name, Grösse, Jahrgang) vor „other“. Mehrere exakte (verschiedene
 * Händler): der häufigste Preis, bei Gleichstand der mittlere (Median, bei gerader Zahl der untere)
 * – mit der Zahl der Händler (merchants). Null ohne Treffer.
 */
export function pickBest(found: Found[]): (Found & { merchants: number }) | null {
  const exact = found.filter((f) => f.kind === "exact");
  if (!exact.length) {
    const other = found.find((f) => f.kind === "other");
    return other ? { ...other, merchants: 1 } : null;
  }
  // Je Händler (Host) nur ein Angebot.
  const byHost = new Map<string, Found>();
  for (const f of exact) if (!byHost.has(hostOf(f.url) ?? f.url)) byHost.set(hostOf(f.url) ?? f.url, f);
  const list = [...byHost.values()].sort((a, b) => a.amount - b.amount);
  const counts = new Map<number, number>();
  for (const f of list) counts.set(f.amount, (counts.get(f.amount) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const pick = top > 1 ? list.find((f) => counts.get(f.amount) === top)! : list[Math.floor((list.length - 1) / 2)];
  return { ...pick, merchants: list.length };
}
