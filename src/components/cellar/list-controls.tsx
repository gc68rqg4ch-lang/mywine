"use client";

import Link from "next/link";
import { useRef } from "react";
import { FilterPanel } from "@/components/cellar/filter-panel";
import { useLiveSearch } from "@/components/cellar/live-search";
import { TypeChips, type TypeCount } from "@/components/cellar/type-tabs";
import type { OptionPart } from "@/lib/cellar/filters";
import { listHref, type ListState } from "@/lib/cellar/list-params";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";

/**
 * Suche mit Filter-Knopf, Gruppierung und – ausser bei „Weintyp“ – der Weintyp-Filter.
 * Die Suche filtert schon beim Tippen (im Browser, siehe live-search.tsx); Gruppierung, Typ und
 * Filter laufen über die URL (Links), damit „Zurück“ den Zustand behält – mit der aktuellen Suche.
 */
export function ListControls({
  basePath,
  state,
  groupings,
  typeCounts,
  optionParts,
  placeholder = "Suche: Wein, Produzent, Region, Traube, Jahrgang …",
}: {
  basePath: string;
  state: ListState;
  groupings: GroupBy[];
  typeCounts: TypeCount[];
  optionParts: [string, OptionPart][];
  placeholder?: string;
}) {
  const { query, setQuery } = useLiveSearch();
  const input = useRef<HTMLInputElement>(null);
  const live = { ...state, query };

  return (
    <div className="controls">
      <div className="search-row">
        <form
          className="search"
          role="search"
          action={basePath}
          onSubmit={(e) => {
            // Enter: gefiltert ist schon – nur die Tastatur schliessen, kein Neuladen.
            e.preventDefault();
            input.current?.blur();
          }}
        >
          <input
            ref={input}
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Suche"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Suche zurücksetzen"
              // Fokus bleibt im Feld (Tastatur bleibt offen).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              ✕
            </button>
          )}
        </form>
        <FilterPanel basePath={basePath} state={state} optionParts={optionParts} />
      </div>
      <nav className="segmented" aria-label="Gruppieren nach">
        {groupings.map((g) => (
          <Link
            key={g}
            // Neue Gruppierung: Typ zurücksetzen (Weintyp → Rot, sonst alle); Suche und Filter bleiben.
            href={listHref(basePath, live, { groupBy: g, open: [], type: null })}
            className={g === state.groupBy ? "segment active" : "segment"}
            aria-current={g === state.groupBy ? "page" : undefined}
            scroll={false}
          >
            {GROUP_BY_LABELS[g]}
          </Link>
        ))}
      </nav>
      {state.groupBy !== "typ" && <TypeChips basePath={basePath} state={state} counts={typeCounts} />}
    </div>
  );
}
