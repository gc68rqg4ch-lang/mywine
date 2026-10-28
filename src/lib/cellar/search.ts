// Suche in den Listen (rein, ohne DB): Wein, Produzent, Land, Region, Traube, Jahrgang und
// Notizen; Akzente und Gross-/Kleinschreibung egal. Läuft im Browser über die schon geladenen
// Einträge – beim Tippen kein Server- und kein Datenbank-Aufruf.

import { foldText } from "@/lib/text/fold";
import type { Groupable } from "./overview";

/** Durchsuchbarer Text eines Eintrags (gefaltet). */
export function searchText(wine: Groupable, notes?: string | null) {
  return foldText(
    [notes, wine.name, wine.producer, wine.country, wine.region, ...wine.grapes, ...wine.vintages.map((v) => (v == null ? "" : String(v)))]
      .filter(Boolean)
      .join(" "),
  );
}

/** Suchbegriffe (gefaltet); alle müssen vorkommen. */
export const queryTerms = (query: string) => foldText(query).split(" ").filter(Boolean);

export const matchesTerms = (text: string, terms: string[]) => terms.every((t) => text.includes(t));

/** Treffer-IDs; null = keine Suche (alles sichtbar). */
export function visibleIds(index: Record<string, string>, query: string): Set<string> | null {
  const terms = queryTerms(query);
  if (!terms.length) return null;
  return new Set(Object.keys(index).filter((id) => matchesTerms(index[id], terms)));
}

/** [ID, Anzahl] je Eintrag – Summe über die sichtbaren (Gruppen-Kopf, Weintyp-Knöpfe). */
export type CountParts = [id: string, count: number][];

export const liveCount = (parts: CountParts, visible: Set<string> | null) =>
  parts.reduce((s, [id, n]) => s + (visible == null || visible.has(id) ? n : 0), 0);

export const anyVisible = (ids: string[], visible: Set<string> | null) => visible == null || ids.some((id) => visible.has(id));

/** Adresse mit nachgeführtem q (andere Parameter bleiben); leere Suche → ohne q. */
export function withQuery(href: string, query: string) {
  const url = new URL(href, "http://x");
  if (query.trim()) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}`;
}
