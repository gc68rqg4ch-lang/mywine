import Link from "next/link";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";
import { WINE_TYPE_LABELS, type WineType } from "@/lib/format";

/** Weintyp-Filter: ein Typ aus wine_type oder „unknown“ (ohne Typ). */
export type TypeFilter = WineType | "unknown";

const TYPE_ORDER: TypeFilter[] = ["red", "white", "rose", "sparkling", "sweet", "fortified", "orange", "unknown"];

export function typeOf(entry: { type: WineType | null }): TypeFilter {
  return entry.type ?? "unknown";
}

type ListState = { groupBy: GroupBy; query: string; type: TypeFilter | null };

/**
 * Suche, Gruppierung und – ausser bei „Weintyp“ – der Weintyp-Filter.
 * Alles läuft über die URL (Links und ein GET-Formular).
 */
export function ListControls({
  basePath,
  groupBy,
  groupings,
  query,
  type,
  types,
  placeholder = "Suche: Wein, Produzent, Region, Traube, Jahrgang …",
}: {
  basePath: string;
  groupBy: GroupBy;
  groupings: GroupBy[];
  query: string;
  /** Gewählter Typ (null = alle). */
  type: TypeFilter | null;
  /** Typen, die in der aktuellen Liste (nach Lagerort und Suche) vorkommen. */
  types: TypeFilter[];
  placeholder?: string;
}) {
  const href = (next: Partial<ListState>) => {
    const s: ListState = { groupBy, query, type, ...next };
    const p = new URLSearchParams();
    if (s.groupBy !== "typ") p.set("gruppe", s.groupBy);
    if (s.query) p.set("q", s.query);
    if (s.type && s.groupBy !== "typ") p.set("typ", s.type);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const shownTypes = TYPE_ORDER.filter((t) => types.includes(t) || t === type);

  return (
    <div className="controls">
      <form className="search" role="search" action={basePath}>
        {groupBy !== "typ" && <input type="hidden" name="gruppe" value={groupBy} />}
        {type && groupBy !== "typ" && <input type="hidden" name="typ" value={type} />}
        <input type="search" name="q" defaultValue={query} placeholder={placeholder} aria-label="Suche" />
        {query && (
          <Link href={href({ query: "" })} className="btn btn-ghost" aria-label="Suche zurücksetzen">
            ✕
          </Link>
        )}
      </form>
      <nav className="segmented" aria-label="Gruppieren nach">
        {groupings.map((g) => (
          <Link
            key={g}
            href={href({ groupBy: g })}
            className={g === groupBy ? "segment active" : "segment"}
            aria-current={g === groupBy ? "page" : undefined}
          >
            {GROUP_BY_LABELS[g]}
          </Link>
        ))}
      </nav>
      {groupBy !== "typ" && shownTypes.length > 1 && (
        <nav className="type-filter" aria-label="Weintyp">
          <Link href={href({ type: null })} className={type ? "chip" : "chip active"} aria-current={type ? undefined : "page"}>
            Alle
          </Link>
          {shownTypes.map((t) => (
            <Link
              key={t}
              href={href({ type: t })}
              className={t === type ? "chip active" : "chip"}
              aria-current={t === type ? "page" : undefined}
            >
              <WineTypeIcon type={t === "unknown" ? null : t} size={18} />
              {t === "unknown" ? "Unbekannt" : WINE_TYPE_LABELS[t]}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Suchtext, Gruppierung und Weintyp-Filter aus den searchParams. */
export function readListParams(params: Record<string, string | string[] | undefined>, groupings: GroupBy[]) {
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const gruppe = params.gruppe;
  const groupBy: GroupBy = typeof gruppe === "string" && (groupings as string[]).includes(gruppe) ? (gruppe as GroupBy) : "typ";
  const typ = params.typ;
  const type =
    groupBy !== "typ" && typeof typ === "string" && (TYPE_ORDER as string[]).includes(typ) ? (typ as TypeFilter) : null;
  return { query, groupBy, type };
}

/** Typen einer Liste und die Liste gefiltert nach dem gewählten Typ. */
export function applyTypeFilter<T extends { type: WineType | null }>(entries: T[], type: TypeFilter | null) {
  const types = [...new Set(entries.map(typeOf))];
  return { types, filtered: type ? entries.filter((e) => typeOf(e) === type) : entries };
}
