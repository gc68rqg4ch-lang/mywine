import { loadWineNotes } from "@/lib/cellar/notes";
import type { Metadata } from "next";
import Link from "next/link";
import { ListView } from "@/components/cellar/list-view";
import { WineCard } from "@/components/cellar/wine-card";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getMemberSession } from "@/lib/auth";
import { withDrinkWindows } from "@/lib/cellar/filters";
import { readListState } from "@/lib/cellar/list-params";
import { loadDrinkWindows } from "@/lib/cellar/load";
import type { RatingRow } from "@/lib/cellar/lists";
import { TASTED_GROUPINGS, currentYear, formatVintages, originLabel } from "@/lib/cellar/overview";
import { buildTastedEntries, tastedTotals, type TastedEntry, type TastedWineInfo } from "@/lib/cellar/tasted";
import { wineHref } from "@/lib/cellar/wine-page";
import { asWineType, formatDate, formatStarNumber, todayIso } from "@/lib/format";
import { loadGrapeNames } from "@/lib/grapes/store";
import { loadLabelPhotos } from "@/lib/media/store";

export const metadata: Metadata = { title: "Verkostet" };

function ratingsText(e: TastedEntry) {
  const parts = [
    e.ratings.length ? `⭐ ${e.ratings.map((r) => `${r.person} ${formatStarNumber(r.rating)}`).join(" · ")}` : null,
    e.inStock > 0 ? `im Bestand: ${e.inStock}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Verkostet: Weine, die wir irgendwo probiert haben (Restaurant, Weingut, Messe …) –
 * unabhängig vom Bestand. Ein Wein bleibt hier, auch wenn er gekauft wird. Ohne Lagerort-Wahl.
 */
export default async function TastedPage({ searchParams }: PageProps<"/verkostet">) {
  const params = await searchParams;
  const state = readListState(params, TASTED_GROUPINGS);
  const { supabase } = await getMemberSession();
  const year = todayIso().slice(0, 4);

  const [encounters, stats, persons] = await Promise.all([
    supabase
      .from("wine_encounters")
      .select("id, wine_id, vintage_year, tasted_on, price, price_unit, currency, created_at, place:places(name)"),
    supabase.from("tasted_wines").select("wine_id, bottles_in_stock"),
    supabase.from("persons").select("name").order("sort_order"),
  ]);
  if (encounters.error) throw encounters.error;
  if (stats.error) throw stats.error;

  const wineIds = [...new Set((encounters.data ?? []).map((e) => e.wine_id))];
  const [wineRows, ratingRows] = await Promise.all([
    wineIds.length
      ? supabase.from("wines").select("id, name, producer, country, region, type, grapes, want_to_buy").in("id", wineIds)
      : Promise.resolve({ data: [], error: null }),
    wineIds.length
      ? supabase.from("latest_wine_ratings").select("wine_id, person_name, rating, rated_at").in("wine_id", wineIds)
      : Promise.resolve({ data: [] as RatingRow[], error: null }),
  ]);
  if (wineRows.error) throw wineRows.error;
  if (ratingRows.error) throw ratingRows.error;

  const wines = new Map<string, TastedWineInfo>((wineRows.data ?? []).map((w) => [w.id, { ...w, type: asWineType(w.type) }]));
  const grapes = await loadGrapeNames(supabase, (wineRows.data ?? []).map((w) => ({ id: w.id, grapes: w.grapes })));
  const ratingsByWine = new Map<string, RatingRow[]>();
  for (const r of ratingRows.data ?? []) {
    if (r.wine_id) ratingsByWine.set(r.wine_id, [...(ratingsByWine.get(r.wine_id) ?? []), r]);
  }
  const stock = new Map((stats.data ?? []).flatMap((s) => (s.wine_id ? [[s.wine_id, s.bottles_in_stock ?? 0] as const] : [])));

  const entries = buildTastedEntries(encounters.data ?? [], wines, grapes, ratingsByWine, stock, (persons.data ?? []).map((p) => p.name));
  // Notizen für die Suche (im Browser) gleich mit.
  const [windows, photo, notes] = await Promise.all([
    loadDrinkWindows(supabase, wineIds),
    loadLabelPhotos(supabase, entries.map((e) => e.wine_id)),
    loadWineNotes(supabase, entries.map((e) => e.wine_id)),
  ]);
  // Trinkfenster je Jahrgang für den Filter „Trinkreife“.
  const filterable = withDrinkWindows(entries, windows, (e) => e.wine_id);
  const totals = tastedTotals(entries, year);
  const href = (e: TastedEntry, vintages?: (number | null)[]) =>
    wineHref(e.wine_id, vintages?.length === 1 ? vintages[0] : e.latestVintage, { von: "verkostet" });

  return (
    <div className="stack-lg">
      <div className="row row-between">
        <h1 className="page-title">Verkostet</h1>
        <Link href="/verkostet/neu" className="btn btn-primary btn-sm">
          ＋ Verkostet erfassen
        </Link>
      </div>

      <section className="tiles tiles-3" aria-label="Übersicht">
        <div className="tile">
          <h2 className="tile-title">Verkostet {year}</h2>
          <p className="tile-big">
            {totals.thisYear} <span>×</span>
          </p>
          <p className="tile-line">{totals.thisYearWines === 1 ? "1 Wein" : `${totals.thisYearWines} Weine`}</p>
          <p className="tile-line muted small">{totals.total}× insgesamt</p>
        </div>

        <div className="tile">
          <h2 className="tile-title">🛒 Kaufen?</h2>
          {totals.toBuy.length === 0 && <p className="tile-line muted">Kein Merker gesetzt</p>}
          {totals.toBuy.slice(0, 3).map((e) => (
            <Link key={e.wine_id} href={href(e)} className="tile-line tile-open">
              <WineTypeIcon type={e.type} size={16} />
              <span className="tile-open-name">{e.name}</span>
            </Link>
          ))}
          {totals.toBuy.length > 3 && (
            <Link href="/verkostet?gruppe=kaufen" className="tile-line muted small">
              alle {totals.toBuy.length} anzeigen
            </Link>
          )}
        </div>

        <div className="tile">
          <h2 className="tile-title">Zuletzt verkostet</h2>
          {totals.recent.length === 0 && <p className="tile-line muted">–</p>}
          {totals.recent.map((e) => (
            <Link key={e.wine_id} href={href(e)} className="tile-line tile-open">
              <WineTypeIcon type={e.type} size={16} />
              <span className="tile-open-name">{e.name}</span>
              <span className="muted">{formatDate(e.lastTasted)}</span>
            </Link>
          ))}
        </div>
      </section>

      <ListView
        basePath="/verkostet"
        state={state}
        groupings={TASTED_GROUPINGS}
        entries={filterable}
        notes={(e) => notes.get(e.wine_id)}
        year={currentYear()}
        countMode="wines"
        countUnit="times"
        empty="Noch nichts verkostet – oben „Verkostet erfassen“."
        itemKey={({ wine }) => wine.wine_id}
        renderItem={({ wine, bottles, vintages }) => (
          <WineCard
            href={href(wine, vintages)}
            type={wine.type}
            producer={wine.producer}
            title={wine.name}
            meta={[
              formatVintages(vintages),
              `zuletzt ${formatDate(wine.lastTasted)}`,
              wine.lastPlace,
              originLabel(wine),
            ]}
            extra={ratingsText(wine)}
            aside={
              <span className="item-qty">
                <span title={bottles === 1 ? "1× verkostet" : `${bottles}× verkostet`}>
                  {bottles}
                  <span className="unit">×</span>
                </span>
                {wine.wantToBuy && (
                  <span className="item-open" title="Merker „Kaufen?“">
                    🛒
                  </span>
                )}
              </span>
            }
            photo={photo(wine.wine_id, vintages.length === 1 ? vintages[0] : wine.latestVintage)}
          />
        )}
      />
    </div>
  );
}
