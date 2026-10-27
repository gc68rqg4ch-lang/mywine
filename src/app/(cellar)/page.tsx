import type { Metadata } from "next";
import Link from "next/link";
import { TypeDot } from "@/components/type-dot";
import { getSession } from "@/lib/auth";
import type { Tables } from "@/lib/database.types";
import {
  WINE_TYPE_LABELS,
  formatBottleSize,
  formatMoney,
  formatStorage,
  wineTitle,
  type WineType,
} from "@/lib/format";

export const metadata: Metadata = { title: "Bestand" };

type Row = Tables<"cellar_overview">;

function matches(row: Row, query: string) {
  const haystack = [
    row.name,
    row.producer,
    row.country,
    row.region,
    row.appellation,
    row.vintage_year?.toString(),
    ...(row.grapes ?? []),
    formatStorage(row),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("de-CH");
  return query
    .toLocaleLowerCase("de-CH")
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function sumByCurrency(rows: Row[], value: (row: Row) => number | null) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const v = value(row);
    if (v == null) continue;
    const currency = row.currency ?? "CHF";
    totals.set(currency, (totals.get(currency) ?? 0) + v);
  }
  return totals;
}

function formatTotals(totals: Map<string, number>) {
  return (
    [...totals].map(([currency, v]) => formatMoney(v, currency, { whole: true })).join(" + ") ||
    "–"
  );
}

export default async function InventoryPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const typeFilter =
    typeof params.typ === "string" && params.typ in WINE_TYPE_LABELS
      ? (params.typ as WineType)
      : null;

  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("cellar_overview")
    .select("*")
    .eq("status", "sealed")
    .gt("quantity", 0)
    .order("producer")
    .order("name")
    .order("vintage_year", { nullsFirst: false });

  if (error) throw error;
  const all = data ?? [];

  const rows = all.filter(
    (row) => (!typeFilter || row.type === typeFilter) && (!query || matches(row, query)),
  );

  const bottles = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  const cellarValue = sumByCurrency(rows, (r) => r.stock_value);
  // stock_value_regular nimmt den Normalpreis, sonst den bezahlten Preis (View).
  const regularValue = sumByCurrency(rows, (r) => r.stock_value_regular);
  const presentTypes = (Object.keys(WINE_TYPE_LABELS) as WineType[]).filter((t) =>
    all.some((r) => r.type === t),
  );
  const filtered = Boolean(query || typeFilter);

  return (
    <div className="stack-lg">
      <section className="stats" aria-label="Übersicht">
        <div className="stat">
          <span className="stat-value">{bottles}</span>
          <span className="stat-label">Flaschen</span>
        </div>
        <div className="stat">
          <span className="stat-value">{rows.length}</span>
          <span className="stat-label">Positionen</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatTotals(cellarValue)}</span>
          <span className="stat-label">Kellerwert (bezahlt)</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatTotals(regularValue)}</span>
          <span className="stat-label">Normalwert</span>
        </div>
      </section>

      <form className="filters" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Suche: Wein, Produzent, Region, Traube …"
          aria-label="Suche"
        />
        <select name="typ" defaultValue={typeFilter ?? ""} aria-label="Weintyp">
          <option value="">Alle Typen</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>
              {WINE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn">
          Filtern
        </button>
        {filtered && (
          <Link href="/" className="btn btn-ghost">
            Zurücksetzen
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="empty">
          {filtered ? "Keine Weine passen zu diesem Filter." : "Keine ungeöffneten Flaschen im Keller."}
        </p>
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
                      [row.region, row.country].filter(Boolean).join(", "),
                      formatBottleSize(row.bottle_size_ml),
                      formatStorage(row),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <span className="item-qty" aria-label={`${row.quantity} Flaschen`}>
                  {row.quantity}×
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
