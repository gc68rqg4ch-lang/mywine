import Link from "next/link";
import { FilterPanel } from "@/components/cellar/filter-panel";
import { TypeChips, type TypeCount } from "@/components/cellar/type-tabs";
import type { FilterOptions } from "@/lib/cellar/filters";
import { listHref, listSearchParams, type ListState } from "@/lib/cellar/list-params";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";

/**
 * Suche mit Filter-Knopf, Gruppierung und – ausser bei „Weintyp“ – der Weintyp-Filter.
 * Alles läuft über die URL (Links und ein GET-Formular), damit „Zurück“ den Zustand behält.
 */
export function ListControls({
  basePath,
  state,
  groupings,
  typeCounts,
  options,
  placeholder = "Suche: Wein, Produzent, Region, Traube, Jahrgang …",
}: {
  basePath: string;
  state: ListState;
  groupings: GroupBy[];
  typeCounts: TypeCount[];
  options: FilterOptions;
  placeholder?: string;
}) {
  // Beim Suchen bleiben Gruppierung, Typ und Filter erhalten.
  const keep = [...listSearchParams({ ...state, query: "", open: [] }).entries()];

  return (
    <div className="controls">
      <div className="search-row">
        <form className="search" role="search" action={basePath}>
          {keep.map(([name, value], i) => (
            <input key={`${name}:${i}`} type="hidden" name={name} value={value} />
          ))}
          <input type="search" name="q" defaultValue={state.query} placeholder={placeholder} aria-label="Suche" />
          {state.query && (
            <Link href={listHref(basePath, state, { query: "", open: [] })} className="btn btn-ghost" aria-label="Suche zurücksetzen">
              ✕
            </Link>
          )}
        </form>
        <FilterPanel basePath={basePath} state={state} options={options} />
      </div>
      <nav className="segmented" aria-label="Gruppieren nach">
        {groupings.map((g) => (
          <Link
            key={g}
            // Neue Gruppierung: Typ zurücksetzen (Weintyp → Rot, sonst alle); Suche und Filter bleiben.
            href={listHref(basePath, state, { groupBy: g, open: [], type: null })}
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
