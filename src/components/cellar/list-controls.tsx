"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FilterPanel } from "@/components/cellar/filter-panel";
import { useLiveSearch } from "@/components/cellar/live-search";
import { TypeChips, type TypeCount } from "@/components/cellar/type-tabs";
import type { OptionPart } from "@/lib/cellar/filters";
import { listHref, type ListState } from "@/lib/cellar/list-params";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";
import { hitCount, hitText, searchScrollTarget } from "@/lib/cellar/search";

/** Höhe der (angehefteten) Kopfzeile als CSS-Variable --header-h – darunter heftet die Suche an. */
function useHeaderHeight() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".header");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
}

/**
 * Suchzeile direkt unter die Kopfzeile scrollen – einmal beim Fokus (nicht bei jedem Buchstaben).
 * iOS/iPadOS: Öffnet sich danach die Tastatur (visualViewport ändert sich), einmal nachrichten,
 * damit die Zeile oben im sichtbaren Bereich steht und die Treffer darunter über der Tastatur.
 */
function scrollRowToTop(row: HTMLElement) {
  const align = () => {
    const header = document.querySelector<HTMLElement>(".header")?.offsetHeight ?? 0;
    const top = searchScrollTarget(row.getBoundingClientRect().top, window.scrollY, header, window.visualViewport?.offsetTop ?? 0);
    if (Math.abs(top - window.scrollY) > 2) window.scrollTo({ top, behavior: "smooth" });
  };
  align();
  const vv = window.visualViewport;
  if (!vv) return;
  const onResize = () => {
    vv.removeEventListener("resize", onResize);
    align();
  };
  vv.addEventListener("resize", onResize);
  // Kommt keine Tastatur (Desktop), nicht später unerwartet springen.
  window.setTimeout(() => vv.removeEventListener("resize", onResize), 1000);
}

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
  shownIds,
  placeholder = "Suche: Wein, Produzent, Region, Traube, Jahrgang …",
}: {
  basePath: string;
  state: ListState;
  groupings: GroupBy[];
  typeCounts: TypeCount[];
  optionParts: [string, OptionPart][];
  /** Einträge der Liste (nach Filtern und Typ) – für die Trefferzahl. */
  shownIds: string[];
  placeholder?: string;
}) {
  const { query, setQuery, visible } = useLiveSearch();
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const live = { ...state, query };
  const searching = query.trim() !== "";
  const pinned = searching || focused;
  useHeaderHeight();
  // Angeheftet: unten Platz lassen, damit die Suchzeile auch bei wenigen Treffern bzw. zugeklappten
  // Gruppen oben stehen kann und die Seite beim Tippen nicht springt (kürzere Liste).
  useEffect(() => {
    const host = row.current?.parentElement;
    if (!host) return;
    host.classList.toggle("search-room", pinned);
    return () => host.classList.remove("search-room");
  }, [pinned]);

  return (
    <>
      {/* Mit Suchbegriff (bzw. solange das Feld den Fokus hat) oben angeheftet. */}
      <div ref={row} className={pinned ? "search-row list-search is-pinned" : "search-row list-search"}>
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
            onFocus={() => {
              setFocused(true);
              if (!row.current) return;
              // Platz sofort schaffen (nicht erst nach dem Rendern), sonst ist die Seite zum Scrollen zu kurz.
              row.current.parentElement?.classList.add("search-room");
              scrollRowToTop(row.current);
            }}
            onBlur={() => setFocused(false)}
          />
          {searching && (
            <span className="search-count" aria-live="polite">
              {hitText(hitCount(shownIds, visible))}
            </span>
          )}
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
      <div className="controls">
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
    </>
  );
}
