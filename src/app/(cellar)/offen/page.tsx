import type { Metadata } from "next";
import Link from "next/link";
import { FillGauge } from "@/components/fill-gauge";
import { TypeDot } from "@/components/type-dot";
import { getSession } from "@/lib/auth";
import { formatBottleSize, formatDaysSince, formatStorage, wineTitle } from "@/lib/format";

export const metadata: Metadata = { title: "Offene Flaschen" };

export default async function OpenBottlesPage({ searchParams }: PageProps<"/offen">) {
  const params = await searchParams;
  const { supabase } = await getSession();

  // Älteste offene Flaschen zuerst – die sollten als nächstes getrunken werden.
  const { data, error } = await supabase
    .from("cellar_overview")
    .select("*")
    .eq("status", "open")
    .order("date_opened", { ascending: true, nullsFirst: false })
    .order("producer");

  if (error) throw error;
  const rows = data ?? [];

  return (
    <div className="stack-lg">
      <h1 className="page-title">Offene Flaschen</h1>

      {params.ausgetrunken && (
        <p className="notice notice-ok" role="status">
          Flasche als ausgetrunken markiert. Zum Wohl!
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty">Gerade ist keine Flasche offen.</p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <li key={row.inventory_item_id}>
              <Link href={`/flasche/${row.inventory_item_id}`} className="item">
                <TypeDot type={row.type} />
                <div className="item-main">
                  <span className="item-producer">{row.producer}</span>
                  <span className="item-title">{wineTitle(row)}</span>
                  <span className="item-meta">
                    {[
                      formatDaysSince(row.date_opened),
                      formatBottleSize(row.bottle_size_ml),
                      formatStorage(row),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <FillGauge percent={row.fill_level_percent} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
