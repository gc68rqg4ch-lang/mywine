import "server-only";

// Verkostet (wine_encounters): einen Wein irgendwo probiert – erfassen, ändern, löschen und
// der Merker „Kaufen?“. Gleiches Muster wie edit.ts (prepare → Vorschau → run), damit App
// und Bot dieselben Prüfungen und Meldungen haben. Bewertungen eines Eintrags tragen seine
// encounter_id und das Datum des Eintrags (rated_at).

import type { Database } from "@/lib/database.types";
import { WINE_TYPE_LABELS, formatMoney, formatStarNumber, todayIso, wineName, type WineType } from "@/lib/format";
import { isValidRating } from "@/lib/ratings";
import {
  DASH,
  clean,
  date,
  diff,
  exact,
  fail,
  loadWine,
  ready,
  show,
  validDate,
  validPrice,
  validYear,
  wineTitle,
  type Db,
  type PreparedEdit,
} from "./helpers";
import {
  CURRENCIES,
  PLACE_KINDS,
  PLACE_KIND_LABELS,
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  yearText,
  type Edit,
  type EditChange,
  type EncounterChanges,
  type PlaceKind,
  type PlaceRef,
} from "./types";

const MAX_TEXT = 500;
const WINE_TYPES = Object.keys(WINE_TYPE_LABELS) as WineType[];

type Place = { id: string; name: string; kind: string | null; city: string | null };

/** „Taverne zum Ochsen (Restaurant, Zürich)“ */
export function placeLabel(p: { name: string; kind: string | null; city: string | null } | null | undefined) {
  if (!p) return null;
  const kind = p.kind && p.kind in PLACE_KIND_LABELS ? PLACE_KIND_LABELS[p.kind as PlaceKind] : null;
  const extra = [kind, p.city].filter(Boolean).join(", ");
  return extra ? `${p.name} (${extra})` : p.name;
}

/** „CHF 12.00 / Glas“ */
export function encounterPrice(e: { price: number | null; price_unit: string | null; currency: string | null }) {
  const money = formatMoney(e.price, e.currency ?? "CHF");
  if (!money) return null;
  const unit = e.price_unit && e.price_unit in PRICE_UNIT_LABELS ? PRICE_UNIT_LABELS[e.price_unit as keyof typeof PRICE_UNIT_LABELS] : null;
  return unit ? `${money} / ${unit}` : money;
}

/** Kompakte Zusammenfassung eines Eintrags auf der Weinseite: „Datum · Ort · Preis · Sterne“. */
export function encounterSummary(e: Pick<EncounterView, "tastedOn" | "place" | "price" | "priceUnit" | "currency" | "ratings">) {
  const ratings = e.ratings.map((r) => `${r.name} ${formatStarNumber(r.rating)} ★`).join(", ");
  return [
    date(e.tastedOn),
    e.place?.name ?? null,
    encounterPrice({ price: e.price, price_unit: e.priceUnit, currency: e.currency }),
    ratings || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const stars = (v: number | null | undefined) => (v == null ? DASH : `${v.toLocaleString("de-CH")} ★`);
const yesNo = (v: boolean) => (v ? "ja" : "nein");

// ---------------------------------------------------------------------------
// Laden

const ENCOUNTER_COLUMNS =
  "id, wine_id, vintage_year, tasted_on, place_id, price, price_unit, currency, occasion, companions, note, person_id, source, created_at, place:places(id, name, kind, city), wine:wines(name, producer)" as const;

async function loadEncounter(db: Db, id: string) {
  const { data, error } = await db.from("wine_encounters").select(ENCOUNTER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPersons(db: Db) {
  const { data, error } = await db.from("persons").select("id, name").order("sort_order");
  if (error) throw error;
  return data ?? [];
}

/** Orte zur Auswahl (alphabetisch). */
export async function loadPlaces(db: Db): Promise<Place[]> {
  const { data, error } = await db.from("places").select("id, name, kind, city").order("name");
  if (error) throw error;
  return data ?? [];
}

export type EncounterView = {
  id: string;
  wineId: string;
  year: number | null;
  tastedOn: string;
  place: Place | null;
  price: number | null;
  priceUnit: string | null;
  currency: string;
  occasion: string | null;
  companions: string | null;
  note: string | null;
  personId: string | null;
  createdAt: string;
  ratings: { personId: string; name: string; rating: number }[];
  tastings: { id: string; quality: string | null; points: number | null; person: string | null }[];
};

/** Alle Einträge eines Weins (alle Jahrgänge), neuester zuerst – mit Bewertungen und WSET-Verkostungen. */
export async function loadWineEncounters(db: Db, wineId: string): Promise<EncounterView[]> {
  const { data, error } = await db
    .from("wine_encounters")
    .select(ENCOUNTER_COLUMNS)
    .eq("wine_id", wineId)
    .order("tasted_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (data ?? []).map((e) => e.id);
  if (!ids.length) return [];
  const [ratings, tastings, persons] = await Promise.all([
    db.from("wine_ratings").select("encounter_id, person_id, rating").in("encounter_id", ids),
    db.from("wine_tastings").select("id, encounter_id, quality_level, quality_points, person_id").in("encounter_id", ids),
    loadPersons(db),
  ]);
  if (ratings.error) throw ratings.error;
  if (tastings.error) throw tastings.error;
  const nameOf = (id: string | null) => persons.find((p) => p.id === id)?.name ?? null;
  const order = (id: string) => persons.findIndex((p) => p.id === id);
  return (data ?? []).map((e) => ({
    id: e.id,
    wineId: e.wine_id,
    year: e.vintage_year,
    tastedOn: e.tasted_on,
    place: e.place,
    price: e.price,
    priceUnit: e.price_unit,
    currency: e.currency,
    occasion: e.occasion,
    companions: e.companions,
    note: e.note,
    personId: e.person_id,
    createdAt: e.created_at,
    ratings: (ratings.data ?? [])
      .filter((r) => r.encounter_id === e.id)
      .sort((a, b) => order(a.person_id) - order(b.person_id))
      .map((r) => ({ personId: r.person_id, name: nameOf(r.person_id) ?? "?", rating: r.rating })),
    tastings: (tastings.data ?? [])
      .filter((t) => t.encounter_id === e.id)
      .map((t) => ({ id: t.id, quality: t.quality_level, points: t.quality_points, person: nameOf(t.person_id) })),
  }));
}

// ---------------------------------------------------------------------------
// Prüfen

/** Prüft die Angaben eines Eintrags; null = in Ordnung. */
function checkFields(set: EncounterChanges) {
  if (set.year !== undefined) {
    const invalid = validYear(set.year);
    if (invalid) return invalid;
  }
  if (set.tastedOn !== undefined) {
    const invalid = validDate(set.tastedOn, "Verkostet am");
    if (invalid) return invalid;
  }
  if (set.price !== undefined) {
    const invalid = validPrice(set.price, "Preis");
    if (invalid) return invalid;
  }
  if (set.priceUnit != null && !PRICE_UNITS.includes(set.priceUnit)) return "Preis: pro Flasche oder pro Glas?";
  if (set.currency !== undefined && !CURRENCIES.includes(set.currency)) return `Währung: ${CURRENCIES.join(", ")}.`;
  for (const [key, label] of [["occasion", "Anlass"], ["companions", "Begleitung"], ["note", "Notiz"]] as const) {
    if ((set[key]?.length ?? 0) > MAX_TEXT) return `${label}: höchstens ${MAX_TEXT} Zeichen.`;
  }
  return null;
}

/**
 * Ort auflösen: bestehender (per ID) oder neu – ein gleichnamiger Ort wird wiederverwendet.
 * Liefert die Anzeige und eine Funktion, die erst beim Ausführen anlegt.
 */
async function describePlace(
  db: Db,
  ref: PlaceRef,
): Promise<{ error: string } | { label: string; note: string | null; resolve: () => Promise<{ id: string | null; created: boolean }> }> {
  if (ref == null) return { label: DASH, note: null, resolve: async () => ({ id: null, created: false }) };
  if ("placeId" in ref) {
    const { data, error } = await db.from("places").select("id, name, kind, city").eq("id", ref.placeId).maybeSingle();
    if (error) throw error;
    if (!data) return { error: "Diesen Ort gibt es nicht mehr." };
    return { label: placeLabel(data) ?? DASH, note: null, resolve: async () => ({ id: data.id, created: false }) };
  }
  const name = clean(ref.name);
  if (!name) return { error: "Ort: bitte einen Namen angeben." };
  if (name.length > 120) return { error: "Ort: Name zu lang." };
  if (ref.kind != null && !PLACE_KINDS.includes(ref.kind)) return { error: "Ort: unbekannte Art." };
  const city = clean(ref.city);
  const find = async () => {
    const { data, error } = await db.from("places").select("id, name, kind, city").ilike("name", exact(name)).maybeSingle();
    if (error) throw error;
    return data;
  };
  const existing = await find();
  if (existing) {
    return {
      label: placeLabel(existing) ?? name,
      note: `Den Ort „${existing.name}“ gibt es schon – ich nehme ihn.`,
      resolve: async () => ({ id: existing.id, created: false }),
    };
  }
  return {
    label: `${placeLabel({ name, kind: ref.kind, city })} (neu)`,
    note: null,
    resolve: async () => {
      const { data, error } = await db.from("places").insert({ name, kind: ref.kind, city }).select("id").single();
      // Gleichzeitig angelegt (eindeutiger Name): den vorhandenen nehmen.
      if (error?.code === "23505") return { id: (await find())?.id ?? null, created: false };
      if (error) throw error;
      return { id: data.id, created: true };
    },
  };
}

/** Anzeige der Felder „vorher → nachher“ (vorher DASH beim Erfassen). */
function fieldChanges(
  changes: EditChange[],
  before: { tastedOn: string | null; place: string; price: string | null; occasion: string | null; companions: string | null; note: string | null },
  after: { tastedOn: string | null; place: string; price: string | null; occasion: string | null; companions: string | null; note: string | null },
) {
  diff(changes, "Verkostet am", date(before.tastedOn), date(after.tastedOn));
  diff(changes, "Ort", before.place, after.place);
  diff(changes, "Preis", show(before.price), show(after.price));
  diff(changes, "Anlass", show(before.occasion), show(after.occasion));
  diff(changes, "Begleitung", show(before.companions), show(after.companions));
  diff(changes, "Notiz", show(before.note), show(after.note));
}

// ---------------------------------------------------------------------------
// Erfassen

export type WineCandidate = { id: string; name: string; producer: string | null; type: string | null; country: string | null };

/** Bestehende Weine mit diesem Namen (ohne Gross-/Kleinschreibung) – für „gibt es den Wein schon?“. */
export async function wineCandidates(db: Db, name: string): Promise<WineCandidate[]> {
  const { data, error } = await db
    .from("wines")
    .select("id, name, producer, type, country")
    .ilike("name", exact(name.trim().replace(/\s+/g, " ")))
    .order("producer")
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** Fehler „mehrere Weine heissen so“ – die App zeigt dann eine Auswahl. */
export const AMBIGUOUS_WINE = "Es gibt mehrere Weine mit diesem Namen – bitte den richtigen wählen oder „Neuen Wein anlegen“.";

/**
 * Neuer Wein beim Erfassen: mit Produzent über Name + Produzent abgleichen; ohne Produzent
 * nur über den Namen – ein Treffer wird genommen, bei mehreren muss man wählen.
 */
async function matchNewWine(db: Db, name: string, producer: string | null, forceNew: boolean) {
  if (forceNew) return { known: null };
  const candidates = await wineCandidates(db, name);
  if (producer) {
    return { known: candidates.find((c) => c.producer?.toLowerCase() === producer.toLowerCase()) ?? null };
  }
  if (candidates.length > 1) return { ambiguous: true as const };
  return { known: candidates[0] ?? null };
}

/** Was beim Speichern angelegt bzw. geändert wurde – zum Zurücknehmen bei einem Fehler. */
type Undo = () => PromiseLike<{ error: unknown }>;

export async function prepareAddEncounter(db: Db, edit: Extract<Edit, { kind: "addEncounter" }>): Promise<PreparedEdit> {
  const tastedOn = edit.set.tastedOn ?? todayIso();
  const invalid = checkFields({ ...edit.set, year: edit.year, tastedOn });
  if (invalid) return fail(invalid);

  // Wein: bestehend oder neu. Pflicht ist nur der Name (und der Jahrgang, NV möglich).
  const notes: string[] = [];
  let wine: { id: string | null; name: string; producer: string | null; want_to_buy: boolean };
  let newWine: Database["public"]["Tables"]["wines"]["Insert"] | null = null;
  if ("wineId" in edit.wine) {
    const w = await loadWine(db, edit.wine.wineId);
    if (!w) return fail("Diesen Wein gibt es nicht mehr.");
    wine = w;
  } else {
    const name = clean(edit.wine.new.name);
    const producer = clean(edit.wine.new.producer);
    if (!name) return fail("Bitte den Namen des Weins angeben.");
    if (name.length > 200 || (producer?.length ?? 0) > 200) return fail("Name bzw. Produzent ist zu lang.");
    const type = edit.wine.new.type ?? null;
    if (type != null && !WINE_TYPES.includes(type)) return fail("Unbekannter Weintyp.");
    const match = await matchNewWine(db, name, producer, edit.wine.new.forceNew ?? false);
    if ("ambiguous" in match) return fail(AMBIGUOUS_WINE);
    if (match.known) {
      const known = await loadWine(db, match.known.id);
      if (!known) return fail("Diesen Wein gibt es nicht mehr.");
      wine = known;
      notes.push(`Den Wein „${wineName(known)}“ gibt es schon – ich hänge den Eintrag dort an.`);
    } else {
      wine = { id: null, name, producer, want_to_buy: false };
      newWine = { name, producer, type, country: clean(edit.wine.new.country), region: clean(edit.wine.new.region) };
      notes.push("Neuer Wein – ich lege ihn an.");
    }
  }

  const persons = await loadPersons(db);
  if (edit.personId && !persons.some((p) => p.id === edit.personId)) return fail("Diese Person gibt es nicht.");
  const ratings = edit.ratings ?? [];
  for (const r of ratings) {
    if (!persons.some((p) => p.id === r.personId)) return fail("Diese Person gibt es nicht.");
    if (!isValidRating(r.rating)) return fail("Bewertung: 0–5 Sterne in halben Schritten.");
  }
  if (new Set(ratings.map((r) => r.personId)).size !== ratings.length) return fail("Pro Person nur eine Bewertung.");

  const place = await describePlace(db, edit.set.place ?? null);
  if ("error" in place) return fail(place.error);
  if (place.note) notes.push(place.note);

  const price = edit.set.price ?? null;
  const priceUnit = price == null ? null : (edit.set.priceUnit ?? "bottle");
  const currency = edit.set.currency ?? "CHF";
  const fields = {
    occasion: clean(edit.set.occasion),
    companions: clean(edit.set.companions),
    note: clean(edit.set.note),
  };
  const changes: EditChange[] = [{ label: "Jahrgang", before: DASH, after: yearText(edit.year) }];
  fieldChanges(
    changes,
    { tastedOn: null, place: DASH, price: null, occasion: null, companions: null, note: null },
    { tastedOn, place: place.label, price: encounterPrice({ price, price_unit: priceUnit, currency }), ...fields },
  );
  if (edit.wantToBuy) diff(changes, "Kaufen?", yesNo(wine.want_to_buy), yesNo(true));
  for (const r of ratings) changes.push({ label: `Bewertung ${persons.find((p) => p.id === r.personId)!.name}`, before: DASH, after: stars(r.rating) });

  // Alles oder nichts: Wein (falls neu), Ort (falls neu), Eintrag und Bewertungen. Schlägt ein
  // Schritt fehl, wird das bereits Angelegte in umgekehrter Reihenfolge wieder entfernt.
  const save = async () => {
    const undo: Undo[] = [];
    try {
      let wineId = wine.id;
      if (!wineId) {
        const { data, error } = await db.from("wines").insert({ ...newWine!, want_to_buy: edit.wantToBuy ?? false }).select("id").single();
        if (error) throw error;
        const id = data.id;
        undo.push(() => db.from("wines").delete().eq("id", id));
        wineId = id;
      } else if (edit.wantToBuy && !wine.want_to_buy) {
        const { error } = await db.from("wines").update({ want_to_buy: true }).eq("id", wineId);
        if (error) throw error;
        const id = wineId;
        undo.push(() => db.from("wines").update({ want_to_buy: false }).eq("id", id));
      }
      const resolved = await place.resolve();
      if (resolved.created) undo.push(() => db.from("places").delete().eq("id", resolved.id!));
      const { data: encounter, error } = await db
        .from("wine_encounters")
        .insert({
          wine_id: wineId,
          vintage_year: edit.year,
          tasted_on: tastedOn,
          place_id: resolved.id,
          price,
          price_unit: priceUnit,
          currency,
          ...fields,
          person_id: edit.personId,
          source: edit.source,
        })
        .select("id")
        .single();
      if (error) throw error;
      undo.push(() => db.from("wine_encounters").delete().eq("id", encounter.id));
      if (ratings.length) {
        const { data: inserted, error: rError } = await db
          .from("wine_ratings")
          .insert(
            ratings.map((r) => ({
              wine_id: wineId,
              vintage_year: edit.year,
              person_id: r.personId,
              rating: r.rating,
              rated_at: tastedOn,
              encounter_id: encounter.id,
              source: edit.source === "bot" ? "bot" : "manual",
            })),
          )
          .select("id");
        if (rError) throw rError;
        if ((inserted?.length ?? 0) !== ratings.length) throw new Error("Bewertungen nicht vollständig gespeichert");
        undo.push(() => db.from("wine_ratings").delete().eq("encounter_id", encounter.id));
      }
      return wineId;
    } catch (error) {
      console.error("encounter save failed", error);
      for (const step of undo.reverse()) {
        try {
          const { error: undoError } = await step();
          if (undoError) throw undoError;
        } catch (undoError) {
          console.error("encounter save: rollback failed", undoError);
        }
      }
      throw error;
    }
  };

  const prepared: PreparedEdit = ready(
    { title: wineTitle(wine, edit.year), action: "Verkostet erfassen", changes, notes },
    wine.id,
    async () => {
      const wineId = await save();
      if (prepared.ok) prepared.wineId = wineId;
      const extra = ratings.length ? ` mit ${ratings.length === 1 ? "1 Bewertung" : `${ratings.length} Bewertungen`}` : "";
      return `${wineTitle(wine, edit.year)} als verkostet am ${date(tastedOn)} gespeichert${extra}`;
    },
    edit.year,
  );
  return prepared;
}

// ---------------------------------------------------------------------------
// Ändern, löschen, Merker

export async function prepareEncounter(db: Db, edit: Extract<Edit, { kind: "encounter" }>): Promise<PreparedEdit> {
  const e = await loadEncounter(db, edit.encounterId);
  if (!e) return fail("Diesen Eintrag gibt es nicht mehr.");
  const invalid = checkFields(edit.set);
  if (invalid) return fail(invalid);
  const set = edit.set;

  const update: Database["public"]["Tables"]["wine_encounters"]["Update"] = {};
  const changes: EditChange[] = [];
  const notes: string[] = [];
  if (set.year !== undefined) {
    diff(changes, "Jahrgang", yearText(e.vintage_year), yearText(set.year));
    update.vintage_year = set.year;
  }
  let place: Awaited<ReturnType<typeof describePlace>> | null = null;
  if (set.place !== undefined) {
    const samePlace = set.place != null && "placeId" in set.place && set.place.placeId === e.place_id;
    if (!samePlace && !(set.place == null && e.place_id == null)) {
      place = await describePlace(db, set.place);
      if ("error" in place) return fail(place.error);
      if (place.note) notes.push(place.note);
    }
  }
  const after = {
    tastedOn: set.tastedOn ?? e.tasted_on,
    place: place && !("error" in place) ? place.label : (placeLabel(e.place) ?? DASH),
    price: encounterPrice({
      price: set.price !== undefined ? set.price : e.price,
      price_unit:
        (set.price !== undefined ? set.price : e.price) == null ? null : (set.priceUnit !== undefined ? set.priceUnit : e.price_unit) ?? "bottle",
      currency: set.currency ?? e.currency,
    }),
    occasion: set.occasion !== undefined ? clean(set.occasion) : e.occasion,
    companions: set.companions !== undefined ? clean(set.companions) : e.companions,
    note: set.note !== undefined ? clean(set.note) : e.note,
  };
  fieldChanges(
    changes,
    {
      tastedOn: e.tasted_on,
      place: placeLabel(e.place) ?? DASH,
      price: encounterPrice(e),
      occasion: e.occasion,
      companions: e.companions,
      note: e.note,
    },
    after,
  );
  if (set.tastedOn !== undefined) update.tasted_on = set.tastedOn;
  if (set.price !== undefined || set.priceUnit !== undefined || set.currency !== undefined) {
    const price = set.price !== undefined ? set.price : e.price;
    update.price = price;
    update.price_unit = price == null ? null : ((set.priceUnit !== undefined ? set.priceUnit : e.price_unit) ?? "bottle");
    if (set.currency !== undefined) update.currency = set.currency;
  }
  for (const key of ["occasion", "companions", "note"] as const) if (set[key] !== undefined) update[key] = after[key];

  // Bewertungen dieses Eintrags
  const persons = await loadPersons(db);
  const { data: current, error: rError } = await db.from("wine_ratings").select("id, person_id, rating").eq("encounter_id", e.id);
  if (rError) throw rError;
  const ratingOps: { personId: string; rating: number | null; existing: string | null }[] = [];
  for (const r of edit.ratings ?? []) {
    const person = persons.find((p) => p.id === r.personId);
    if (!person) return fail("Diese Person gibt es nicht.");
    if (r.rating != null && !isValidRating(r.rating)) return fail("Bewertung: 0–5 Sterne in halben Schritten.");
    const existing = (current ?? []).find((c) => c.person_id === r.personId) ?? null;
    if ((existing?.rating ?? null) === r.rating) continue;
    diff(changes, `Bewertung ${person.name}`, stars(existing?.rating), r.rating == null ? "gelöscht" : stars(r.rating));
    ratingOps.push({ personId: r.personId, rating: r.rating, existing: existing?.id ?? null });
  }

  const year = update.vintage_year !== undefined ? update.vintage_year : e.vintage_year;
  const tastedOn = update.tasted_on ?? e.tasted_on;
  return ready(
    { title: `${wineTitle(e.wine, e.vintage_year)} · verkostet am ${date(e.tasted_on)}`, action: "Eintrag „Verkostet“ bearbeiten", changes, notes },
    e.wine_id,
    async () => {
      if (place && !("error" in place)) update.place_id = (await place.resolve()).id;
      if (Object.keys(update).length) {
        const { error } = await db.from("wine_encounters").update(update).eq("id", e.id);
        if (error) throw error;
      }
      // Jahrgang/Datum gelten auch für die Bewertungen des Eintrags.
      if (update.vintage_year !== undefined || update.tasted_on !== undefined) {
        const { error } = await db.from("wine_ratings").update({ vintage_year: year, rated_at: tastedOn }).eq("encounter_id", e.id);
        if (error) throw error;
      }
      for (const op of ratingOps) {
        const { error } =
          op.rating == null
            ? await db.from("wine_ratings").delete().eq("id", op.existing!)
            : op.existing
              ? await db.from("wine_ratings").update({ rating: op.rating }).eq("id", op.existing)
              : await db.from("wine_ratings").insert({
                  wine_id: e.wine_id,
                  vintage_year: year,
                  person_id: op.personId,
                  rating: op.rating,
                  rated_at: tastedOn,
                  encounter_id: e.id,
                  source: "manual",
                });
        if (error) throw error;
      }
      return "den Eintrag gespeichert";
    },
    year,
  );
}

export async function prepareDeleteEncounter(db: Db, encounterId: string): Promise<PreparedEdit> {
  const e = await loadEncounter(db, encounterId);
  if (!e) return fail("Diesen Eintrag gibt es nicht mehr.");
  const [ratings, tastings] = await Promise.all([
    db.from("wine_ratings").select("id", { count: "exact", head: true }).eq("encounter_id", e.id),
    db.from("wine_tastings").select("id", { count: "exact", head: true }).eq("encounter_id", e.id),
  ]);
  if (ratings.error) throw ratings.error;
  if (tastings.error) throw tastings.error;
  const nRatings = ratings.count ?? 0;
  const nTastings = tastings.count ?? 0;
  const notes = [
    `Wird endgültig gelöscht${nRatings ? ` – samt ${nRatings === 1 ? "1 Bewertung" : `${nRatings} Bewertungen`} dieses Eintrags` : ""}.`,
    ...(nTastings ? [`${nTastings === 1 ? "Die WSET-Verkostung bleibt" : `Die ${nTastings} WSET-Verkostungen bleiben`} erhalten (ohne Eintrag).`] : []),
  ];
  return ready(
    {
      title: `${wineTitle(e.wine, e.vintage_year)} · verkostet am ${date(e.tasted_on)}${e.place ? ` · ${e.place.name}` : ""}`,
      action: "Eintrag „Verkostet“ löschen",
      changes: [],
      notes,
    },
    e.wine_id,
    async () => {
      const { error: rError } = await db.from("wine_ratings").delete().eq("encounter_id", e.id);
      if (rError) throw rError;
      const { error } = await db.from("wine_encounters").delete().eq("id", e.id);
      if (error) throw error;
      return "den Eintrag gelöscht";
    },
    e.vintage_year,
  );
}

export async function prepareWantToBuy(db: Db, wineId: string, value: boolean): Promise<PreparedEdit> {
  const wine = await loadWine(db, wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  const changes: EditChange[] = [];
  diff(changes, "Kaufen?", yesNo(wine.want_to_buy), yesNo(value));
  return ready({ title: wineTitle(wine), action: "Merker „Kaufen?“", changes, notes: [] }, wine.id, async () => {
    const { error } = await db.from("wines").update({ want_to_buy: value }).eq("id", wine.id);
    if (error) throw error;
    return value ? "den Merker „Kaufen?“ gesetzt" : "den Merker „Kaufen?“ entfernt";
  });
}
