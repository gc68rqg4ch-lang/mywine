import type { Metadata } from "next";
import Link from "next/link";
import { GroupedList } from "@/components/cellar/grouped-list";
import { ListControls, applyTypeFilter, readListParams } from "@/components/cellar/list-controls";
import { BottleCount, WineCard } from "@/components/cellar/wine-card";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getMemberSession } from "@/lib/auth";
import {
  BASE_GROUPINGS,
  formatVintages,
  groupWines,
  matchesQuery,
  originLabel,
  type GroupBy,
} from "@/lib/cellar/overview";
import { buildDrunkEntries, drunkTotals, type DrunkBottle, type DrunkEntry, type RatingRow } from "@/lib/cellar/lists";
import { formatDate, formatStarNumber, todayIso } from "@/lib/format";
import { wineHref } from "@/lib/cellar/wine-page";
import { loadGrapeNames } from "@/lib/grapes/store";
import { getLocationFilter, withLocation } from "@/lib/location";

export const metadata: Metadata = { title: "Getrunken" };

const GROUPINGS: GroupBy[] = [...BASE_GROUPINGS, "getrunken"];

function ratingsText(e: DrunkEntry) {
  if (e.ratings.length) return `⭐ ${e.ratings.map((r) => `${r.person} ${formatStarNumber(r.rating)}`).join(" · ")}`;
  return e.legacyRating != null ? `⭐ ${formatStarNumber(e.legacyRating)} (alte Bewertung)` : null;
}

export default async function DrunkBottlesPage({ searchParams }: PageProps<"/getrunken">) {
  const params = await searchParams;
  const { query, groupBy, type } = readListParams(params, GROUPINGS);
  const { supabase } = await getMemberSession();
  const { filter } = await getLocationFilter();
  const year = todayIso().slice(0, 4);

  const [{ data, error }, withoutRoom, persons] = await Promise.all([
    withLocation(
      supabase
        .from("inventory_items")
        .select(
          "id, wine_id, vintage_year, quantity, purchase_price, drunk_at, personal_wine_rating, wine:wines(name, producer, country, region, type, grapes)",
        )
        .eq("status", "drunk"),
      filter,
    ),
    filter
      ? supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "drunk").is("storage_room", null)
      : Promise.resolve({ count: 0 }),
    supabase.from("persons").select("name").order("sort_order"),
  ]);
  if (error) throw error;

  const bottles: DrunkBottle[] = (data ?? []).flatMap((r) =>
    r.wine
      ? [
          {
            itemId: r.id,
            wine_id: r.wine_id,
            vintage_year: r.vintage_year,
            quantity: r.quantity,
            purchase_price: r.purchase_price,
            drunk_at: r.drunk_at,
            legacy_rating: r.personal_wine_rating,
            wine: { name: r.wine.name, producer: r.wine.producer, country: r.wine.country, region: r.wine.region, type: r.wine.type },
          },
        ]
      : [],
  );
  const wineIds = [...new Set(bottles.map((b) => b.wine_id))];
  const [grapes, ratingRows] = await Promise.all([
    loadGrapeNames(
      supabase,
      (data ?? []).map((r) => ({ id: r.wine_id, grapes: r.wine?.grapes ?? null })),
    ),
    wineIds.length
      ? supabase.from("latest_wine_ratings").select("wine_id, person_name, rating, rated_at").in("wine_id", wineIds)
      : Promise.resolve({ data: [] as RatingRow[], error: null }),
  ]);
  if (ratingRows.error) throw ratingRows.error;
  const ratingsByWine = new Map<string, RatingRow[]>();
  for (const r of ratingRows.data ?? []) {
    if (r.wine_id) ratingsByWine.set(r.wine_id, [...(ratingsByWine.get(r.wine_id) ?? []), r]);
  }

  const entries = buildDrunkEntries(bottles, grapes, ratingsByWine, (persons.data ?? []).map((p) => p.name));
  const visible = query ? entries.filter((e) => matchesQuery(e, query)) : entries;
  const { types, filtered } = applyTypeFilter(visible, type);
  const groups = groupWines(filtered, groupBy);
  const totals = drunkTotals(entries, year);
  const hidden = withoutRoom.count ?? 0;

  return (
    <div className="stack-lg">
      <section className="tiles tiles-3" aria-label="Übersicht">
        <div className="tile">
          <h2 className="tile-title">Getrunken {year}</h2>
          <p className="tile-big">
            {totals.thisYear} <span>Fl.</span>
          </p>
          <p className="tile-line">{totals.thisYearWines === 1 ? "1 Wein" : `${totals.thisYearWines} Weine`}</p>
          <p className="tile-line muted small">{entries.reduce((s, e) => s + e.bottles, 0)} Fl. insgesamt</p>
          {hidden > 0 && <p className="tile-line muted small">+{hidden} ohne Lagerort (nur unter „Alle“)</p>}
        </div>

        <div className="tile">
          <h2 className="tile-title">Lieblingsweine</h2>
          {totals.favorites.length === 0 && <p className="tile-line muted">Noch keine Bewertungen</p>}
          {totals.favorites.map((e) => (
            <Link key={e.wine_id} href={wineHref(e.wine_id, e.latestVintage, { von: "getrunken" })} className="tile-line tile-open">
              <WineTypeIcon type={e.type} size={16} />
              <span className="tile-open-name">{e.name}</span>
              <span className="muted">{formatStarNumber(Math.round(e.score! * 2) / 2)} ★</span>
            </Link>
          ))}
        </div>

        <div className="tile">
          <h2 className="tile-title">Zuletzt getrunken</h2>
          {totals.recent.length === 0 && <p className="tile-line muted">–</p>}
          {totals.recent.map((e) => (
            <Link key={e.wine_id} href={wineHref(e.wine_id, e.latestVintage, { von: "getrunken" })} className="tile-line tile-open">
              <WineTypeIcon type={e.type} size={16} />
              <span className="tile-open-name">{e.name}</span>
              <span className="muted">{formatDate(e.lastDrunk)}</span>
            </Link>
          ))}
        </div>
      </section>

      <ListControls basePath="/getrunken" groupBy={groupBy} groupings={GROUPINGS} query={query} type={type} types={types} />

      <GroupedList
        groups={groups}
        groupBy={groupBy}
        query={query}
        empty="Noch keine Flaschen ausgetrunken."
        itemKey={({ wine }) => wine.wine_id}
        renderItem={({ wine, bottles, vintages }) => (
          <WineCard
            href={wineHref(wine.wine_id, vintages.length === 1 ? vintages[0] : wine.latestVintage, { von: "getrunken" })}
            type={wine.type}
            producer={wine.producer}
            title={wine.name}
            meta={[
              formatVintages(vintages),
              wine.lastDrunk ? `zuletzt ${formatDate(wine.lastDrunk)}` : null,
              originLabel(wine),
            ]}
            extra={ratingsText(wine)}
            aside={<BottleCount bottles={bottles} />}
          />
        )}
      />
    </div>
  );
}
