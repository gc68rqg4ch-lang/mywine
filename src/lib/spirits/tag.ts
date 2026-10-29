// Spirituosen in den Listen (rein): Kategorie, Alter und Fass je Eintrag – für Karte, Suche und den
// Kategorie-Filter (zwei Ebenen, nur vorhandene Kategorien mit Anzahl Flaschen).

import { categoryLabel, categoryPath, mainCategories, subCategories, type SpiritCategory, type SpiritFields } from "./categories";

export type SpiritTag = {
  mainId: string | null;
  mainName: string | null;
  subId: string | null;
  subName: string | null;
  /** „Whisky › Bourbon“ */
  label: string | null;
  ageYears: number | null;
  cask: string | null;
};

export function spiritTag(categories: SpiritCategory[], fields: SpiritFields | undefined): SpiritTag | null {
  if (!fields) return null;
  const path = categoryPath(categories, fields.categoryId);
  return {
    mainId: path.main?.id ?? null,
    mainName: path.main?.name ?? null,
    subId: path.sub?.id ?? null,
    subName: path.sub?.name ?? null,
    label: categoryLabel(path),
    ageYears: fields.ageYears,
    cask: fields.cask,
  };
}

/** Einträgen der Art „spirit“ ihre Angaben anhängen (andere bleiben unverändert). */
export function withSpiritTags<T extends { type: string | null }>(
  entries: T[],
  wineId: (e: T) => string,
  spirits: { categories: SpiritCategory[]; fields: Map<string, SpiritFields> },
): (T & { spirit?: SpiritTag | null })[] {
  return entries.map((e) => (e.type === "spirit" ? { ...e, spirit: spiritTag(spirits.categories, spirits.fields.get(wineId(e))) } : e));
}

/** Gewählte Kategorie (Liste): Hauptkategorie und ggf. Unterkategorie (IDs). */
export type SpiritFilter = { main: string | null; sub: string | null };

/** Einträge der gewählten Kategorie; ohne Auswahl alle. */
export function applySpiritFilter<T extends { spirit?: SpiritTag | null }>(entries: T[], f: SpiritFilter): T[] {
  if (!f.main) return entries;
  return entries.filter((e) => e.spirit?.mainId === f.main && (!f.sub || e.spirit?.subId === f.sub));
}

export type CategoryChip = { id: string; name: string; parts: [string, number][] };

/**
 * Chips des Kategorie-Filters: Hauptkategorien, und – ist eine gewählt – deren Unterkategorien. Nur
 * Kategorien, die in den Einträgen vorkommen; je Eintrag [ID, Flaschen] (live gezählt).
 */
export function categoryChips<T extends { spirit?: SpiritTag | null }>(
  entries: T[],
  categories: SpiritCategory[],
  f: SpiritFilter,
  idOf: (e: T) => string,
  count: (e: T) => number,
): { mains: CategoryChip[]; subs: CategoryChip[] } {
  const chip = (cat: SpiritCategory, match: (e: T) => boolean): CategoryChip => ({
    id: cat.id,
    name: cat.name,
    parts: entries.filter(match).map((e): [string, number] => [idOf(e), count(e)]),
  });
  const present = (c: CategoryChip) => c.parts.some(([, n]) => n > 0);
  const mains = mainCategories(categories)
    .map((c) => chip(c, (e) => e.spirit?.mainId === c.id))
    .filter((c) => present(c) || c.id === f.main);
  const subs = f.main
    ? subCategories(categories, f.main)
        .map((c) => chip(c, (e) => e.spirit?.subId === c.id))
        .filter((c) => present(c) || c.id === f.sub)
    : [];
  return { mains, subs };
}

/** Kartenzeile einer Spirituose: „Whisky › Bourbon“, „12 Jahre“ (leer bei Wein). */
export function spiritMeta(e: { type: string | null; spirit?: SpiritTag | null }): (string | null)[] {
  if (e.type !== "spirit" || !e.spirit) return [];
  const age = e.spirit.ageYears;
  return [e.spirit.label, age ? `${age} ${age === 1 ? "Jahr" : "Jahre"}` : null];
}

/** Spirituose: Füllstand der aktuellen Flasche je Wein (aus offenen Zeilen; die niedrigste zählt). */
export function currentFills(rows: { wine_id: string | null; status: string | null; type: string | null; fill_level_percent?: number | null }[]) {
  const fills = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "spirit" || r.status !== "open" || !r.wine_id || r.fill_level_percent == null) continue;
    fills.set(r.wine_id, Math.min(fills.get(r.wine_id) ?? 100, r.fill_level_percent));
  }
  return fills;
}

/** „aktuelle ~40 %“ – bei 100 % (bzw. unbekannt) nichts. */
export const currentFillNote = (fill: number | null | undefined) => (fill == null || fill >= 100 ? null : `aktuelle ~${fill} %`);

/** Zählt eine Zeile zum Bestand (voll, bzw. aktuelle Flasche einer Spirituose)? */
export const inStockRow = (r: { status: string | null; type: string | null }) => r.status === "sealed" || (r.status === "open" && r.type === "spirit");

/** Offene Flasche im Sinn von „Offen“ (Reiter, Kachel): nur Wein, keine Spirituosen. */
export const openWineRow = (r: { status: string | null; type: string | null }) => r.status === "open" && r.type !== "spirit";
