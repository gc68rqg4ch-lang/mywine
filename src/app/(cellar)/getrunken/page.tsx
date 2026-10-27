import type { Metadata } from "next";
import Link from "next/link";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getSession } from "@/lib/auth";
import { getLocationFilter, withLocation } from "@/lib/location";
import { formatBottleSize, formatDate, formatRating, wineTitle, zurichDate } from "@/lib/format";

export const metadata: Metadata = { title: "Getrunken" };

export default async function DrunkBottlesPage() {
  const { supabase } = await getSession();
  const { filter } = await getLocationFilter();

  const { data, error } = await withLocation(
    supabase
      .from("inventory_items")
      .select(
        "id, vintage_year, bottle_size_ml, personal_wine_rating, personal_vintage_rating, drunk_at, wine:wines(name, producer, region, country, type)",
      )
      .eq("status", "drunk"),
    filter,
  );

  if (error) throw error;

  // Neueste zuerst nach drunk_at (setzt die DB beim Austrinken). Importierte Zeilen
  // haben kein drunk_at und folgen danach alphabetisch.
  const rows = (data ?? [])
    .filter((row) => row.wine)
    .sort(
      (a, b) =>
        (b.drunk_at ? Date.parse(b.drunk_at) : 0) - (a.drunk_at ? Date.parse(a.drunk_at) : 0) ||
        a.wine!.producer.localeCompare(b.wine!.producer, "de-CH") ||
        a.wine!.name.localeCompare(b.wine!.name, "de-CH") ||
        (b.vintage_year ?? 0) - (a.vintage_year ?? 0),
    );

  return (
    <div className="stack-lg">
      <h1 className="page-title">Getrunken</h1>

      {rows.length === 0 ? (
        <p className="empty">Noch keine Flaschen ausgetrunken.</p>
      ) : (
        <ul className="list">
          {rows.map((row) => {
            const wine = row.wine!;
            const drunkOn = zurichDate(row.drunk_at);
            const wineRating = formatRating(row.personal_wine_rating);
            const vintageRating = formatRating(row.personal_vintage_rating);
            return (
              <li key={row.id}>
                <Link href={`/flasche/${row.id}`} className="item">
                  <WineTypeIcon type={wine.type} />
                  <div className="item-main">
                    <span className="item-producer">{wine.producer}</span>
                    <span className="item-title">
                      {wineTitle({ name: wine.name, vintage_year: row.vintage_year })}
                    </span>
                    <span className="item-meta">
                      {[
                        drunkOn ? `getrunken am ${formatDate(drunkOn)}` : null,
                        [wine.region, wine.country].filter(Boolean).join(", "),
                        formatBottleSize(row.bottle_size_ml),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  {(wineRating || vintageRating) && (
                    <span className="item-rating">
                      {wineRating && (
                        <span aria-label={`Wein: ${row.personal_wine_rating} von 5`}>
                          {wineRating}
                        </span>
                      )}
                      {vintageRating && (
                        <span
                          className="item-rating-sub"
                          aria-label={`Jahrgang: ${row.personal_vintage_rating} von 5`}
                        >
                          Jg. {vintageRating}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
