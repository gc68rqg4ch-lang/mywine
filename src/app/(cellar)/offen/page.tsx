import { loadWineNotes } from "@/lib/cellar/notes";
import type { Metadata } from "next";
import Link from "next/link";
import { ListView } from "@/components/cellar/list-view";
import { readListState } from "@/lib/cellar/list-params";
import { loadRatingsByWine } from "@/lib/cellar/load";
import { WineCard } from "@/components/cellar/wine-card";
import { FillGauge } from "@/components/fill-gauge";
import { getMemberSession } from "@/lib/auth";
import { BASE_GROUPINGS, currentYear, drinkBadges, matchesQuery, originLabel } from "@/lib/cellar/overview";
import { openTotals, toOpenEntry } from "@/lib/cellar/lists";
import { asWineType, formatBottleSize, formatDaysSince } from "@/lib/format";
import { loadLabelPhotos } from "@/lib/media/store";
import { wineHref } from "@/lib/cellar/wine-page";
import { loadGrapeNames } from "@/lib/grapes/store";
import { getLocationFilter, withLocation } from "@/lib/location";

export const metadata: Metadata = { title: "Offene Flaschen" };

export default async function OpenBottlesPage({ searchParams }: PageProps<"/offen">) {
  const params = await searchParams;
  const state = readListState(params, BASE_GROUPINGS);
  const { supabase } = await getMemberSession();
  const { filter } = await getLocationFilter();

  const [{ data, error }, withoutRoom] = await Promise.all([
    withLocation(
      supabase
        .from("cellar_overview")
        .select(
          "inventory_item_id, wine_id, name, producer, country, region, type, grapes, vintage_year, purchase_price, fill_level_percent, date_opened, bottle_size_ml, drink_from_year, drink_until_year, vendor_name",
        )
        .eq("status", "open"),
      filter,
    )
      // Älteste offene Flaschen zuerst – die sollten als nächstes getrunken werden.
      .order("date_opened", { ascending: true, nullsFirst: false })
      .order("producer"),
    filter
      ? supabase.from("cellar_overview").select("inventory_item_id", { count: "exact", head: true }).eq("status", "open").is("storage_room", null)
      : Promise.resolve({ count: 0 }),
  ]);
  if (error) throw error;

  const rows = (data ?? []).flatMap((r) =>
    r.inventory_item_id && r.wine_id && r.name && r.producer
      ? [{ ...r, inventory_item_id: r.inventory_item_id, wine_id: r.wine_id, name: r.name, producer: r.producer, type: asWineType(r.type) }]
      : [],
  );
  const grapes = await loadGrapeNames(supabase, rows.map((r) => ({ id: r.wine_id, grapes: r.grapes })));
  const entries = rows.map((r) => toOpenEntry(r, grapes.get(r.wine_id) ?? []));
  const notes = state.query ? await loadWineNotes(supabase, entries.map((e) => e.wine_id)) : null;
  const visible = state.query ? entries.filter((e) => matchesQuery(e, state.query, notes?.get(e.wine_id))) : entries;
  const thisYear = currentYear();
  const [ratings, photo] = await Promise.all([
    loadRatingsByWine(supabase, visible.map((e) => e.wine_id)),
    loadLabelPhotos(supabase, visible.map((e) => e.wine_id)),
  ]);
  const withRatings = visible.map((e) => ({ ...e, ratings: ratings.get(e.wine_id) ?? [] }));
  const totals = openTotals(entries);
  const hidden = withoutRoom.count ?? 0;

  return (
    <div className="stack-lg">
      <section className="tiles tiles-3" aria-label="Übersicht">
        <div className="tile">
          <h2 className="tile-title">Offen</h2>
          <p className="tile-big">
            {totals.count} <span>Fl.</span>
          </p>
          {hidden > 0 && (
            <p className="tile-line muted small">+{hidden} ohne Lagerort (nur unter „Alle“)</p>
          )}
        </div>

        {totals.longest ? (
          <Link href={wineHref(totals.longest.wine_id, totals.longest.vintages[0], { von: "offen" })} className="tile tile-link">
            <h2 className="tile-title">Am längsten offen</h2>
            <p className="tile-big">
              {totals.longest.days} <span>Tage</span>
            </p>
            <p className="tile-line">
              {totals.longest.name} {totals.longest.vintages[0] ?? "o. J."}
            </p>
          </Link>
        ) : (
          <div className="tile">
            <h2 className="tile-title">Am längsten offen</h2>
            <p className="tile-line muted">–</p>
          </div>
        )}

        <div className="tile">
          <h2 className="tile-title">Ø Füllstand</h2>
          <p className="tile-big">
            {totals.avgFill ?? "–"} <span>%</span>
          </p>
        </div>
      </section>

      <ListView
        basePath="/offen"
        state={state}
        groupings={BASE_GROUPINGS}
        entries={withRatings}
        year={thisYear}
        empty="Gerade ist keine Flasche offen."
        itemKey={({ wine }) => wine.itemId}
        renderItem={({ wine }) => (
          <WineCard
            href={wineHref(wine.wine_id, wine.vintages[0], { von: "offen" })}
            type={wine.type}
            producer={wine.producer}
            title={wine.name}
            meta={[
              String(wine.vintages[0] ?? "o. J."),
              formatDaysSince(wine.dateOpened),
              wine.bottleSizeMl && wine.bottleSizeMl !== 750 ? formatBottleSize(wine.bottleSizeMl) : null,
              originLabel(wine),
            ]}
            drink={drinkBadges(wine, wine.vintages, thisYear)}
            aside={<FillGauge percent={wine.fill} />}
            photo={photo(wine.wine_id, wine.vintages[0])}
          />
        )}
      />
    </div>
  );
}

