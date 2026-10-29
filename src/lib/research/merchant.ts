// Händler eines Google-Shopping-Angebots: Domain aus dem Link (bei Google-Weiterleitungen die
// Ziel-URL aus dem Parameter), sonst aus dem Händlernamen („Korkenknaller.ch“, „by Vinello.ch“),
// sonst aus der Liste bekannter Schweizer Händler. Schweizer Händler = Domain .ch/.swiss bzw. eine
// der bekannten Schweizer Domains mit anderer Endung. Rein.
//
// Antwortfelder (geprüft an gespeicherten Testläufen): Serper liefert in „link“ nur eine
// Google-Suchseite (https://www.google.com/search?ibp=oshop&…), keinen Händlerlink – dort bleibt
// nur der Händlername. SerpApi: „link“ (teils Händler, teils Google-Weiterleitung /url?url=… bzw.
// /aclk?…&adurl=…) und „product_link“ (Google-Produktseite).

import { SHOP_DOMAINS } from "./shops/match";

/** Schweizer Händler mit anderer Endung als .ch (Mövenpick, Feldschlösschen …). */
export const SWISS_DOMAINS: readonly string[] = [...SHOP_DOMAINS.filter((d) => !d.endsWith(".ch")), "feldschloesschen.swiss"];

/**
 * Bekannte Schweizer Händler, wie Google sie ohne Domain nennt (Serper liefert keinen
 * Händlerlink). Schlüssel: Name klein, ohne Akzente.
 */
export const SWISS_MERCHANT_NAMES: Record<string, string> = {
  "casa poli": "casapoli.ch",
  galaxus: "galaxus.ch",
  digitec: "digitec.ch",
  brack: "brack.ch",
  coop: "coop.ch",
  denner: "denner.ch",
  manor: "manor.ch",
  globus: "globus.ch",
  gerstl: "gerstl.ch",
  "gerstl weinselektionen": "gerstl.ch",
  movenpick: "moevenpick-wein.com",
  "movenpick wein": "moevenpick-wein.com",
  "caratello weine": "caratello.ch",
  "feldschlosschen getranke shop": "feldschloesschen.swiss",
};

const nameKey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();

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

export type Merchant = { url: string | null; domain: string | null; swiss: boolean };

/**
 * Händler eines Angebots. Ohne bestimmbare Domain → nicht Schweizer (lieber kein Preis als ein
 * ausländischer).
 */
export function merchantOf(source: string, link: string | null | undefined): Merchant {
  const url = merchantUrl(link);
  const domain = (url && host(url)) || domainInName(source) || SWISS_MERCHANT_NAMES[nameKey(source)] || null;
  return { url, domain, swiss: domain != null && swissDomain(domain) };
}
