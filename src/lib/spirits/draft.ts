// Spirituose bei der Erfassung durch Antoine (rein): Angaben vom Etikett und Kategorie bestimmen –
// nur aus den bestehenden Kategorien (Antoine schlägt keine neuen vor; die legt der Chat an).

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

/** Im Zustand der Erfassung (ingest_jobs.extracted.spirit). */
export type SpiritDraft = {
  /** Erkannte Namen (Haupt-, Unterkategorie). */
  main: string | null;
  sub: string | null;
  /** Gewählte bestehende Kategorie (Haupt- oder Unterkategorie). */
  categoryId: string | null;
  /** „Whisky › Bourbon“ – für Zusammenfassung und Bestätigung. */
  label: string | null;
  /** Kategorie geklärt (erkannt, gewählt oder keine Kategorien vorhanden). */
  done: boolean;
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
    ageYears: age != null && Number.isInteger(age) && age >= 1 && age <= 100 ? age : null,
    cask: text(label?.cask),
    distilledYear: yearOf(label?.distilled_year),
    bottledYear: yearOf(label?.bottled_year),
  };
}

/** Auffang-Hauptkategorie, wenn gar keine Kategorie erkennbar ist. */
export const OTHER_CATEGORY = "Andere";

/**
 * Kategorie planen – nur bestehende, nie neue: passende Unterkategorie → diese; nur die
 * Hauptkategorie passt (Unterkategorie unbekannt) → die Hauptkategorie, ohne Rückfrage; erkannte,
 * aber unbekannte Hauptkategorie → Auswahl der bestehenden Hauptkategorien; gar nichts erkannt →
 * „Andere“ (gibt es sie nicht: Auswahl). Ohne Kategorien ist nichts zu klären. knownCategoryId:
 * Kategorie eines schon erfassten Weins – gilt.
 */
export function planCategory(all: SpiritCategory[], draft: SpiritDraft, knownCategoryId?: string | null): SpiritDraft {
  const labelOf = (id: string) => categoryLabel(categoryPath(all, id));
  const pick = (id: string): SpiritDraft => ({ ...draft, categoryId: id, label: labelOf(id), done: true });
  if (knownCategoryId && all.some((c) => c.id === knownCategoryId)) return pick(knownCategoryId);
  if (!all.length) return { ...draft, done: true };
  const m = matchCategory(all, draft.main, draft.sub);
  if (m.category) return pick(m.category.id);
  if (!draft.main && !draft.sub) {
    const other = all.find((c) => c.parentId == null && c.name.trim().toLowerCase() === OTHER_CATEGORY.toLowerCase());
    if (other) return pick(other.id);
  }
  return { ...draft, categoryId: null, label: null, done: false };
}

/** Gewählt: Kategorie steht fest. */
export const withCategory = (draft: SpiritDraft, all: SpiritCategory[], id: string): SpiritDraft => ({
  ...draft,
  categoryId: id,
  label: categoryLabel(categoryPath(all, id)),
  done: true,
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
