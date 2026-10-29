import { DRINK_SOURCE_LABELS, asDrinkSource, drinkWindowText } from "@/lib/cellar/drink-window";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, cache, type ReactNode } from "react";
import { viewerPhoto } from "@/components/cellar/wine-card";
import { PhotoGallery } from "@/components/photo-viewer";
import { ResearchSuggestions } from "@/components/research-suggestions";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { getMemberSession } from "@/lib/auth";
import { countryFlag } from "@/lib/cellar/overview";
import {
  anchorItem,
  parseVintageParam,
  pickVintage,
  vintageOptions,
  wineHref,
  withTastedYears,
} from "@/lib/cellar/wine-page";
import {
  asWineType,
  formatAge,
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
import { EditUnit, EditUnits } from "@/components/edit-unit";
import { SPIRIT_DETAIL_FIELDS, WINE_DETAIL_FIELDS, WINE_SECTIONS, drinkRow, giftLabel, grapeLine, type WineDetailField, type WineSection } from "@/lib/cellar/wine-units";
import { botChatUrl } from "@/lib/telegram/bot-link";
import { OpenBottleControls, OpenBottleForm, type Charge } from "./bottle-actions";
import { SpiritBottle, SpiritOpen } from "./spirit-bottle";
import { spiritOpenNote } from "@/lib/spirits/tag";
import { KeepEdit } from "./keep-edit";
import { KeepBadge } from "@/components/keep-badge";
import { KEEP_SOURCE_LABELS, asKeepSource, keepApplies, keepStatus, keepText } from "@/lib/fortified/keep";
import { DocumentClip } from "./documents";
import { BatchForm, WineCardForm, type EditBatch } from "./edit-sections";
import { NotesField } from "./notes-field";
import { ResearchHead } from "./research-head";
import { wineJobStatus } from "@/lib/research/jobs";
import { WinePhotos } from "./photos";
import { PriceLine, type PriceInfo } from "./price-card";
import { priceNoteHint } from "@/lib/research/price-note";
import { PersonRatings, RatingsForm, type PersonRating } from "./ratings-card";
import { EncounterSection } from "./encounters";
import { TasteCard } from "./taste-card";
import { loadTasteProfile } from "@/lib/taste/store";
import { DeleteWine } from "./delete-sections";
import { loadWineDeleteSummary } from "@/lib/edit/delete";
import { wineDeleteSummaryText } from "@/lib/edit/delete-text";
import { BackLink } from "@/components/back-link";
import { loadSpiritCategories } from "@/lib/spirits/load";
import { categoryLabel, categoryPath, toSpiritFields } from "@/lib/spirits/categories";
import { EMPTY_WINE_QUESTION, loadPlaces, loadWineEncounters, wouldLeaveEmptyWine } from "@/lib/edit/encounters";

// Server Actions dieser Seite (z. B. Nachrecherchieren mit Websuche) brauchen Zeit.
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BACK_LINKS: Record<string, { href: string; label: string }> = {
  bestand: { href: "/bestand", label: "Bestand" },
  start: { href: "/", label: "Start" },
  offen: { href: "/offen", label: "Offen" },
  getrunken: { href: "/getrunken", label: "Getrunken" },
  verkostet: { href: "/verkostet", label: "Verkostet" },
};

type Supabase = Awaited<ReturnType<typeof getMemberSession>>["supabase"];

/** Pro Request nur einmal (Seite und Titel teilen sich die Abfrage). */
const loadWine = cache(async (id: string) => {
  if (!UUID_RE.test(id)) return null;
  const { supabase } = await getMemberSession();
  const { data } = await supabase.from("wines").select("*").eq("id", id).maybeSingle();
  return data;
});

export async function generateMetadata({ params }: PageProps<"/wein/[id]">): Promise<Metadata> {
  const wine = await loadWine((await params).id);
  return { title: wine ? wine.name : "Wein" };
}

/** Alle Flaschen des Weins (ungeöffnet, offen, getrunken), mit „Geschenk von“ (nicht in cellar_overview). */
async function loadItems(supabase: Supabase, wineId: string) {
  // Beide Abfragen gleichzeitig (unabhängig voneinander).
  const [gifts, { data, error }, researched] = await Promise.all([
    supabase.from("inventory_items").select("id, gift_from").eq("wine_id", wineId),
    supabase
      .from("cellar_overview")
      .select(
        "inventory_item_id, vintage_year, status, quantity, bottle_size_ml, storage_house, storage_room, purchase_price, regular_price, currency, purchased_at, vendor_name, is_gift, fill_level_percent, date_opened, drunk_at, personal_wine_rating, vintage_rating",
      )
      .eq("wine_id", wineId),
    // Recherchierte Preise (Hinweis „Preis recherchiert: …“); vor der Migration keine.
    supabase.from("inventory_items").select("id, price_note").eq("wine_id", wineId).eq("price_source", "research"),
  ]);
  if (gifts.error) throw gifts.error;
  const priceNotes = new Map((researched.data ?? []).map((r) => [r.id, r.price_note]));
  const giftFrom = new Map((gifts.data ?? []).filter((g) => g.gift_from != null).map((g) => [g.id, g.gift_from]));
  if (error) throw error;
  return (data ?? []).flatMap((r) =>
    r.inventory_item_id && r.status
      ? [
          {
            ...r,
            inventory_item_id: r.inventory_item_id,
            status: r.status as InventoryStatus,
            quantity: r.quantity ?? 0,
            gift_from: giftFrom.get(r.inventory_item_id) ?? null,
            price_hint: priceNoteHint(priceNotes.get(r.inventory_item_id)),
          },
        ]
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
        .select("id, inventory_item_id, encounter_id, tasted_at, quality_level, quality_points, readiness, sat, person:persons(name)")
        .eq("wine_id", wineId),
    ).order("tasted_at", { ascending: false }),
    sameVintage(
      // „*“: drink_window_source/_note gibt es erst nach der Migration – so geht nichts kaputt.
      supabase.from("wine_vintages").select("*").eq("wine_id", wineId),
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

/** „🎁 Geschenk von Anna“ bzw. „🎁 Geschenk“ unter der Preiszeile einer Charge. */
function GiftLine({ item }: { item: { is_gift: boolean | null; gift_from: string | null } }) {
  const label = giftLabel(item.is_gift, item.gift_from);
  return label ? <p className="muted small gift-line">🎁 {label}</p> : null;
}

const sizeSuffix = (ml: number | null) => (ml && ml !== 750 ? ` · ${formatBottleSize(ml)}` : "");

export default async function WinePage({ params, searchParams }: PageProps<"/wein/[id]">) {
  const [{ id }, query, { supabase, person }] = await Promise.all([params, searchParams, getMemberSession()]);
  // Wein, Flaschen und „Verkostet“ gleichzeitig (alle brauchen nur die ID aus der URL).
  const [wine, items, encounters] = await Promise.all([
    loadWine(id),
    UUID_RE.test(id) ? loadItems(supabase, id) : [],
    UUID_RE.test(id) ? loadWineEncounters(supabase, id) : [],
  ]);
  if (!wine) notFound();
  const today = todayIso();
  // Jahrgänge mit Flaschen sowie solche, die nur verkostet wurden.
  const options = withTastedYears(vintageOptions(items), encounters.map((e) => e.year));
  const year = pickVintage(options, parseVintageParam(query.jahrgang), items);
  const inVintage = items.filter((i) => i.vintage_year === year);
  const anchor = anchorItem(inVintage);

  const [{ ratings, tastings, vintage }, grapes, photos, vendors, documents, places, deleteSummary, tasteProfile, leavesEmpty, suggestions, researchJob] = await Promise.all([
    loadRatingsAndTastings(supabase, wine.id, year),
    loadGrapeShares(supabase, wine.id, year),
    loadVintagePhotos(supabase, wine.id, year, inVintage.map((i) => i.inventory_item_id)),
    loadVendorNames(supabase),
    loadDocuments(supabase, wine.id, year),
    loadPlaces(supabase),
    loadWineDeleteSummary(supabase, wine.id, { exists: true }),
    // Jahrgangsspezifisches Profil, sonst das allgemeine.
    loadTasteProfile(supabase, wine.id, year).catch((error) => {
      console.error("loading taste profile failed", error);
      return null;
    }),
    // Einziger Eintrag „Verkostet“ ohne Flaschen: Löschen fragt, ob auch der Wein weg soll.
    items.length === 0 && encounters.length === 1 ? wouldLeaveEmptyWine(supabase, encounters[0].id) : false,
    loadPendingSuggestions(supabase, { wineId: wine.id, year }).catch((error) => {
      console.error("loading suggestions failed", error);
      return [];
    }),
    // Recherche im Hintergrund (🔎 bzw. Sammellauf): läuft sie noch?
    wineJobStatus(supabase, wine.id),
  ]);
  // Spirituose: Kategorie (Haupt › Unter) und eigene Angaben; ohne Rebsorten, Trinkreife, WSET.
  const spirit = wine.type === "spirit";
  const spiritFields = toSpiritFields(wine as unknown as Record<string, unknown>);
  const spiritPath = spirit ? categoryPath(await loadSpiritCategories(supabase), spiritFields.categoryId) : null;
  const spiritCategory = spiritPath ? categoryLabel(spiritPath) : null;
  // Likörwein bzw. Likör (Spirituose der Kategorie Likör): Haltbarkeit offen.
  const fortified = keepApplies(wine.type, spiritPath?.main?.name);
  const keepRow = wine as { open_keep_days?: number | null; open_keep_source?: string | null; open_keep_note?: string | null };
  const keepDays = fortified ? (keepRow.open_keep_days ?? null) : null;
  const keepSource = asKeepSource(keepRow.open_keep_source);
  // „offen ca. 4 Wochen, Quelle: …“, „offen ≈ 4 Wochen (Schätzung nach Stil: Tawny)“, „…, von Hand“.
  const keepLabel = keepDays
    ? `${keepText(keepDays, keepSource)}${
        keepSource === "estimate"
          ? keepRow.open_keep_note ? ` (${keepRow.open_keep_note})` : ", geschätzt"
          : keepSource === "manual" ? `, ${KEEP_SOURCE_LABELS.manual}` : keepRow.open_keep_note ? `, Quelle: ${keepRow.open_keep_note}` : ""
      }`
    : null;
  const emptyWine = leavesEmpty ? { encounterId: encounters[0].id, wineId: wine.id, name: wine.name, question: EMPTY_WINE_QUESTION } : null;

  const sealed = inVintage.filter((i) => i.status === "sealed" && i.quantity > 0);
  const open = inVintage.filter((i) => i.status === "open");
  const drunk = inVintage
    .filter((i) => i.status === "drunk")
    .sort((a, b) => (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""));
  const sealedCount = sealed.reduce((s, i) => s + i.quantity, 0);
  // Spirituose: offene Flaschen bleiben im Bestand und zählen wie volle.
  const bottleCount = spirit ? sealedCount + open.length : sealedCount;
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

  const drinkSource = asDrinkSource(vintage?.drink_window_source);
  const drinkWindow = drinkWindowText(vintage?.drink_from_year ?? null, vintage?.drink_until_year ?? null, drinkSource);
  const latestReadiness = tastings.find((t) => t.readiness)?.readiness ?? null;
  const flag = countryFlag(wine.country);
  const sizes = [...new Set(inVintage.map((i) => i.bottle_size_ml ?? (spirit ? 700 : 750)))].map((ml) => formatBottleSize(ml)).join(", ");
  const legacyRating = inVintage.map((i) => i.personal_wine_rating).find((r) => r != null) ?? null;
  const back = BACK_LINKS[typeof query.von === "string" ? query.von : ""] ?? BACK_LINKS.bestand;
  const yearLabel = year ?? "o. J.";
  const tastingItem = (itemId: string | null) => itemId ?? anchor?.inventory_item_id;

  const von = typeof query.von === "string" ? { von: query.von } : undefined;
  const bottleTitle = (b: EditBatch) =>
    b.status === "drunk"
      ? `${b.drunk_at ? formatDate(zurichDate(b.drunk_at)) : "ohne Datum"}${sizeSuffix(b.bottle_size_ml)}`
      : `${place(b)} · ${b.quantity} Fl.${sizeSuffix(b.bottle_size_ml)}`;
  const batchForm = (b: EditBatch) => <BatchForm batch={b} vendors={vendors} />;

  // Spalte 1: offene Flaschen, Bestand (Chargen), Flasche öffnen, getrunkene – je mit ✏️.
  const openColumn = (
    <div className="wine-col wine-col-open">
      {/* Spirituose: je offene Flasche eine Karte (Füllstand, leer); sonst bzw. dazu „Flasche öffnen“. */}
      {spirit &&
        open.map((o) => (
          <EditUnit key={o.inventory_item_id} id={`item:${o.inventory_item_id}`} label={`Offene Flasche (${place(o)})`} className="bottle-unit" form={batchForm(o)}>
            <SpiritBottle
              key={`${o.inventory_item_id}:${o.fill_level_percent}`}
              wineId={wine.id}
              itemId={o.inventory_item_id}
              fill={o.fill_level_percent}
              openedOn={[o.date_opened ? `Geöffnet am ${formatDate(o.date_opened)}` : null, place(o)].filter(Boolean).join(" · ") || null}
              keep={fortified && keepStatus(o.date_opened, keepDays, today) ? <KeepBadge status={keepStatus(o.date_opened, keepDays, today)} /> : undefined}
            />
          </EditUnit>
        ))}
      {spirit && charges.length > 0 && (
        <SpiritOpen
          charges={charges.map((c) => ({ itemId: c.itemId, label: c.label }))}
          openFill={open.length ? Math.min(...open.map((o) => o.fill_level_percent ?? 100)) : undefined}
        />
      )}
      {/* Offene Flaschen zuerst – die trinkt man als Nächstes. */}
      {!spirit && open.length > 0 && (
        <section className="card stack">
          <h2 className="section-title">Offen</h2>
          {open.map((o) => (
            <EditUnit
              key={o.inventory_item_id}
              id={`item:${o.inventory_item_id}`}
              label={`Offene Flasche (${place(o)})`}
              className="bottle-unit"
              form={batchForm(o)}
            >
              <OpenBottleControls
                bottle={{
                  itemId: o.inventory_item_id,
                  fillLevel: o.fill_level_percent,
                  price: priceOf(o),
                  label: [
                    o.date_opened ? `Geöffnet am ${formatDate(o.date_opened)}${spirit ? "" : ` (${formatDaysSince(o.date_opened)})`}` : "Offen",
                    place(o),
                    o.bottle_size_ml && o.bottle_size_ml !== 750 ? formatBottleSize(o.bottle_size_ml) : null,
                    giftLabel(o.is_gift, o.gift_from),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }}
              />
              {/* Likörwein: gut bis = Öffnungsdatum + Haltbarkeit (rechnet bei neuem Datum mit). */}
              {fortified && keepStatus(o.date_opened, keepDays, today) && (
                <p className="small">
                  <KeepBadge status={keepStatus(o.date_opened, keepDays, today)} />
                </p>
              )}
            </EditUnit>
          ))}
        </section>
      )}
      {sealed.length > 0 && (
        <section className="card stack">
          <h2 className="section-title">Im Bestand</h2>
          <ul className="bottle-list">
            {sealed.map((b) => (
              <EditUnit
                key={b.inventory_item_id}
                as="li"
                id={`item:${b.inventory_item_id}`}
                label={`Charge ${place(b)}`}
                title={<strong>{bottleTitle(b)}</strong>}
                form={batchForm(b)}
              >
                <PriceLine {...priceOf(b)} />
                {b.price_hint && <p className="muted small">{b.price_hint}</p>}
                <GiftLine item={b} />
              </EditUnit>
            ))}
          </ul>
        </section>
      )}
      {!spirit && charges.length > 0 && (
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
              <EditUnit
                key={d.inventory_item_id}
                as="li"
                id={`item:${d.inventory_item_id}`}
                label={`Getrunkene Flasche vom ${d.drunk_at ? formatDate(zurichDate(d.drunk_at)) : "–"}`}
                title={
                  <span className="row row-between">
                    <span>{bottleTitle(d)}</span>
                    {d.personal_wine_rating != null && (
                      <span className="muted">{formatStarNumber(d.personal_wine_rating)} ★</span>
                    )}
                  </span>
                }
                form={batchForm(d)}
              >
                <PriceLine {...priceOf(d)} />
                {d.price_hint && <p className="muted small">{d.price_hint}</p>}
                <GiftLine item={d} />
              </EditUnit>
            ))}
          </ul>
        </section>
      )}
      {inVintage.length === 0 && (
        <section className="card stack-sm">
          <p className="muted">Keine Flaschen dieses Jahrgangs{options.find((o) => o.year === year)?.tastedOnly ? " – bisher nur verkostet" : ""}.</p>
          <div>
            <a href={botChatUrl()} className="btn btn-sm" target="_blank" rel="noopener noreferrer">
              ＋ Flaschen erfassen
            </a>
          </div>
          <p className="muted small">Flaschen erfasst du im Bot Antoine: Foto der Etikette schicken oder den Kauf als Text.</p>
        </section>
      )}
    </div>
  );

  const shownShares = grapes?.shares ?? wine.grapes.map((grape) => ({ grape, percent: null }));
  // Herkunft dazu: „≈ 2024–2030 · geschätzt“ (mit Begründung als Tooltip); Etikett/Quelle kurz.
  const drink = drinkWindow ? (
    <span title={vintage?.drink_window_note ?? undefined}>
      {drinkRow(drinkWindow)}
      {drinkSource && drinkSource !== "manual" && <span className="muted small"> · {DRINK_SOURCE_LABELS[drinkSource]}</span>}
    </span>
  ) : null;
  const details: Record<WineDetailField, ReactNode> = {
    Typ: <WineTypeIcon type={wine.type} withLabel />,
    Land: wine.country ? `${flag ? `${flag} ` : ""}${wine.country}` : null,
    Region: wine.region,
    Appellation: wine.appellation,
    Alkohol: wine.alcohol_content != null ? `${wine.alcohol_content.toLocaleString("de-CH")} %` : null,
    Flasche: sizes,
    Rebsorten: grapeLine(shownShares),
    // Nur das Fenster („2025–2029“); den Status zeigen die Listen.
    Trinkreife: drink,
    Kategorie: spiritCategory,
    Alter: formatAge(spiritFields.ageYears),
    "Fass/Finish": spiritFields.cask,
    Destilliert: spiritFields.distilledYear,
    Abgefüllt: spiritFields.bottledYear,
  };
  const detailFields: readonly WineDetailField[] = spirit ? SPIRIT_DETAIL_FIELDS : WINE_DETAIL_FIELDS;
  const photoAlt = `${wine.name} ${yearLabel}`;

  // Spalte 2: nur „Zum Wein“ – eine Tabelle (Stammdaten, Rebsorten, Trinkreife, zuletzt die Fotos).
  // Die Recherche sitzt als 🔎 im Kopf neben dem Weinnamen.
  const sections: Record<WineSection, ReactNode> = {
    details: (
      <EditUnit
        id="wine"
        label="Zum Wein"
        title={<h2 className="section-title">Zum Wein</h2>}
        form={
          <WineCardForm
            wine={{ ...wine, type: asWineType(wine.type) }}
            year={year}
            otherYears={options.map((o) => o.year).filter((y) => y !== year)}
            shares={shownShares}
            drinkFrom={vintage?.drink_from_year ?? null}
            drinkUntil={vintage?.drink_until_year ?? null}
            photos={
              <WinePhotos
                wineId={wine.id}
                vintageYear={year}
                itemId={anchor?.inventory_item_id ?? null}
                photos={photos.map(viewerPhoto)}
                alt={photoAlt}
                embedded
              />
            }
          />
        }
      >
        <dl className="details">
          {detailFields.map((f) => (
            <Detail key={f} label={f} value={details[f]} />
          ))}
          {!spirit && <Detail label="Laut Verkostung" value={latestReadiness} />}
          {fortified && <Detail label="Haltbarkeit offen" value={<KeepEdit wineId={wine.id} days={keepDays} text={keepLabel} />} />}
          <Detail label="Jahrgang" value={vintage?.vintage_rating ?? inVintage.find((i) => i.vintage_rating)?.vintage_rating} />
          <Detail label="Notiz" value={vintage?.notes} />
        </dl>
        {/* Fotos als letzte Zeile, ohne Überschrift; Antippen öffnet gross. */}
        {photos.length > 0 && (
          <div className="details-photos">
            <PhotoGallery photos={photos.map(viewerPhoto)} alt={photoAlt} />
          </div>
        )}
        {suggestions.length > 0 && <ResearchSuggestions suggestions={suggestions} />}
      </EditUnit>
    ),
  };
  const wineColumn = (
    <div className="wine-col wine-col-wine">
      {/* „Zum Wein“ und darunter „Notizen“ – auch auf dem iPad quer zusammen in Spalte 2. */}
      <div className="wine-col wine-col-main">
        <section className="card stack">
          {WINE_SECTIONS.map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
        </section>
        {/* Notizen: immer ein Freitextfeld, speichert selbst (keine „offene Bearbeitung“). */}
        <section className="card stack-sm wine-notes-card" id="notes">
          <h2 className="section-title">Notizen</h2>
          <NotesField key={wine.id} wineId={wine.id} notes={wine.notes} />
        </section>
      </div>
      {/* Geschmacksprofil direkt nach „Zum Wein“ (iPhone, iPad hochkant); iPad quer zuoberst in Spalte 3
          über „Bewertungen“ – dann löst das CSS die Spalte auf (display: contents, Bereich „taste“). */}
      <div className="wine-col wine-col-taste">
        <TasteCard wineId={wine.id} wineType={wine.type} year={year} profile={tasteProfile} tastings={spirit ? [] : tastings} />
      </div>
    </div>
  );

  // Spalte 3: Bewertungen – subjektiv je Person, objektiv per WSET-Verkostung.
  const ratingsColumn = (
    <div className="wine-col wine-col-ratings">
      <section className="card stack">
        <EditUnit
          id="ratings"
          label="Bewertungen"
          title={<h2 className="section-title">Bewertungen</h2>}
          form={anchor ? <RatingsForm itemId={anchor.inventory_item_id} ratings={ratings} /> : undefined}
        >
          {anchor && (
            <PersonRatings
              key={String(year)}
              itemId={anchor.inventory_item_id}
              ratings={ratings}
              ownPersonId={person?.id ?? null}
            />
          )}
          {legacyRating != null && <p className="muted small">Frühere Bewertung (Import): {formatRating(legacyRating)}</p>}
        </EditUnit>
        {/* WSET-Verkostung (SAT) ist für Wein – bei Spirituosen nicht. */}
        {!spirit && (
        <div className="stack section-divider">
          <div className="row row-between">
            <h3 className="subsection-title">WSET</h3>
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
                  <Link
                    href={
                      t.encounter_id
                        ? `/verkostet/${t.encounter_id}/wset?t=${t.id}`
                        : `/flasche/${tastingItem(t.inventory_item_id)}/verkostung?t=${t.id}`
                    }
                  >
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
        )}
      </section>
      <EncounterSection
        wineId={wine.id}
        year={year}
        encounters={encounters}
        wantToBuy={wine.want_to_buy}
        persons={ratings.map(({ personId, name }) => ({ personId, name }))}
        places={places}
        today={today}
        emptyWine={emptyWine}
      />
    </div>
  );

  return (
    <EditUnits>
      <div className="stack-lg">
        <BackLink base={back.href} label={back.label} />

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
              <div className="title-row">
                <h1 className="page-title">
                  {wine.name} {yearLabel}
                </h1>
                <ResearchHead wineId={wine.id} year={year} researchedOn={formatDate(zurichDate(wine.researched_at))} running={researchJob.running} />
              </div>
              {wine.producer && <span className="item-producer">{wine.producer}</span>}
            </div>
            <div className="detail-total">
              <span className="tile-big">
                {bottleCount} <span>Fl.</span>
              </span>
              {open.length > 0 && <span className="muted">{spirit ? spiritOpenNote(bottleCount, { open: open.length, fill: null, dateOpened: null }) : `+${open.length} offen`}</span>}
              <DocumentClip key={`${year}:${documents.length}`} docs={documents} wineId={wine.id} vintageYear={year} />
            </div>
          </div>
          {options.length > 1 && (
            <nav className="segmented vintage-switch" aria-label="Jahrgang">
              {options.map((o) => (
                <Link
                  key={String(o.year)}
                  href={wineHref(wine.id, o.year, von)}
                  className={o.year === year ? "segment active" : "segment"}
                  aria-current={o.year === year ? "page" : undefined}
                  replace
                >
                  {o.year ?? "o. J."}
                  <span className="segment-count">
                    {o.sealed + o.open > 0 ? (spirit ? `${o.sealed + o.open}` : `${o.sealed}${o.open ? `+${o.open}` : ""}`) : o.tastedOnly ? "verk." : "getr."}
                  </span>
                </Link>
              ))}
            </nav>
          )}
        </header>

        <div className="wine-columns">
          {openColumn}
          {wineColumn}
          {ratingsColumn}
        </div>

        {/* Ganz unten, dezent: den ganzen Wein löschen (Bestätigung mit Namenseingabe). */}
        {deleteSummary && (
          <DeleteWine wineId={wine.id} name={wine.name} summary={wineDeleteSummaryText(deleteSummary)} back={back.href} />
        )}
      </div>
    </EditUnits>
  );
}
