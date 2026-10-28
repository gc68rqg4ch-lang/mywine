import Link from "next/link";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { listHref, type ListState, type TypeFilter } from "@/lib/cellar/list-params";
import { WINE_TYPE_LABELS } from "@/lib/format";

export type TypeCount = { type: TypeFilter; count: number };

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
  /** „3 Fl.“ bzw. „1 Wein“ */
  unit: (n: number) => string;
}) {
  return (
    <nav className="type-tabs" aria-label="Weintyp">
      {counts.map(({ type, count }) => {
        const active = type === state.type;
        return (
          <Link
            key={type}
            href={listHref(basePath, state, { type, open: [] })}
            className={["type-tab", active ? "active" : "", count === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
            aria-current={active ? "page" : undefined}
            scroll={false}
          >
            <WineTypeIcon type={icon(type)} size={30} />
            <span className="type-tab-label">{label(type)}</span>
            <span className="type-tab-count">{unit(count)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Weintyp-Filter in den anderen Gruppierungen: „Alle“ und immer die sechs Typen. */
export function TypeChips({ basePath, state, counts }: { basePath: string; state: ListState; counts: TypeCount[] }) {
  return (
    <nav className="type-filter" aria-label="Weintyp">
      <Link
        href={listHref(basePath, state, { type: null, open: [] })}
        className={state.type ? "chip" : "chip active"}
        aria-current={state.type ? undefined : "page"}
        scroll={false}
      >
        Alle
      </Link>
      {counts.map(({ type, count }) => (
        <Link
          key={type}
          href={listHref(basePath, state, { type, open: [] })}
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
