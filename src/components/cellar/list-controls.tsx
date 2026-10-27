import Link from "next/link";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";
import { TYPE_ORDER, type TypeFilter } from "@/lib/cellar/list-params";
import { WINE_TYPE_LABELS } from "@/lib/format";

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
