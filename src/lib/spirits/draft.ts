// Spirituose bei der Erfassung durch Antoine (rein): Angaben vom Etikett, Kategorie bestimmen und
// – fehlt eine passende – eine neue vorschlagen (angelegt wird erst nach Bestätigung).

import { categoryLabel, categoryPath, matchCategory, type SpiritCategory } from "./categories";

/** Rohangaben der Erkennung (ohne nullable Felder: "" bzw. 0 = unbekannt). */
export type SpiritLabel = {
  kind: "wine" | "spirit" | "unsure";
  category: string;
  subcategory: string;
  age_years: number;
  cask: string;
  distilled_year: number;
  bottled_year: number;
};

export type NewCategory = { parentId: string | null; parentName: string | null; name: string };

/** Im Zustand der Erfassung (ingest_jobs.extracted.spirit). */
export type SpiritDraft = {
  /** Erkannte Namen (Haupt-, Unterkategorie). */
  main: string | null;
  sub: string | null;
  /** Gewählte bestehende Kategorie (Haupt- oder Unterkategorie). */
  categoryId: string | null;
  /** „Whisky › Bourbon“ – für Zusammenfassung und Bestätigung. */
  label: string | null;
  /** Kategorie geklärt (gewählt, angelegt oder keine Kategorien vorhanden). */
  done: boolean;
  /** Vorschlag zum Anlegen (Knöpfe „Anlegen“ / „Bestehende wählen“). */
  newCategory: NewCategory | null;
  ageYears: number | null;
  cask: string | null;
  distilledYear: number | null;
  bottledYear: number | null;
};

const text = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t.slice(0, 80) : null;
};
const yearOf = (v: number | null | undefined) => (v != null && Number.isInteger(v) && v >= 1800 && v <= 2100 ? v : null);

export function draftFromLabel(label: Partial<SpiritLabel> | null | undefined): SpiritDraft {
  const age = label?.age_years;
  return {
    main: text(label?.category),
    sub: text(label?.subcategory),
    categoryId: null,
    label: null,
    done: false,
    newCategory: null,
    ageYears: age != null && Number.isInteger(age) && age >= 1 && age <= 100 ? age : null,
    cask: text(label?.cask),
    distilledYear: yearOf(label?.distilled_year),
    bottledYear: yearOf(label?.bottled_year),
  };
}

/**
 * Kategorie planen: passende bestehende → fertig; Unterkategorie fehlt unter einer bekannten
 * Hauptkategorie → vorläufig die Hauptkategorie und Vorschlag „Neue Unterkategorie … anlegen?“;
 * unbekannte Hauptkategorie → Vorschlag „Neue Kategorie … anlegen?“; nichts erkannt → auswählen.
 * Gibt es (noch) keine Kategorien, ist nichts zu klären. knownCategoryId: Kategorie eines schon
 * erfassten Weins – gilt.
 */
export function planCategory(all: SpiritCategory[], draft: SpiritDraft, knownCategoryId?: string | null): SpiritDraft {
  const labelOf = (id: string) => categoryLabel(categoryPath(all, id));
  if (knownCategoryId && all.some((c) => c.id === knownCategoryId)) {
    return { ...draft, categoryId: knownCategoryId, label: labelOf(knownCategoryId), done: true, newCategory: null };
  }
  if (!all.length) return { ...draft, done: true, newCategory: null };
  const m = matchCategory(all, draft.main, draft.sub);
  if (m.category && !m.missingSub) return { ...draft, categoryId: m.category.id, label: labelOf(m.category.id), done: true, newCategory: null };
  if (m.main && m.missingSub) {
    return { ...draft, categoryId: m.main.id, label: m.main.name, done: false, newCategory: { parentId: m.main.id, parentName: m.main.name, name: m.missingSub } };
  }
  if (m.missingMain) return { ...draft, categoryId: null, label: null, done: false, newCategory: { parentId: null, parentName: null, name: m.missingMain } };
  return { ...draft, categoryId: null, label: null, done: false, newCategory: null };
}

/** Gewählt bzw. angelegt: Kategorie steht fest. */
export const withCategory = (draft: SpiritDraft, all: SpiritCategory[], id: string): SpiritDraft => ({
  ...draft,
  categoryId: id,
  label: categoryLabel(categoryPath(all, id)),
  done: true,
  newCategory: null,
});

/** Zeilen für Vorschlag und Bestätigung: Kategorie, Alter, Fass, Destilliert, Abgefüllt (nur Bekanntes). */
export function spiritLines(d: SpiritDraft | null | undefined): string[] {
  if (!d) return [];
  return [
    d.label ? `Kategorie: ${d.label}` : d.main ? `Kategorie: ${[d.main, d.sub].filter(Boolean).join(" › ")}` : null,
    d.ageYears ? `Alter: ${d.ageYears} ${d.ageYears === 1 ? "Jahr" : "Jahre"}` : null,
    d.cask ? `Fass/Finish: ${d.cask}` : null,
    d.distilledYear ? `Destilliert: ${d.distilledYear}` : null,
    d.bottledYear ? `Abgefüllt: ${d.bottledYear}` : null,
  ].filter((l): l is string => l != null);
}
