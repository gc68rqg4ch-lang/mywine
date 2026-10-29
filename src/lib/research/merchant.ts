// Händler eines Angebots und ob er Schweizer ist – entschieden über die echte Domain: aus dem Link
// (bei Google-Weiterleitungen die Ziel-URL aus dem Parameter), aus dem Händlernamen („Korkenknaller.ch“,
// „by Vinello.ch“) oder über die Tabelle merchants (Name → Domain, gelernt aus gelesenen
// .ch-Produktseiten, dazu Startdaten). Schweizer Händler = Domain .ch/.swiss bzw. eine bekannte
// Schweizer Domain mit anderer Endung. Rein.
//
// Antwortfelder (geprüft an gespeicherten Testläufen): Serper liefert in „link“ nur eine
// Google-Suchseite (https://www.google.com/search?ibp=oshop&…), keinen Händlerlink – dort bleibt
// nur der Händlername. SerpApi: „link“ (teils Händler, teils Google-Weiterleitung /url?url=… bzw.
// /aclk?…&adurl=…) und „product_link“ (Google-Produktseite).

import { SHOP_DOMAINS } from "./shops/match";

/** Schweizer Händler mit anderer Endung als .ch (Mövenpick, Feldschlösschen …). */
export const SWISS_DOMAINS: readonly string[] = [...SHOP_DOMAINS.filter((d) => !d.endsWith(".ch")), "feldschloesschen.swiss"];

/** Rechtsformen – fallen im Schlüssel weg („Kitsune Trading Sagl“ = „Kitsune Trading“). */
const LEGAL = new Set(["ag", "gmbh", "sa", "sagl", "sarl", "ltd", "inc", "kg", "co", "llc", "srl", "spa", "bv"]);

/**
 * Schlüssel eines Händlernamens (Spalte merchants.name_key): klein, ohne Akzente, Satzzeichen als
 * Leerzeichen, ohne Rechtsform und ohne „by“ vorne. Gleich wie in der Migration (Startdaten).
 */
export function merchantKey(name: string) {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/['’`´]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL.has(w));
  if (words[0] === "by" && words.length > 1) words.shift();
  return words.join(" ");
}

const host = (url: string) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

const isGoogle = (h: string) => /(^|\.)(google\.[a-z.]+|googleadservices\.com|googleusercontent\.com|serpapi\.com|serper\.dev)$/.test(h);

/** Händler-URL: der Link selbst bzw. bei Google-Weiterleitungen die Ziel-URL; Google-Produktseiten → null. */
export function merchantUrl(link: string | null | undefined): string | null {
  const h = link ? host(link) : null;
  if (!link || !h) return null;
  if (!isGoogle(h)) return link;
  const u = new URL(link);
  for (const p of ["url", "adurl", "q", "u"]) {
    const target = u.searchParams.get(p);
    const th = target ? host(target) : null;
    if (target && th && !isGoogle(th)) return target;
  }
  return null;
}

/** Domain im Händlernamen („Korkenknaller.ch“, „by Vinello.ch“, „Amazon.it - Seller“). */
export function domainInName(source: string): string | null {
  const m = source.toLowerCase().match(/(?:^|[^a-z0-9.-])((?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,})(?![a-z0-9.-])/);
  return m ? m[1].replace(/^www\./, "") : null;
}

export const swissDomain = (domain: string) =>
  domain.endsWith(".ch") || domain.endsWith(".swiss") || SWISS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Gelernte bzw. bekannte Händler (Tabelle merchants): Schlüssel → Domain, swiss, Herkunft. */
export type KnownMerchant = { domain: string | null; swiss: boolean; source: string };
export type KnownMerchants = Map<string, KnownMerchant>;

/** Woher die Händlererkennung stammt: Link, Domain im Namen, Tabelle merchants, in diesem Lauf von einer Seite gelernt. */
export type MerchantVia = "link" | "name" | "merchants" | "page";

export type Merchant = { url: string | null; domain: string | null; swiss: boolean; via: MerchantVia | null };

/**
 * Händler eines Angebots. Ohne bestimmbare Domain → nicht Schweizer (lieber kein Preis als ein
 * ausländischer). learned: in diesem Lauf von Seiten gelernte Namen (Herkunft „page“).
 */
export function merchantOf(source: string, link: string | null | undefined, known: KnownMerchants = new Map(), learned: KnownMerchants = new Map()): Merchant {
  const url = merchantUrl(link);
  const fromLink = url ? host(url) : null;
  if (fromLink) return { url, domain: fromLink, swiss: swissDomain(fromLink), via: "link" };
  const inName = domainInName(source);
  if (inName) return { url, domain: inName, swiss: swissDomain(inName), via: "name" };
  const key = merchantKey(source);
  const k = learned.get(key) ?? known.get(key);
  if (k?.domain) return { url, domain: k.domain, swiss: k.swiss && swissDomain(k.domain), via: learned.has(key) ? "page" : "merchants" };
  return { url, domain: null, swiss: false, via: null };
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;| /g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Name taugt als Shopname: kurz, nicht nur Zahlen/Allgemeines. */
const plausibleShopName = (s: string | null | undefined) => {
  const t = s ? decode(s) : "";
  return t.length >= 2 && t.length <= 60 && /[a-z]/i.test(t) && !/^(home|startseite|shop|online ?shop|warenkorb|produkt|product)$/i.test(t) ? t : null;
};

/**
 * Shopname einer Seite (rein): og:site_name, schema.org WebSite/Organization/Store bzw.
 * offers.seller, sonst der Titel-Zusatz („… | Drinks.ch“, „… – Hugi Weine“). null = keiner.
 */
export function shopNameFromHtml(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  const fromOg = plausibleShopName(og?.[1]);
  if (fromOg) return fromOg;
  const seller = html.match(/"seller"\s*:\s*\{[^{}]*"name"\s*:\s*"([^"]+)"/);
  const fromSeller = plausibleShopName(seller?.[1]);
  if (fromSeller) return fromSeller;
  const site = html.match(/"@type"\s*:\s*"(?:WebSite|Organization|Store|OnlineStore|LiquorStore)"[^{}]*?"name"\s*:\s*"([^"]+)"/) ?? html.match(/"name"\s*:\s*"([^"]+)"[^{}]*?"@type"\s*:\s*"(?:WebSite|Organization|Store|OnlineStore|LiquorStore)"/);
  const fromSite = plausibleShopName(site?.[1]);
  if (fromSite) return fromSite;
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!title) return null;
  const parts = decode(title).split(/\s+[|–—]\s+|\s+-\s+/);
  return parts.length > 1 ? plausibleShopName(parts[parts.length - 1]) : null;
}
