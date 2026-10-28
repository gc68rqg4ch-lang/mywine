"use client";

import Link from "next/link";
import { useLiveSearch } from "@/components/cellar/live-search";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { listHref, type ListState, type TypeFilter } from "@/lib/cellar/list-params";
import { liveCount, type CountParts } from "@/lib/cellar/search";
import { WINE_TYPE_LABELS } from "@/lib/format";

/** Anzahl je Weintyp als Beiträge je Eintrag – live über die Treffer der Suche gezählt. */
export type TypeCount = { type: TypeFilter; parts: CountParts };

function useCounts(counts: TypeCount[]) {
  const { query, visible } = useLiveSearch();
  return { query, list: counts.map(({ type, parts }) => ({ type, count: liveCount(parts, visible) })) };
}

const label = (t: TypeFilter) => (t === "unknown" ? "Unbekannt" : WINE_TYPE_LABELS[t]);
const icon = (t: TypeFilter) => (t === "unknown" ? null : t);

/**
 * Gruppierung „Weintyp“: grosse Knöpfe statt aufklappbarer Zeilen; darunter direkt die Liste
 * des gewählten Typs. Alle sechs Typen immer sichtbar (leere blass, trotzdem antippbar),
 * „Unbekannt“ nur, wenn es solche Weine gibt.
 */
export function TypeTabs({
  basePath,
  state,
  counts,
  unit,
}: {
  basePath: string;
  state: ListState;
  counts: TypeCount[];
  /** Zahl als „3 Fl.“ bzw. „1 Wein“ */
  unit: "bottles" | "wines";
}) {
  const { query, list } = useCounts(counts);
  const live = { ...state, query };
  const text = (n: number) => (unit === "wines" ? (n === 1 ? "1 Wein" : `${n} Weine`) : `${n} Fl.`);
  return (
    <nav className="type-tabs" aria-label="Weintyp">
      {list.map(({ type, count }) => {
        const active = type === state.type;
        return (
          <Link
            key={type}
            href={listHref(basePath, live, { type, open: [] })}
            className={["type-tab", active ? "active" : "", count === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
            scroll={false}
          >
            <WineTypeIcon type={icon(type)} size={30} />
            <span className="type-tab-label">{label(type)}</span>
            <span className="type-tab-count">{text(count)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Weintyp-Filter in den anderen Gruppierungen: „Alle“ und immer die sechs Typen. */
export function TypeChips({ basePath, state, counts }: { basePath: string; state: ListState; counts: TypeCount[] }) {
  const { query, list } = useCounts(counts);
  const live = { ...state, query };
  return (
    <nav className="type-filter" aria-label="Weintyp">
      <Link
        href={listHref(basePath, live, { type: null, open: [] })}
        className={state.type ? "chip" : "chip active"}
        aria-current={state.type ? undefined : "page"}
        scroll={false}
      >
        Alle
      </Link>
      {list.map(({ type, count }) => (
        <Link
          key={type}
          href={listHref(basePath, live, { type, open: [] })}
          className={["chip", type === state.type ? "active" : "", count === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
          aria-current={type === state.type ? "page" : undefined}
          scroll={false}
        >
          <WineTypeIcon type={icon(type)} size={18} />
          {label(type)}
        </Link>
      ))}
    </nav>
  );
}
