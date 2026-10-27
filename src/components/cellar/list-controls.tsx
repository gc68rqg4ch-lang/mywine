import Link from "next/link";
import { GROUP_BY_LABELS, type GroupBy } from "@/lib/cellar/overview";

/** Suche und Gruppierung (als Links, damit alles über die URL läuft). */
export function ListControls({
  basePath,
  groupBy,
  groupings,
  query,
  placeholder = "Suche: Wein, Produzent, Region, Traube, Jahrgang …",
}: {
  basePath: string;
  groupBy: GroupBy;
  groupings: GroupBy[];
  query: string;
  placeholder?: string;
}) {
  const href = (g: GroupBy, q = query) => {
    const p = new URLSearchParams();
    if (g !== "typ") p.set("gruppe", g);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="controls">
      <form className="search" role="search" action={basePath}>
        {groupBy !== "typ" && <input type="hidden" name="gruppe" value={groupBy} />}
        <input type="search" name="q" defaultValue={query} placeholder={placeholder} aria-label="Suche" />
        {query && (
          <Link href={href(groupBy, "")} className="btn btn-ghost" aria-label="Suche zurücksetzen">
            ✕
          </Link>
        )}
      </form>
      <nav className="segmented" aria-label="Gruppieren nach">
        {groupings.map((g) => (
          <Link
            key={g}
            href={href(g)}
            className={g === groupBy ? "segment active" : "segment"}
            aria-current={g === groupBy ? "page" : undefined}
          >
            {GROUP_BY_LABELS[g]}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Suchtext und Gruppierung aus den searchParams. */
export function readListParams(params: Record<string, string | string[] | undefined>, groupings: GroupBy[]) {
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const gruppe = params.gruppe;
  const groupBy: GroupBy = typeof gruppe === "string" && (groupings as string[]).includes(gruppe) ? (gruppe as GroupBy) : "typ";
  return { query, groupBy };
}
