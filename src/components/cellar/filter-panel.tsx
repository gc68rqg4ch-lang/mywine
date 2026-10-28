"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useLiveSearch } from "@/components/cellar/live-search";
import { mergeOptions, type OptionPart } from "@/lib/cellar/filters";
import { EMPTY_FILTERS, activeFilterCount, listHref, toggle, type ListFilters, type ListState } from "@/lib/cellar/list-params";
import { DRINK_STATUS_LABELS } from "@/lib/cellar/overview";

const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const stars = (n: number) => `${n.toLocaleString("de-CH")} ★`;

/**
 * Knopf „Filter“ neben der Suche: öffnet ein Feld mit Auswahlknöpfen. Jede Auswahl gilt
 * sofort (URL), Filter sind kombinierbar; „Zurücksetzen“ löscht alle. Die Auswahl richtet sich
 * live nach der Suche (Beiträge je Eintrag, zusammengeführt über die sichtbaren).
 */
export function FilterPanel({ basePath, state, optionParts }: { basePath: string; state: ListState; optionParts: [string, OptionPart][] }) {
  const router = useRouter();
  const { query, visible } = useLiveSearch();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const f = state.filters;
  const count = activeFilterCount(f);
  const options = useMemo(
    () => mergeOptions(optionParts.flatMap(([id, part]) => (visible == null || visible.has(id) ? [part] : [])), f),
    [optionParts, visible, f],
  );

  const apply = (next: Partial<ListFilters>) => {
    const filters = { ...f, ...next };
    startTransition(() => router.replace(listHref(basePath, { ...state, query }, { filters }), { scroll: false }));
  };

  const chips = (title: string, values: string[], selected: string[], key: keyof ListFilters, show: (v: string) => string = (v) => v) =>
    values.length > 0 && (
      <fieldset className="filter-group">
        <legend>{title}</legend>
        <div className="filter-chips">
          {values.map((v) => (
            <button
              key={v}
              type="button"
              className={selected.includes(v) ? "chip active" : "chip"}
              aria-pressed={selected.includes(v)}
              onClick={() => apply({ [key]: toggle(selected, v) } as Partial<ListFilters>)}
            >
              {show(v)}
            </button>
          ))}
        </div>
      </fieldset>
    );

  return (
    <>
      <button
        type="button"
        className={count ? "btn btn-sm filter-button active" : "btn btn-sm filter-button"}
        aria-expanded={open}
        aria-controls="filter-panel"
        onClick={() => setOpen((o) => !o)}
      >
        Filter{count ? <span className="badge">{count}</span> : null}
      </button>
      {open && (
        <div id="filter-panel" className="filter-panel card stack" aria-busy={pending}>
          <div className="row row-between">
            <strong>Filter</strong>
            <span className="row">
              {count > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(EMPTY_FILTERS)}>
                  Zurücksetzen
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Filter schliessen">
                ✕
              </button>
            </span>
          </div>
          {chips("Land", options.countries, f.countries, "countries")}
          {chips("Region", options.regions, f.regions, "regions")}
          {chips("Rebsorte", options.grapes, f.grapes, "grapes")}
          {options.years.length > 0 && (
            <fieldset className="filter-group">
              <legend>Jahrgang</legend>
              <div className="row">
                <label className="field filter-year">
                  <span>von</span>
                  <select value={f.yearFrom ?? ""} onChange={(e) => apply({ yearFrom: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {options.years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field filter-year">
                  <span>bis</span>
                  <select value={f.yearTo ?? ""} onChange={(e) => apply({ yearTo: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {options.years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
          )}
          {chips("Preisklasse", options.priceClasses, f.priceClasses, "priceClasses", (v) => `${v} CHF`)}
          {chips("Trinkreife", options.drink, f.drink, "drink", (v) => DRINK_STATUS_LABELS[v as keyof typeof DRINK_STATUS_LABELS])}
          {(options.persons.length > 0 || f.minRating != null) && (
            <fieldset className="filter-group">
              <legend>Bewertung</legend>
              <div className="row">
                <label className="field filter-year">
                  <span>ab</span>
                  <select value={f.minRating ?? ""} onChange={(e) => apply({ minRating: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">–</option>
                    {RATINGS.map((r) => (
                      <option key={r} value={r}>
                        {stars(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="filter-chips">
                  {[...options.persons.map((p) => ({ value: p as string | null, label: p })), { value: null, label: "eine von beiden" }].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={f.ratingBy === p.value ? "chip active" : "chip"}
                      aria-pressed={f.ratingBy === p.value}
                      onClick={() => apply({ ratingBy: p.value, minRating: f.minRating ?? 4 })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
          )}
          {chips("Händler", options.vendors, f.vendors, "vendors")}
        </div>
      )}
    </>
  );
}
