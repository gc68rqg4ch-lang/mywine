import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import type { LocationFilter } from "@/lib/cellar/overview";
import { getSession } from "@/lib/auth";

export const LOCATION_COOKIE = "mywine_lagerort";

export type StorageLocationOption = {
  key: string;
  label: string;
  house: string | null;
  room: string;
  bottles: number;
};

export function locationKey(house: string | null, room: string) {
  return `${house ?? ""}|${room}`;
}

/**
 * Lagerorte (aus der View storage_locations) und die gespeicherte Auswahl.
 * selected = null bedeutet „Alle“. Pro Request gecacht.
 */
export const getLocationFilter = cache(async () => {
  const { supabase } = await getSession();
  const { data } = await supabase.from("storage_locations").select("*");
  const rows = (data ?? []).filter((r): r is typeof r & { storage_room: string } => !!r.storage_room);
  const houses = new Set(rows.map((r) => r.storage_house ?? ""));
  const options: StorageLocationOption[] = rows
    .map((r) => ({
      key: locationKey(r.storage_house, r.storage_room),
      // Nur bei mehreren Häusern das Haus mit anzeigen.
      label: houses.size > 1 && r.storage_house ? `${r.storage_house} · ${r.storage_room}` : r.storage_room,
      house: r.storage_house,
      room: r.storage_room,
      bottles: (r.sealed_bottles ?? 0) + (r.open_bottles ?? 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));

  const stored = (await cookies()).get(LOCATION_COOKIE)?.value;
  const selected = options.find((o) => o.key === stored) ?? null;
  const filter: LocationFilter = selected ? { house: selected.house, room: selected.room } : null;
  return { options, selected, filter };
});

/** Filter auf Abfragen mit den Spalten storage_house/storage_room anwenden. */
export function withLocation<
  Q extends {
    eq: (column: "storage_room" | "storage_house", value: string) => Q;
  },
>(query: Q, filter: LocationFilter): Q {
  if (!filter) return query;
  const q = query.eq("storage_room", filter.room);
  return filter.house ? q.eq("storage_house", filter.house) : q;
}
