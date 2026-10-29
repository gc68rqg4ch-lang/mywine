// Kategorien der Spirituosen (rein): zwei Ebenen (Hauptkategorie → Unterkategorie, z. B. Whisky →
// Bourbon), aus spirit_categories. Ein Wein (Art „spirit“) verweist auf eine Haupt- oder eine
// Unterkategorie. Anlegen nur über Antoine nach Bestätigung – die App verwaltet sie nicht.

import { foldText } from "@/lib/text/fold";

export type SpiritCategory = { id: string; parentId: string | null; name: string; sortOrder: number };

/** Angaben einer Spirituose (aus wines). */
export type SpiritFields = {
  categoryId: string | null;
  ageYears: number | null;
  cask: string | null;
  distilledYear: number | null;
  bottledYear: number | null;
};

export type CategoryPath = { main: SpiritCategory | null; sub: SpiritCategory | null };

const byOrder = (a: SpiritCategory, b: SpiritCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de-CH");

export const mainCategories = (all: SpiritCategory[]) => all.filter((c) => c.parentId == null).sort(byOrder);
export const subCategories = (all: SpiritCategory[], mainId: string) => all.filter((c) => c.parentId === mainId).sort(byOrder);

/** Haupt- und (falls gespeichert) Unterkategorie zu einer gespeicherten Kategorie. */
export function categoryPath(all: SpiritCategory[], id: string | null | undefined): CategoryPath {
  const cat = id ? all.find((c) => c.id === id) : undefined;
  if (!cat) return { main: null, sub: null };
  if (cat.parentId == null) return { main: cat, sub: null };
  return { main: all.find((c) => c.id === cat.parentId) ?? null, sub: cat };
}

/** „Whisky › Bourbon“ bzw. „Whisky“; null ohne Kategorie. */
export function categoryLabel(path: CategoryPath) {
  if (!path.main) return null;
  return path.sub ? `${path.main.name} › ${path.sub.name}` : path.main.name;
}

/** Gleicher Name? (Gross/Klein, Akzente, „/“ und Leerzeichen egal.) */
const same = (a: string, b: string) => foldText(a) === foldText(b);
/** Name passt zu einem Teil („Apfel / Calvados“ passt zu „Calvados“, „Tequila / Mezcal“ zu „Mezcal“). */
const matchesPart = (name: string, wanted: string) => same(name, wanted) || name.split("/").some((part) => same(part, wanted));

/**
 * Bestehende Kategorie zu erkannten Namen (Haupt-, ggf. Unterkategorie). Gibt die genaueste passende
 * zurück: Unterkategorie, wenn sie passt, sonst die Hauptkategorie. missingSub: die Unterkategorie
 * gibt es unter dieser Hauptkategorie nicht (dann gilt die Hauptkategorie); missingMain: erkannte
 * Hauptkategorie gibt es nicht. Neue Kategorien schlägt Antoine nicht vor.
 */
export function matchCategory(
  all: SpiritCategory[],
  main: string | null | undefined,
  sub: string | null | undefined,
): { category: SpiritCategory | null; main: SpiritCategory | null; missingSub: string | null; missingMain: string | null } {
  const mainName = main?.trim() || null;
  const subName = sub?.trim() || null;
  const mainCat = mainName ? (mainCategories(all).find((c) => matchesPart(c.name, mainName)) ?? null) : null;
  // Nur die Unterkategorie bekannt (z. B. „Bourbon“): Hauptkategorie daraus.
  if (!mainCat && subName) {
    const viaSub = all.find((c) => c.parentId != null && matchesPart(c.name, subName));
    if (viaSub) return { category: viaSub, main: all.find((c) => c.id === viaSub.parentId) ?? null, missingSub: null, missingMain: null };
  }
  // „Bourbon“ als Hauptkategorie erkannt: gibt es als Unterkategorie.
  if (!mainCat && mainName) {
    const asSub = all.find((c) => c.parentId != null && matchesPart(c.name, mainName));
    if (asSub) return { category: asSub, main: all.find((c) => c.id === asSub.parentId) ?? null, missingSub: null, missingMain: null };
  }
  if (!mainCat) return { category: null, main: null, missingSub: null, missingMain: mainName };
  if (!subName || matchesPart(mainCat.name, subName)) return { category: mainCat, main: mainCat, missingSub: null, missingMain: null };
  const subCat = subCategories(all, mainCat.id).find((c) => matchesPart(c.name, subName)) ?? null;
  return subCat ? { category: subCat, main: mainCat, missingSub: null, missingMain: null } : { category: mainCat, main: mainCat, missingSub: subName, missingMain: null };
}

/** Bestehende Kategorie mit diesem Namen auf dieser Ebene (für „Anlegen“: keine Doppelten). */
export const findSibling = (all: SpiritCategory[], parentId: string | null, name: string) =>
  all.find((c) => c.parentId === parentId && same(c.name, name)) ?? null;

/** Zeile aus spirit_categories → SpiritCategory. */
export const toCategory = (r: { id: string; parent_id: string | null; name: string; sort_order: number | null }): SpiritCategory => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  sortOrder: r.sort_order ?? 0,
});

/** Spalten aus wines (fehlen vor der Migration) → SpiritFields. */
export function toSpiritFields(r: Record<string, unknown>): SpiritFields {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    categoryId: str(r.spirit_category_id),
    ageYears: num(r.age_years),
    cask: str(r.cask),
    distilledYear: num(r.distilled_year),
    bottledYear: num(r.bottled_year),
  };
}

export const EMPTY_SPIRIT: SpiritFields = { categoryId: null, ageYears: null, cask: null, distilledYear: null, bottledYear: null };

/** Zeilen für Detailansichten: „Whisky › Bourbon“, „12 Jahre“, „Fass: …“, „Destilliert 2008“, „Abgefüllt 2020“. */
export function spiritDetailLines(all: SpiritCategory[], f: SpiritFields | undefined): string[] {
  if (!f) return [];
  return [
    categoryLabel(categoryPath(all, f.categoryId)),
    f.ageYears ? `${f.ageYears} ${f.ageYears === 1 ? "Jahr" : "Jahre"}` : null,
    f.cask ? `Fass/Finish: ${f.cask}` : null,
    f.distilledYear ? `Destilliert ${f.distilledYear}` : null,
    f.bottledYear ? `Abgefüllt ${f.bottledYear}` : null,
  ].filter((l): l is string => l != null);
}
