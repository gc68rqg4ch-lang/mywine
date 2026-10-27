import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { viewerPhoto } from "@/components/cellar/wine-card";
import { PhotoGallery } from "@/components/photo-viewer";
import { ResearchSuggestions } from "@/components/research-suggestions";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getMemberSession } from "@/lib/auth";
import { DRINK_STATUS_LABELS, countryFlag } from "@/lib/cellar/overview";
import {
  anchorItem,
  drinkStatus,
  drinkWindowLabel,
  parseVintageParam,
  pickVintage,
  vintageOptions,
  wineHref,
} from "@/lib/cellar/wine-page";
import {
  formatBottleSize,
  formatDate,
  formatDaysSince,
  formatRating,
  formatStarNumber,
  todayIso,
  zurichDate,
  type InventoryStatus,
} from "@/lib/format";
import { loadGrapeShares } from "@/lib/grapes/store";
import { loadDocuments } from "@/lib/media/documents";
import { loadPendingSuggestions } from "@/lib/research/suggestions";
import { loadVintagePhotos } from "@/lib/media/store";
import { currentScore, normalizeData } from "@/lib/tasting/sat";
import { OpenBottleControls, OpenBottleForm, type Charge } from "./bottle-actions";
import { WineDocuments } from "./documents";
import { BatchEditor, VintageEditForm, WineEditForm } from "./edit-sections";
import { GrapeSection } from "./grape-card";
import { WinePhotos } from "./photos";
import { PriceLine, type PriceInfo } from "./price-card";
import { PersonRatings, type PersonRating } from "./ratings-card";

// Server Actions dieser Seite (z. B. Nachrecherchieren mit Websuche) brauchen Zeit.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BACK_LINKS: Record<string, { href: string; label: string }> = {
  bestand: { href: "/", label: "Bestand" },
  offen: { href: "/offen", label: "Offen" },
  getrunken: { href: "/getrunken", label: "Getrunken" },
};

type Supabase = Awaited<ReturnType<typeof getMemberSession>>["supabase"];

async function loadWine(id: string) {
  if (!UUID_RE.test(id)) return null;
  const { supabase } = await getMemberSession();
  const { data } = await supabase.from("wines").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/wein/[id]">): Promise<Metadata> {
  const wine = await loadWine((await params).id);
  return { title: wine ? wine.name : "Wein" };
}

/** Alle Flaschen des Weins (ungeöffnet, offen, getrunken). */
async function loadItems(supabase: Supabase, wineId: string) {
  const { data, error } = await supabase
    .from("cellar_overview")
    .select(
      "inventory_item_id, vintage_year, status, quantity, bottle_size_ml, storage_house, storage_room, purchase_price, regular_price, currency, purchased_at, vendor_name, is_gift, fill_level_percent, date_opened, drunk_at, personal_wine_rating, vintage_rating",
    )
    .eq("wine_id", wineId);
  if (error) throw error;
  return (data ?? []).flatMap((r) =>
    r.inventory_item_id && r.status
      ? [{ ...r, inventory_item_id: r.inventory_item_id, status: r.status as InventoryStatus, quantity: r.quantity ?? 0 }]
      : [],
  );
}

/** Neueste Bewertung je Person sowie Verkostungen für Wein + Jahrgang. */
async function loadRatingsAndTastings(supabase: Supabase, wineId: string, vintageYear: number | null) {
  const sameVintage = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(
    q: Q,
  ) => (vintageYear == null ? q.is("vintage_year", null) : q.eq("vintage_year", vintageYear));

  const [persons, latest, tastingRows, vintage] = await Promise.all([
    supabase.from("persons").select("id, name").order("sort_order").order("name"),
    sameVintage(supabase.from("latest_wine_ratings").select("person_id, rating, rated_at").eq("wine_id", wineId)),
    sameVintage(
      supabase
        .from("wine_tastings")
        .select("id, inventory_item_id, tasted_at, quality_level, quality_points, readiness, sat, person:persons(name)")
        .eq("wine_id", wineId),
    ).order("tasted_at", { ascending: false }),
    sameVintage(
      supabase.from("wine_vintages").select("drink_from_year, drink_until_year, vintage_rating, notes").eq("wine_id", wineId),
    ).maybeSingle(),
  ]);

  const ratings: PersonRating[] = (persons.data ?? []).map((p) => {
    const r = (latest.data ?? []).find((l) => l.person_id === p.id);
    return { personId: p.id, name: p.name, rating: r?.rating ?? null, ratedAt: r?.rated_at ?? null };
  });
  const tastings = (tastingRows.data ?? []).map((t) => ({
    ...t,
    person: t.person?.name ?? null,
    // Fallback für Verkostungen ohne Spaltenwert: Summe aus dem Formular (sat).
    points: t.quality_points ?? currentScore(normalizeData(t.sat, t.tasted_at)),
  }));
  return { ratings, tastings, vintage: vintage.data };
}

async function loadVendorNames(supabase: Supabase) {
  const { data } = await supabase.from("vendors").select("name").eq("archived", false).order("name");
  return (data ?? []).map((v) => v.name);
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

const sizeSuffix = (ml: number | null) => (ml && ml !== 750 ? ` · ${formatBottleSize(ml)}` : "");

export default async function WinePage({ params, searchParams }: PageProps<"/wein/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const wine = await loadWine(id);
  if (!wine) notFound();

  const { supabase, person } = await getMemberSession();
  const today = todayIso();
  const items = await loadItems(supabase, wine.id);
  const options = vintageOptions(items);
  const year = pickVintage(options, parseVintageParam(query.jahrgang), items);
  const inVintage = items.filter((i) => i.vintage_year === year);
  const anchor = anchorItem(inVintage);

  // Bearbeiten-Modus (?bearbeiten=1): Formulare statt Anzeige, alle über das gemeinsame Modul.
  const editing = query.bearbeiten === "1";
  const [{ ratings, tastings, vintage }, grapes, photos, vendors, documents] = await Promise.all([
    loadRatingsAndTastings(supabase, wine.id, year),
    loadGrapeShares(supabase, wine.id, year),
    loadVintagePhotos(supabase, wine.id, year, inVintage.map((i) => i.inventory_item_id)),
    editing ? loadVendorNames(supabase) : Promise.resolve([] as string[]),
    loadDocuments(supabase, wine.id, year),
  ]);
  const suggestions = await loadPendingSuggestions(supabase, { wineId: wine.id, year }).catch((error) => {
    console.error("loading suggestions failed", error);
    return [];
  });

  const sealed = inVintage.filter((i) => i.status === "sealed" && i.quantity > 0);
  const open = inVintage.filter((i) => i.status === "open");
  const drunk = inVintage
    .filter((i) => i.status === "drunk")
    .sort((a, b) => (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""));
  const sealedCount = sealed.reduce((s, i) => s + i.quantity, 0);
  const place = (i: { storage_room: string | null }) => i.storage_room ?? "ohne Lagerort";
  const priceOf = (i: (typeof inVintage)[number]): PriceInfo => ({
    itemId: i.inventory_item_id,
    purchasePrice: i.purchase_price,
    regularPrice: i.regular_price,
    currency: i.currency,
  });
  const charges: Charge[] = sealed.map((i) => ({
    itemId: i.inventory_item_id,
    label: `${place(i)} · ${i.quantity} Fl.${sizeSuffix(i.bottle_size_ml)}`,
    price: priceOf(i),
  }));

  const status = drinkStatus(vintage?.drink_from_year ?? null, vintage?.drink_until_year ?? null, Number(today.slice(0, 4)));
  const drinkWindow = drinkWindowLabel(vintage?.drink_from_year ?? null, vintage?.drink_until_year ?? null);
  const latestReadiness = tastings.find((t) => t.readiness)?.readiness ?? null;
  const flag = countryFlag(wine.country);
  const sizes = [...new Set(inVintage.map((i) => i.bottle_size_ml ?? 750))].map((ml) => formatBottleSize(ml)).join(", ");
  const legacyRating = inVintage.map((i) => i.personal_wine_rating).find((r) => r != null) ?? null;
  const back = BACK_LINKS[typeof query.von === "string" ? query.von : ""] ?? BACK_LINKS.bestand;
  const yearLabel = year ?? "o. J.";
  const tastingItem = (itemId: string | null) => itemId ?? anchor?.inventory_item_id;

  const von = typeof query.von === "string" ? { von: query.von } : undefined;
  const editHref = wineHref(wine.id, year, { ...von, bearbeiten: "1" });
  const viewHref = wineHref(wine.id, year, von);

  // Bearbeiten: je Charge bzw. Flasche ein Formular (ungeöffnet, offen, getrunken).
  const batchColumn = (
    <div className="wine-col wine-col-open">
      {[...sealed, ...open, ...drunk].map((b) => (
        <BatchEditor key={b.inventory_item_id} batch={b} vendors={vendors} />
      ))}
      {inVintage.length === 0 && (
        <section className="card">
          <p className="muted">Keine Flaschen dieses Jahrgangs.</p>
        </section>
      )}
    </div>
  );

  // Spalte 1: Flasche öffnen (Chargen mit Preisen), offene und getrunkene Flaschen.
  const openColumn = (
    <div className="wine-col wine-col-open">
      {/* Offene Flaschen zuerst – die trinkt man als Nächstes. */}
      {open.length > 0 && (
        <section className="card stack">
          <h2 className="section-title">Offen</h2>
          {open.map((o) => (
            <OpenBottleControls
              key={o.inventory_item_id}
              bottle={{
                itemId: o.inventory_item_id,
                fillLevel: o.fill_level_percent,
                price: priceOf(o),
                label: [
                  o.date_opened ? `Geöffnet am ${formatDate(o.date_opened)} (${formatDaysSince(o.date_opened)})` : "Offen",
                  place(o),
                  o.bottle_size_ml && o.bottle_size_ml !== 750 ? formatBottleSize(o.bottle_size_ml) : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }}
            />
          ))}
        </section>
      )}
      {charges.length > 0 && (
        <section className="card stack">
          <h2 className="section-title">Flasche öffnen</h2>
          <OpenBottleForm charges={charges} today={today} />
        </section>
      )}
      {drunk.length > 0 && (
        <section className="card stack">
          <h2 className="section-title">Getrunken</h2>
          <ul className="bottle-list">
            {drunk.map((d) => (
              <li key={d.inventory_item_id} className="stack-sm">
                <span className="row row-between">
                  <span>{d.drunk_at ? formatDate(zurichDate(d.drunk_at)) : "ohne Datum"}</span>
                  {d.personal_wine_rating != null && (
                    <span className="muted">{formatStarNumber(d.personal_wine_rating)} ★</span>
                  )}
                </span>
                <PriceLine {...priceOf(d)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {charges.length === 0 && open.length === 0 && drunk.length === 0 && (
        <section className="card">
          <p className="muted">Keine Flaschen dieses Jahrgangs.</p>
        </section>
      )}
    </div>
  );

  // Spalte 2: Zum Wein – Stammdaten, Rebsorten, Trinkreife.
  const wineColumn = (
    <div className="wine-col wine-col-wine">
      <section className="card stack">
        <h2 className="section-title">Zum Wein</h2>
        {suggestions.length > 0 && <ResearchSuggestions suggestions={suggestions} />}
        {editing ? (
          <WineEditForm wine={wine} />
        ) : (
          <dl className="details">
            <Detail label="Typ" value={<WineTypeIcon type={wine.type} withLabel />} />
            <Detail label="Land" value={wine.country ? `${flag ? `${flag} ` : ""}${wine.country}` : null} />
            <Detail label="Region" value={wine.region} />
            <Detail label="Appellation" value={wine.appellation} />
            <Detail
              label="Alkohol"
              value={wine.alcohol_content != null ? `${wine.alcohol_content.toLocaleString("de-CH")} %` : null}
            />
            <Detail label="Flasche" value={sizes} />
            <Detail label="Jahrgang" value={vintage?.vintage_rating ?? inVintage.find((i) => i.vintage_rating)?.vintage_rating} />
            <Detail label="Notiz" value={vintage?.notes} />
          </dl>
        )}
        {editing && (
          <div className="stack section-divider">
            <h3 className="subsection-title">Jahrgang & Trinkfenster</h3>
            <VintageEditForm
              key={`${year}:${vintage?.drink_from_year}:${vintage?.drink_until_year}`}
              wineId={wine.id}
              year={year}
              otherYears={options.map((o) => o.year).filter((y) => y !== year)}
              drinkFrom={vintage?.drink_from_year ?? null}
              drinkUntil={vintage?.drink_until_year ?? null}
            />
          </div>
        )}
        <div className="stack section-divider">
          <h3 className="subsection-title">Fotos</h3>
          {editing ? (
            <WinePhotos
              // Neu mounten, wenn sich Jahrgang oder Fotos ändern (vorgeschlagene Art passt dann wieder).
              key={`${year}:${photos.length}`}
              wineId={wine.id}
              vintageYear={year}
              itemId={anchor?.inventory_item_id ?? null}
              photos={photos.map(viewerPhoto)}
              alt={`${wine.name} ${yearLabel}`}
            />
          ) : photos.length ? (
            <PhotoGallery photos={photos.map(viewerPhoto)} alt={`${wine.name} ${yearLabel}`} />
          ) : (
            <p className="muted small">Noch keine Fotos – unter ✏️ Bearbeiten hinzufügen.</p>
          )}
        </div>
        {(editing || documents.length > 0) && (
          <div className="stack section-divider">
            <h3 className="subsection-title">Dokumente</h3>
            <WineDocuments
              key={`${year}:${documents.length}`}
              docs={documents}
              editing={editing}
              wineId={wine.id}
              vintageYear={year}
            />
          </div>
        )}
        {anchor && (
          <div className="section-divider">
            <GrapeSection
              wineId={wine.id}
              // Neu mounten, wenn sich Jahrgang oder gespeicherte Angaben ändern.
              key={JSON.stringify([year, grapes])}
              itemId={anchor.inventory_item_id}
              itemVintage={year}
              shares={grapes?.shares ?? wine.grapes.map((grape) => ({ grape, percent: null }))}
              sharesVintage={grapes?.vintageYear ?? null}
              sources={grapes?.sources ?? []}
              editable={editing}
            />
          </div>
        )}
        <div className="stack section-divider">
          <h3 className="subsection-title">Trinkreife</h3>
          <p>
            <span className={`drink-badge drink-${status}`}>{DRINK_STATUS_LABELS[status]}</span>
            {drinkWindow && <span className="muted"> {drinkWindow}</span>}
          </p>
          {!drinkWindow && <p className="muted small">Kein Trinkfenster erfasst.</p>}
          {latestReadiness && <p className="small">Laut Verkostung: {latestReadiness}</p>}
        </div>
      </section>
    </div>
  );

  // Spalte 3: Bewertungen – subjektiv je Person, objektiv per WSET-Verkostung.
  const ratingsColumn = (
    <div className="wine-col wine-col-ratings">
      <section className="card stack">
        <h2 className="section-title">Bewertungen</h2>
        {anchor && (
          <PersonRatings
            key={String(year)}
            itemId={anchor.inventory_item_id}
            ratings={ratings}
            ownPersonId={person?.id ?? null}
            editable={editing}
          />
        )}
        {legacyRating != null && <p className="muted small">Frühere Bewertung (Import): {formatRating(legacyRating)}</p>}
        <div className="stack section-divider">
          <div className="row row-between">
            <h3 className="subsection-title">Verkostungen (WSET)</h3>
            {anchor && (
              <Link href={`/flasche/${anchor.inventory_item_id}/verkostung`} className="btn btn-sm btn-primary">
                Neue Verkostung
              </Link>
            )}
          </div>
          {tastings.length === 0 ? (
            <p className="muted">Noch keine Verkostung für {yearLabel}.</p>
          ) : (
            <ul className="tasting-list">
              {tastings.map((t) => (
                <li key={t.id}>
                  <Link href={`/flasche/${tastingItem(t.inventory_item_id)}/verkostung?t=${t.id}`}>
                    <span className="tasting-result">
                      {[t.quality_level, t.points != null ? `${t.points.toLocaleString("de-CH")} / 4 Punkte` : null]
                        .filter(Boolean)
                        .join(" · ") || "Ohne Resultat"}
                    </span>
                    <span className="tasting-meta">{[formatDate(t.tasted_at), t.person].filter(Boolean).join(" · ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );

  return (
    <div className="stack-lg">
      <Link href={back.href} className="back">
        ← {back.label}
      </Link>

      {query.geoeffnet && (
        <p className="notice notice-ok" role="status">
          Flasche geöffnet. Viel Genuss!
        </p>
      )}
      {query.ausgetrunken && (
        <p className="notice notice-ok" role="status">
          Flasche als ausgetrunken markiert. Zum Wohl!
        </p>
      )}
      {typeof query.ok === "string" && (
        <p className="notice notice-ok" role="status">
          {query.ok}
        </p>
      )}
      {query.verkostung && (
        <p className="notice notice-ok" role="status">
          Verkostung gespeichert.
        </p>
      )}

      <header className="wine-head stack">
        <div className="detail-header">
          <div className="stack-sm">
            <h1 className="page-title">
              {wine.name} {yearLabel}
            </h1>
            <span className="item-producer">{wine.producer}</span>
          </div>
          <div className="detail-total">
            <span className="tile-big">
              {sealedCount} <span>Fl.</span>
            </span>
            {open.length > 0 && <span className="muted">+{open.length} offen</span>}
          </div>
        </div>
        <div className="row">
          {editing ? (
            <Link href={viewHref} className="btn btn-primary btn-sm">
              ✓ Fertig
            </Link>
          ) : (
            <Link href={editHref} className="btn btn-sm">
              ✏️ Bearbeiten
            </Link>
          )}
          {editing && <span className="muted small">Jede Angabe einzeln speichern – „Abbrechen“ setzt sie zurück.</span>}
        </div>
        {options.length > 1 && (
          <nav className="segmented vintage-switch" aria-label="Jahrgang">
            {options.map((o) => (
              <Link
                key={String(o.year)}
                href={wineHref(wine.id, o.year, editing ? { ...von, bearbeiten: "1" } : von)}
                className={o.year === year ? "segment active" : "segment"}
                aria-current={o.year === year ? "page" : undefined}
                replace
              >
                {o.year ?? "o. J."}
                <span className="segment-count">
                  {o.sealed + o.open > 0 ? `${o.sealed}${o.open ? `+${o.open}` : ""}` : "getr."}
                </span>
              </Link>
            ))}
          </nav>
        )}
      </header>

      <div className="wine-columns">
        {editing ? batchColumn : openColumn}
        {wineColumn}
        {ratingsColumn}
      </div>
    </div>
  );
}
