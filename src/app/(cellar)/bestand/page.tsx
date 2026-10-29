import { loadDrinkWindows } from "@/lib/cellar/load";
import { withDrinkWindows } from "@/lib/cellar/filters";
import { loadAllWineNotes } from "@/lib/cellar/notes";
import type { Metadata } from "next";
import Link from "next/link";
import { ListView } from "@/components/cellar/list-view";
import { readListState } from "@/lib/cellar/list-params";
import { loadRatingsByWine } from "@/lib/cellar/load";
import { BottleCount, WineCard } from "@/components/cellar/wine-card";
import { StockValue } from "@/components/cellar/stock-value";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getMemberSession } from "@/lib/auth";
import {
  BASE_GROUPINGS,
  DRINK_STATUS_LABELS,
  DRINK_STATUS_ORDER,
  buildCellarWines,
  cellarTotals,
  currentYear,
  drinkBadges,
  drinkCounts,
  drinkStatusHref,
  formatVintages,
  originLabel,
  toSummaryWine,
  toVintageRow,
  unitKey,
  type LocationFilter,
} from "@/lib/cellar/overview";
import { daysSince, formatMoney, todayIso } from "@/lib/format";
import { wineHref } from "@/lib/cellar/wine-page";
import { getLocationFilter, withLocation } from "@/lib/location";
import { newestVintage } from "@/lib/media/pick";
import { loadLabelPhotos } from "@/lib/media/store";
import { loadSpirits } from "@/lib/spirits/load";
import { inStockRow, openSpiritInfo, openWineRow, spiritMeta, spiritOpenNote, withSpiritTags } from "@/lib/spirits/tag";
import { KeepBadge } from "@/components/keep-badge";
import { keepStatus } from "@/lib/fortified/keep";
import { loadOpenKeep } from "@/lib/fortified/store";

export const metadata: Metadata = { title: "Bestand" };

const nonNull = <T,>(v: T | null): v is T => v != null;

/** ILIKE-Muster für storage_to ("Haus / Raum / …") im gewählten Lagerort. */
function storagePattern(filter: NonNullable<LocationFilter>) {
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  return filter.house ? `${esc(filter.house)} / ${esc(filter.room)}%` : `%${esc(filter.room)}%`;
}

export default async function InventoryPage({ searchParams }: PageProps<"/bestand">) {
  const params = await searchParams;
  const state = readListState(params, BASE_GROUPINGS);

  const [{ supabase }, { filter, selected }] = await Promise.all([getMemberSession(), getLocationFilter()]);
  const year = todayIso().slice(0, 4);
  const thisYear = currentYear();

  let purchasesQuery = supabase
    .from("inventory_events")
    .select("quantity, price")
    .eq("event_type", "purchased")
    .gte("occurred_at", `${year}-01-01T00:00:00+01:00`);
  if (filter) purchasesQuery = purchasesQuery.ilike("storage_to", storagePattern(filter));

  // Alles in einem Schritt: Bewertungen und Etiketten aller Weine gleich mit (statt danach).
  // Notizen für die Suche (im Browser) – parallel, ohne auf die Liste der Weine zu warten.
  const [summary, vintageRows, items, purchases, ratings, photo, windows, notes, spirits] = await Promise.all([
    supabase.from("cellar_wine_summary").select("wine_id, name, producer, country, region, type, grapes"),
    supabase.from("cellar_wines").select("*"),
    withLocation(
      supabase
        .from("cellar_overview")
        .select("inventory_item_id, wine_id, status, stock_value, stock_value_regular, date_opened, name, vintage_year, type, bottle_size_ml, vendor_name, fill_level_percent")
        .in("status", ["sealed", "open"]),
      filter,
    ),
    purchasesQuery,
    loadRatingsByWine(supabase, null),
    loadLabelPhotos(supabase, null),
    // Herkunft der Trinkfenster (Schätzungen mit „≈“).
    loadDrinkWindows(supabase, null),
    loadAllWineNotes(supabase),
    // Kategorien und Angaben der Spirituosen (vor der Migration leer).
    loadSpirits(supabase, null),
  ]);
  for (const r of [summary, vintageRows, items, purchases]) if (r.error) throw r.error;

  // Händler der ungeöffneten Flaschen je Wein, Jahrgang und Grösse (Filter „Händler“).
  const vendors = new Map<string, string[]>();
  for (const i of items.data ?? []) {
    if (!inStockRow(i) || !i.wine_id || !i.vendor_name) continue;
    const key = unitKey(i.wine_id, i.vintage_year, i.bottle_size_ml);
    vendors.set(key, [...new Set([...(vendors.get(key) ?? []), i.vendor_name])]);
  }
  const wines = withDrinkWindows(
    buildCellarWines(
      (summary.data ?? []).map(toSummaryWine).filter(nonNull),
      (vintageRows.data ?? []).map((r) => toVintageRow(r, thisYear)).filter(nonNull),
      filter,
      vendors,
    ),
    windows,
    (w) => w.wine_id,
  );
  const inStock = wines.filter((w) => w.sealed > 0);
  const entries = withSpiritTags(inStock, (w) => w.wine_id, spirits).map((w) => ({ ...w, ratings: ratings.get(w.wine_id) ?? [] }));

  const totals = cellarTotals(wines);
  const drink = drinkCounts(wines);
  // Bestandswert: eine offene Spirituose zählt wie eine volle.
  const sealedItems = (items.data ?? []).filter(inStockRow);
  const openSpirits = openSpiritInfo(items.data ?? []);
  // Liköre mit offener Flasche: „offen gut bis“.
  const keep = await loadOpenKeep(supabase, [...openSpirits.keys()]);
  const today = todayIso();
  const valuePaid = sealedItems.reduce((s, i) => s + (i.stock_value ?? 0), 0);
  const valueRegular = sealedItems.reduce((s, i) => s + (i.stock_value_regular ?? 0), 0);
  // Offen: nur Wein (offene Spirituosen bleiben im Bestand).
  const openItems = (items.data ?? [])
    .filter(openWineRow)
    .sort((a, b) => (a.date_opened ?? "9999").localeCompare(b.date_opened ?? "9999"));
  const bought = (purchases.data ?? []).reduce(
    (acc, e) => ({ bottles: acc.bottles + (e.quantity ?? 0), chf: acc.chf + (e.quantity ?? 0) * (e.price ?? 0) }),
    { bottles: 0, chf: 0 },
  );


  return (
    <div className="stack-lg">
      {selected && <p className="muted small">Lagerort: {selected.label}</p>}

      <section className="tiles" aria-label="Übersicht">
        <div className="tile">
          <h2 className="tile-title">Bestand</h2>
          <p className="tile-big">
            {totals.bottles} <span>Fl.</span>
          </p>
          <p className="tile-line">
            {totals.wines} Weine · {totals.vintages} Jahrgänge
          </p>
          <StockValue paid={valuePaid} regular={valueRegular} />
        </div>

        <Link href="/offen" className="tile tile-link">
          <h2 className="tile-title">Offene Flaschen</h2>
          <p className="tile-big">
            {openItems.length} <span>Fl.</span>
          </p>
          {openItems.slice(0, 3).map((o) => {
            const days = daysSince(o.date_opened);
            return (
              <p key={o.inventory_item_id} className="tile-line tile-open">
                <WineTypeIcon type={o.type} size={16} />
                <span className="tile-open-name">
                  {o.name} {o.vintage_year ?? ""}
                </span>
                <span className="muted">{days == null ? "–" : `${days} T.`}</span>
              </p>
            );
          })}
          {openItems.length === 0 && <p className="tile-line muted">Keine offen</p>}
        </Link>

        <div className="tile">
          <h2 className="tile-title">Käufe {year}</h2>
          <p className="tile-big">
            {bought.bottles} <span>Fl.</span>
          </p>
          <p className="tile-line">{formatMoney(bought.chf, "CHF", { whole: true })}</p>
          <p className="tile-line muted small">aus dem Journal</p>
        </div>

        <div className="tile">
          <h2 className="tile-title">Trinkreife</h2>
          <dl className="tile-dl">
            {DRINK_STATUS_ORDER.map((s) => (
              <div key={s} className={`drink drink-${s}`}>
                <dt>
                  <Link href={drinkStatusHref(s)} className="drink-link">
                    {DRINK_STATUS_LABELS[s]}
                  </Link>
                </dt>
                <dd>{drink[s]} Fl.</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <ListView
        basePath="/bestand"
        state={state}
        groupings={BASE_GROUPINGS}
        entries={entries}
        notes={(e) => notes.get(e.wine_id)}
        year={thisYear}
        spiritCategories={spirits.categories}
        empty="Keine ungeöffneten Flaschen hier."
        itemKey={({ wine }) => wine.wine_id}
        renderItem={({ wine, bottles, vintages }) => (
          <WineCard
            href={wineHref(wine.wine_id, vintages.length === 1 ? vintages[0] : undefined, { von: "bestand" })}
            type={wine.type}
            producer={wine.producer}
            title={wine.name}
            meta={[...spiritMeta(wine), formatVintages(vintages), originLabel(wine)]}
            photo={photo(wine.wine_id, newestVintage(vintages))}
            drink={drinkBadges(wine, vintages, thisYear)}
            extra={
              wine.type === "spirit" && keep.has(wine.wine_id) ? (
                <KeepBadge status={keepStatus(openSpirits.get(wine.wine_id)?.dateOpened, keep.get(wine.wine_id)?.days, today)} />
              ) : undefined
            }
            aside={
              <BottleCount
                bottles={bottles}
                note={
                  wine.type === "spirit"
                    ? spiritOpenNote(bottles, openSpirits.get(wine.wine_id))
                    : wine.open > 0 && ["typ", "land", "rebsorte"].includes(state.groupBy)
                      ? `+${wine.open} offen`
                      : null
                }
              />
            }
          />
        )}
      />
    </div>
  );
}
