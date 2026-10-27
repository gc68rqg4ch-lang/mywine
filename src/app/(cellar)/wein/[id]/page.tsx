import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HalfStars } from "@/components/half-stars";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getSession } from "@/lib/auth";
import {
  DRINK_STATUS_LABELS,
  countryFlag,
  toVintageRow,
  type LocationCount,
  type VintageRow,
} from "@/lib/cellar/overview";
import { STATUS_LABELS, formatBottleSize, formatMoney, formatStorage } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nonNull = <T,>(v: T | null): v is T => v != null;

async function loadWine(id: string) {
  if (!UUID_RE.test(id)) return null;
  const { supabase } = await getSession();
  const { data } = await supabase.from("wines").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/wein/[id]">): Promise<Metadata> {
  const wine = await loadWine((await params).id);
  return { title: wine ? wine.name : "Wein" };
}

function drinkWindow(row: VintageRow) {
  const { drink_from_year: from, drink_until_year: until } = row;
  if (from && until) return `${from}–${until}`;
  if (from) return `ab ${from}`;
  if (until) return `bis ${until}`;
  return null;
}

export default async function WinePage({ params }: PageProps<"/wein/[id]">) {
  const { id } = await params;
  const wine = await loadWine(id);
  if (!wine) notFound();

  const { supabase } = await getSession();
  const [vintages, ratings, positions, grapes] = await Promise.all([
    supabase.from("cellar_wines").select("*").eq("wine_id", wine.id),
    supabase.from("latest_wine_ratings").select("vintage_year, person_name, rating").eq("wine_id", wine.id),
    supabase
      .from("cellar_overview")
      .select(
        "inventory_item_id, vintage_year, status, quantity, bottle_size_ml, storage_house, storage_room, storage_compartment, storage_location, fill_level_percent",
      )
      .eq("wine_id", wine.id)
      .in("status", ["sealed", "open"])
      .order("vintage_year", { nullsFirst: false }),
    loadGrapeShares(supabase, wine.id, null),
  ]);

  const rows = (vintages.data ?? [])
    .map(toVintageRow)
    .filter(nonNull)
    .sort((a, b) => (a.vintage_year ?? 9999) - (b.vintage_year ?? 9999) || (a.bottle_size_ml ?? 0) - (b.bottle_size_ml ?? 0));
  const count = (r: VintageRow) =>
    r.locations.reduce((acc, l) => ({ sealed: acc.sealed + l.sealed, open: acc.open + l.open }), { sealed: 0, open: 0 });

  // Nach Lagerort über alle Jahrgänge zusammenfassen.
  const byLocation = new Map<string, LocationCount>();
  for (const r of rows) {
    for (const l of r.locations) {
      const key = `${l.storage_house ?? ""}|${l.storage_room ?? ""}`;
      const entry = byLocation.get(key) ?? { ...l, sealed: 0, open: 0 };
      entry.sealed += l.sealed;
      entry.open += l.open;
      byLocation.set(key, entry);
    }
  }

  const totalSealed = rows.reduce((s, r) => s + count(r).sealed, 0);
  const totalOpen = rows.reduce((s, r) => s + count(r).open, 0);
  const grapeText = grapes ? formatShares(grapes.shares) : wine.grapes.join(", ");
  const flag = countryFlag(wine.country);

  return (
    <div className="stack-lg">
      <Link href="/" className="back">
        ← Bestand
      </Link>

      <header className="detail-header">
        <div className="stack-sm">
          <span className="item-producer">{wine.producer}</span>
          <h1 className="page-title">{wine.name}</h1>
          <div className="row muted">
            <WineTypeIcon type={wine.type} withLabel />
            <span>
              {flag ? `${flag} ` : ""}
              {[wine.region, wine.country].filter(Boolean).join(", ") || "Herkunft unbekannt"}
            </span>
          </div>
          {wine.appellation && <span className="muted">{wine.appellation}</span>}
          {grapeText && <span className="muted">🍇 {grapeText}</span>}
        </div>
        <div className="detail-total">
          <span className="tile-big">
            {totalSealed} <span>Fl.</span>
          </span>
          {totalOpen > 0 && <span className="muted">+{totalOpen} offen</span>}
        </div>
      </header>

      <section className="card stack">
        <h2 className="section-title">Nach Jahrgang</h2>
        {rows.length === 0 ? (
          <p className="muted">Keine Flaschen im Keller.</p>
        ) : (
          <div className="vintage-table" role="table" aria-label="Jahrgänge">
            <div className="vintage-row vintage-head" role="row">
              <span role="columnheader">Jahrgang</span>
              <span role="columnheader">Flaschen</span>
              <span role="columnheader">Ø Preis</span>
              <span role="columnheader">Preisklasse</span>
              <span role="columnheader">Trinkreife</span>
              <span role="columnheader">Bewertungen</span>
            </div>
            {rows.map((r) => {
              const c = count(r);
              const rated = (ratings.data ?? []).filter((x) => x.vintage_year === r.vintage_year && x.rating != null);
              const window = drinkWindow(r);
              return (
                <div key={`${r.vintage_year}-${r.bottle_size_ml}`} className="vintage-row" role="row">
                  <span role="cell" data-label="Jahrgang" className="vintage-year">
                    {r.vintage_year ?? "o. J."}
                    {r.bottle_size_ml && r.bottle_size_ml !== 750 && (
                      <span className="muted small"> · {formatBottleSize(r.bottle_size_ml)}</span>
                    )}
                  </span>
                  <span role="cell" data-label="Flaschen">
                    {c.sealed}
                    {c.open > 0 && <span className="muted small"> +{c.open} offen</span>}
                  </span>
                  <span role="cell" data-label="Ø Preis">
                    {formatMoney(r.avg_price, "CHF") ?? "–"}
                  </span>
                  <span role="cell" data-label="Preisklasse">
                    {r.price_class ? `${r.price_class} CHF` : "–"}
                  </span>
                  <span role="cell" data-label="Trinkreife">
                    <span className={`drink-badge drink-${r.drink_status}`}>{DRINK_STATUS_LABELS[r.drink_status]}</span>
                    {window && <span className="muted small"> {window}</span>}
                  </span>
                  <span role="cell" data-label="Bewertungen" className="vintage-ratings">
                    {rated.length === 0
                      ? "–"
                      : rated.map((x) => (
                          <span key={x.person_name} className="vintage-rating">
                            <span className="small">{x.person_name}</span>
                            <HalfStars value={x.rating} label={`Bewertung ${x.person_name}`} />
                          </span>
                        ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="card stack">
          <h2 className="section-title">Nach Lagerort</h2>
          <ul className="mini-list">
            {[...byLocation.values()]
              .filter((l) => l.sealed + l.open > 0)
              .map((l) => (
                <li key={`${l.storage_house}|${l.storage_room}`} className="row row-between">
                  <span>{formatStorage(l) ?? "ohne Lagerort"}</span>
                  <span>
                    {l.sealed} Fl.{l.open > 0 && <span className="muted"> +{l.open} offen</span>}
                  </span>
                </li>
              ))}
          </ul>
        </section>

        <section className="card stack">
          <h2 className="section-title">Flaschen</h2>
          <p className="muted small">Öffnen, Preise, Bewertungen und Verkostungen auf der jeweiligen Flasche.</p>
          <ul className="mini-list">
            {(positions.data ?? []).map((p) => (
              <li key={p.inventory_item_id}>
                <Link href={`/flasche/${p.inventory_item_id}`}>
                  {p.vintage_year ?? "o. J."} · {p.status === "open" ? `offen (${p.fill_level_percent ?? "–"} %)` : `${p.quantity}× ${STATUS_LABELS.sealed.toLowerCase()}`}
                  {" · "}
                  {formatStorage(p) ?? "ohne Lagerort"}
                  {p.bottle_size_ml && p.bottle_size_ml !== 750 ? ` · ${formatBottleSize(p.bottle_size_ml)}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
