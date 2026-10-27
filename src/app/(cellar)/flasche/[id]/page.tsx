import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FillGauge } from "@/components/fill-gauge";
import { TypeDot } from "@/components/type-dot";
import { getSession } from "@/lib/auth";
import {
  STATUS_LABELS,
  formatBottleSize,
  formatBottles,
  formatDate,
  formatDaysSince,
  formatRating,
  formatStorage,
  todayIso,
  wineTitle,
  zurichDate,
  type InventoryStatus,
} from "@/lib/format";
import { OpenBottleControls, OpenBottleForm } from "./bottle-actions";
import { loadGrapeShares } from "@/lib/grapes/store";
import { currentScore, normalizeData } from "@/lib/tasting/sat";
import { GrapeCard } from "./grape-card";
import { RatingsCard, type PersonRating } from "./ratings-card";
import { PriceCard } from "./price-card";

// Server Actions dieser Seite (z. B. Nachrecherchieren mit Websuche) brauchen Zeit.
export const maxDuration = 300;

const BACK_LINKS: Record<InventoryStatus, { href: string; label: string }> = {
  sealed: { href: "/", label: "Bestand" },
  open: { href: "/offen", label: "Offene Flaschen" },
  drunk: { href: "/getrunken", label: "Getrunken" },
};

const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadItem(id: string) {
  if (!UUID_RE.test(id)) return null;
  const { supabase } = await getSession();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*, wine:wines(*), open:open_bottle_details(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function generateMetadata({ params }: PageProps<"/flasche/[id]">): Promise<Metadata> {
  const item = await loadItem((await params).id);
  return { title: item ? wineTitle({ name: item.wine?.name, vintage_year: item.vintage_year }) : "Flasche" };
}

/**
 * photo_urls enthält externe https-URLs oder Pfade im privaten Bucket wine-photos
 * (vom Telegram-Bot). Für Letztere signierte URLs erzeugen.
 */
async function resolvePhotoUrls(
  supabase: Awaited<ReturnType<typeof getSession>>["supabase"],
  entries: string[],
) {
  const external = entries.filter((e) => e.startsWith("https://"));
  const paths = entries.filter((e) => !/^[a-z]+:\/\//i.test(e));
  if (paths.length === 0) return external;
  const { data } = await supabase.storage.from("wine-photos").createSignedUrls(paths, 60 * 60);
  const signed = (data ?? []).flatMap((d) => (d.signedUrl ? [d.signedUrl] : []));
  return [...signed, ...external];
}

/** Neueste Bewertung je Person sowie Verkostungen für Wein + Jahrgang. */
async function loadRatingsAndTastings(
  supabase: Awaited<ReturnType<typeof getSession>>["supabase"],
  wineId: string,
  vintageYear: number | null,
) {
  const sameVintage = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(
    q: Q,
  ) => (vintageYear == null ? q.is("vintage_year", null) : q.eq("vintage_year", vintageYear));

  const [persons, latest, tastingRows] = await Promise.all([
    supabase.from("persons").select("id, name").order("sort_order").order("name"),
    sameVintage(supabase.from("latest_wine_ratings").select("person_id, rating, rated_at").eq("wine_id", wineId)),
    sameVintage(
      supabase
        .from("wine_tastings")
        .select("id, tasted_at, wine_style, quality_level, quality_points, readiness, sat, person:persons(name)")
        .eq("wine_id", wineId),
    ).order("tasted_at", { ascending: false }),
  ]);

  const ratings: PersonRating[] = (persons.data ?? []).map((p) => {
    const r = (latest.data ?? []).find((l) => l.person_id === p.id);
    return { personId: p.id, name: p.name, rating: r?.rating ?? null, ratedAt: r?.rated_at ?? null };
  });

  const tastings = (tastingRows.data ?? []).map((t) => ({
    ...t,
    person: t.person?.name ?? null,
    // Halbe Punkte stehen nur in sat, solange quality_points smallint ist.
    points: t.quality_points ?? currentScore(normalizeData(t.sat, t.tasted_at)),
  }));
  return { ratings, tastings };
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export default async function BottlePage({ params, searchParams }: PageProps<"/flasche/[id]">) {
  const { id } = await params;
  const { geoeffnet, verkostung } = await searchParams;
  const item = await loadItem(id);
  if (!item || !item.wine) notFound();

  const { wine, open } = item;
  const { supabase } = await getSession();
  const { data: siblings } = await supabase
    .from("cellar_overview")
    .select("inventory_item_id, vintage_year, status, quantity, bottle_size_ml, fill_level_percent")
    .eq("wine_id", wine.id)
    .in("status", ["sealed", "open"])
    .neq("inventory_item_id", item.id)
    .order("vintage_year", { nullsFirst: false });

  const photoUrls = await resolvePhotoUrls(supabase, item.photo_urls);
  const grapes = await loadGrapeShares(supabase, wine.id, item.vintage_year);
  const { ratings, tastings } = await loadRatingsAndTastings(supabase, wine.id, item.vintage_year);
  const back = BACK_LINKS[item.status];
  const drunkOn = item.status === "drunk" ? zurichDate(item.drunk_at) : null;

  return (
    <div className="stack-lg">
      <Link href={back.href} className="back">
        ← {back.label}
      </Link>

      {verkostung && (
        <p className="notice notice-ok" role="status">
          Verkostung gespeichert.
        </p>
      )}

      {geoeffnet && (
        <p className="notice notice-ok" role="status">
          Flasche geöffnet. Viel Genuss!
        </p>
      )}

      <header className="detail-header">
        <div className="stack-sm">
          <span className="item-producer">{wine.producer}</span>
          <h1 className="page-title">{wineTitle({ name: wine.name, vintage_year: item.vintage_year })}</h1>
          <div className="row muted">
            <TypeDot type={wine.type} withLabel />
            <span className={`status status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
            {item.status === "sealed" && <span>{formatBottles(item.quantity)}</span>}
          </div>
        </div>
        {item.status === "open" && <FillGauge percent={open?.fill_level_percent ?? null} size="lg" />}
      </header>

      <div className="detail-grid">
        <section className="card">
          <dl className="details">
            <Detail label="Land" value={wine.country} />
            <Detail label="Region" value={wine.region} />
            <Detail label="Appellation" value={wine.appellation} />
            <Detail
              label="Alkohol"
              value={wine.alcohol_content != null ? `${wine.alcohol_content.toLocaleString("de-CH")} %` : null}
            />
            <Detail label="Flaschengrösse" value={formatBottleSize(item.bottle_size_ml)} />
            <Detail label="Lagerort" value={formatStorage(item)} />
            <Detail label="Jahrgang" value={item.vintage_rating} />
            <Detail label="Jahrgangsnotiz" value={item.vintage_notes} />
            <Detail label="Bewertung Wein" value={formatRating(item.personal_wine_rating)} />
            <Detail label="Bewertung Jahrgang" value={formatRating(item.personal_vintage_rating)} />
            <Detail label="Getrunken" value={formatDate(drunkOn)} />
            {open && (
              <>
                <Detail
                  label="Geöffnet"
                  value={
                    open.date_opened
                      ? `${formatDate(open.date_opened)}${item.status === "open" ? ` (${formatDaysSince(open.date_opened)})` : ""}`
                      : null
                  }
                />
                <Detail label="Notiz" value={open.notes} />
              </>
            )}
          </dl>
          {photoUrls.length > 0 && (
            <div className="photos">
              {photoUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt={`Foto ${wine.name}`} loading="lazy" />
              ))}
            </div>
          )}
        </section>

        <div className="stack">
          <RatingsCard itemId={item.id} ratings={ratings} today={todayIso()} />
          <section className="card stack">
            <div className="row row-between">
              <h2 className="section-title">Verkostungen (WSET)</h2>
              <Link href={`/flasche/${item.id}/verkostung`} className="btn btn-sm btn-primary">
                Neue Verkostung
              </Link>
            </div>
            {tastings.length === 0 ? (
              <p className="muted">Noch keine Verkostung für diesen Jahrgang.</p>
            ) : (
              <ul className="tasting-list">
                {tastings.map((t) => (
                  <li key={t.id}>
                    <Link href={`/flasche/${item.id}/verkostung?t=${t.id}`}>
                      <strong>{formatDate(t.tasted_at)}</strong>
                      {t.person ? ` · ${t.person}` : ""}
                      <span className="item-meta">
                        {[
                          t.wine_style,
                          t.quality_level,
                          t.points != null ? `${t.points.toLocaleString("de-CH")} / 4 Punkte` : null,
                          t.readiness,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <GrapeCard
            // Neu mounten, wenn sich die gespeicherten Angaben ändern.
            key={JSON.stringify(grapes)}
            itemId={item.id}
            itemVintage={item.vintage_year}
            shares={grapes?.shares ?? wine.grapes.map((grape) => ({ grape, percent: null }))}
            sharesVintage={grapes?.vintageYear ?? null}
            sources={grapes?.sources ?? []}
          />
          <PriceCard
            itemId={item.id}
            purchasePrice={item.purchase_price}
            regularPrice={item.regular_price}
            currency={item.currency}
          />
          {item.status === "sealed" && item.quantity > 0 && (
            <OpenBottleForm itemId={item.id} quantity={item.quantity} today={todayIso()} />
          )}
          {item.status === "open" && (
            <OpenBottleControls itemId={item.id} fillLevel={open?.fill_level_percent ?? null} />
          )}
          {item.status === "drunk" && (
            <p className="card muted">
              {drunkOn
                ? `Diese Flasche wurde am ${formatDate(drunkOn)} ausgetrunken.`
                : "Diese Flasche ist ausgetrunken."}
            </p>
          )}

          {siblings && siblings.length > 0 && (
            <section className="card stack-sm">
              <h2 className="section-title">Weitere Flaschen dieses Weins</h2>
              <ul className="mini-list">
                {siblings.map((s) => (
                  <li key={s.inventory_item_id}>
                    <Link href={`/flasche/${s.inventory_item_id}`}>
                      {s.vintage_year ?? "o. J."} · {formatBottleSize(s.bottle_size_ml) ?? "–"} ·{" "}
                      {s.status === "open"
                        ? `offen, ${s.fill_level_percent ?? "–"} %`
                        : `${s.quantity}× ungeöffnet`}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
