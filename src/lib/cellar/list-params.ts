// Listen-Parameter von Bestand, Offen und Getrunken (rein, ohne React): Suche, Gruppierung
// und Weintyp-Filter aus der URL sowie die Filterung selbst.

import type { GroupBy } from "./overview";
import type { WineType } from "@/lib/format";

/** Weintyp-Filter: ein Typ aus wine_type oder „unknown“ (ohne Typ). */
export type TypeFilter = WineType | "unknown";

export const TYPE_ORDER: TypeFilter[] = ["red", "white", "rose", "sparkling", "sweet", "fortified", "orange", "unknown"];

export function typeOf(entry: { type: WineType | null }): TypeFilter {
  return entry.type ?? "unknown";
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
