// Formulare der Weinseite → Bearbeitungen (rein, ohne DB). Nur Felder, die im Formular
// stehen, werden übernommen; leere Felder heissen „leeren“ (null). Geprüft wird im Modul.

import { parsePrice } from "@/lib/format";
import {
  CURRENCIES,
  PLACE_KINDS,
  PRICE_UNITS,
  ROOMS,
  type BatchChanges,
  type Currency,
  type Edit,
  type EncounterChanges,
  type PlaceKind,
  type PlaceRef,
  type PriceUnit,
  type Room,
  type WineChanges,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FormError extends Error {}

function reader(form: FormData) {
  const has = (name: string) => form.has(name);
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const id = (name: string) => {
    const v = text(name);
    if (!UUID_RE.test(v)) throw new FormError("Ungültige Angabe.");
    return v;
  };
  /** "" → null; ganze Zahl, sonst Fehler. */
  const int = (name: string, label: string) => {
    const v = text(name).replace(/['’\s]/g, "");
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new FormError(`${label}: bitte eine ganze Zahl.`);
    return n;
  };
  /** Jahrgang: "" oder „NV“ → ohne Jahrgang. */
  const year = (name: string) => (/^(nv|ohne)?$/i.test(text(name)) ? null : int(name, "Jahrgang"));
  const decimal = (name: string, label: string) => {
    const v = text(name).replace(",", ".").replace(/[%\s]/g, "");
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new FormError(`${label}: bitte eine Zahl.`);
    return n;
  };
  const price = (name: string, label: string) => {
    const v = text(name);
    if (v === "") return null;
    const p = parsePrice(v);
    if (p == null) throw new FormError(`${label}: bitte einen Preis wie 24.50 oder leer lassen.`);
    return p;
  };
  return { has, text, id, int, year, decimal, price };
}

/** Jahrgang beim Verkostet-Erfassen: Pflicht – Zahl oder Häkchen „Ohne Jahrgang (NV)“. */
function requiredYear(r: ReturnType<typeof reader>) {
  if (r.has("nv")) return null;
  if (r.text("year") === "") throw new FormError("Jahrgang fehlt – Jahreszahl eintragen oder „Ohne Jahrgang (NV)“ wählen.");
  return r.year("year");
}

/** Ort: „“ = ohne, „new“ = neu (Name, Art, Stadt), sonst die ID eines bestehenden. */
function placeRef(r: ReturnType<typeof reader>): PlaceRef {
  const mode = r.text("place");
  if (mode === "") return null;
  if (mode === "new") {
    const kind = r.text("placeKind");
    if (kind && !(PLACE_KINDS as readonly string[]).includes(kind)) throw new FormError("Ort: unbekannte Art.");
    return { name: r.text("placeName"), kind: (kind || null) as PlaceKind | null, city: r.text("placeCity") || null };
  }
  return { placeId: r.id("place") };
}

/** Datum, Ort, Preis, Anlass, Begleitung, Notiz – nur Felder, die im Formular stehen. */
function encounterFields(r: ReturnType<typeof reader>): Omit<EncounterChanges, "year"> {
  const set: Omit<EncounterChanges, "year"> = {};
  if (r.has("tastedOn")) set.tastedOn = r.text("tastedOn");
  if (r.has("place")) set.place = placeRef(r);
  if (r.has("price")) set.price = r.price("price", "Preis");
  if (r.has("priceUnit")) {
    const unit = r.text("priceUnit");
    if (unit && !(PRICE_UNITS as readonly string[]).includes(unit)) throw new FormError("Preis: pro Flasche oder pro Glas?");
    set.priceUnit = (unit || null) as PriceUnit | null;
  }
  if (r.has("currency")) {
    const currency = r.text("currency");
    if (!(CURRENCIES as readonly string[]).includes(currency)) throw new FormError(`Währung: ${CURRENCIES.join(", ")}.`);
    set.currency = currency as Currency;
  }
  for (const key of ["occasion", "companions", "note"] as const) if (r.has(key)) set[key] = r.text(key) || null;
  return set;
}

/** Bewertungen „rating:<personId>“ – leer = keine (beim Bearbeiten: löschen). */
function ratingFields(form: FormData) {
  const out: { personId: string; rating: number | null }[] = [];
  for (const [key, value] of form.entries()) {
    const m = key.match(/^rating:([0-9a-f-]{36})$/i);
    if (!m) continue;
    const v = String(value).trim().replace(",", ".");
    const rating = v === "" ? null : Number(v);
    if (rating != null && !Number.isFinite(rating)) throw new FormError("Bewertung: bitte 0–5 Sterne.");
    out.push({ personId: m[1], rating });
  }
  return out;
}

/** Liest die Bearbeitung(en) eines Formulars (Feld „kind“). */
export function editsFromForm(form: FormData): Edit[] | { error: string } {
  const r = reader(form);
  try {
    switch (r.text("kind")) {
      case "wine": {
        const set: WineChanges = {};
        if (r.has("name")) set.name = r.text("name");
        if (r.has("producer")) set.producer = r.text("producer") || null;
        if (r.has("type")) set.type = (r.text("type") || null) as WineChanges["type"];
        for (const key of ["country", "region", "appellation"] as const) if (r.has(key)) set[key] = r.text(key) || null;
        if (r.has("alcohol")) set.alcohol = r.decimal("alcohol", "Alkohol");
        return [{ kind: "wine", wineId: r.id("wineId"), set }];
      }
      case "vintage": {
        const wineId = r.id("wineId");
        const from = r.year("from");
        const edits: Edit[] = [];
        if (r.has("drinkFrom") || r.has("drinkUntil")) {
          edits.push({ kind: "drinkWindow", wineId, year: from, from: r.int("drinkFrom", "Ab"), until: r.int("drinkUntil", "Bis") });
        }
        // Jahrgang zuletzt: danach heisst der Jahrgang anders.
        if (r.has("to")) edits.push({ kind: "vintage", wineId, from, to: r.year("to") });
        return edits;
      }
      case "batch": {
        const itemId = r.id("itemId");
        const set: BatchChanges = {};
        if (r.has("quantity")) set.quantity = r.int("quantity", "Anzahl") ?? 0;
        if (r.has("bottleSize")) {
          const cl = r.decimal("bottleSize", "Flaschengrösse");
          if (cl == null) throw new FormError("Flaschengrösse fehlt.");
          set.bottleSizeMl = Math.round(cl * 10);
        }
        if (r.has("purchasedAt")) set.purchasedAt = r.text("purchasedAt") || null;
        if (r.has("vendor")) set.vendor = r.text("vendor") || null;
        if (r.has("giftField")) set.isGift = r.has("isGift");
        if (r.has("purchasePrice")) set.purchasePrice = r.price("purchasePrice", "Bezahlt");
        if (r.has("regularPrice")) set.regularPrice = r.price("regularPrice", "Normalpreis");
        const edits: Edit[] = [{ kind: "batch", itemId, set }];
        if (r.has("room") && r.text("room") !== r.text("roomBefore")) {
          const room = r.text("room") as Room;
          if (!ROOMS.includes(room)) throw new FormError("Bitte einen Lagerort wählen.");
          edits.push({ kind: "move", itemId, room, count: r.int("moveCount", "Anzahl verschieben") ?? undefined });
        }
        if (r.has("vintage") && r.text("vintage") !== r.text("vintageBefore")) {
          edits.push({ kind: "batchVintage", itemId, to: r.year("vintage") });
        }
        // Offene bzw. getrunkene Flasche: deren Felder im selben Formular (ein „Speichern“).
        if (r.has("fill") || r.has("openedOn")) {
          const fill = r.int("fill", "Füllstand");
          const openedOn = r.text("openedOn");
          edits.push({ kind: "openBottle", itemId, ...(fill != null ? { fill } : {}), ...(openedOn ? { openedOn } : {}) });
        }
        if (r.has("reopen")) edits.push({ kind: "reopen", itemId, fill: r.int("reopenFill", "Füllstand") ?? 0 });
        else if (r.has("drunkOn")) edits.push({ kind: "drunkBottle", itemId, drunkOn: r.text("drunkOn") });
        return edits;
      }
      case "deleteBatch":
        return [{ kind: "deleteBatch", itemId: r.id("itemId") }];
      case "deleteBottles": {
        const count = r.has("count") ? r.int("count", "Anzahl") : null;
        return [{ kind: "deleteBottles", itemId: r.id("itemId"), ...(count != null ? { count } : {}) }];
      }
      case "deleteWine":
        return [{ kind: "deleteWine", wineId: r.id("wineId"), confirmName: r.text("confirmName") }];
      case "openBottle": {
        const fill = r.int("fill", "Füllstand");
        const openedOn = r.text("openedOn");
        return [{ kind: "openBottle", itemId: r.id("itemId"), ...(fill != null ? { fill } : {}), ...(openedOn ? { openedOn } : {}) }];
      }
      case "drunkBottle":
        return [{ kind: "drunkBottle", itemId: r.id("itemId"), drunkOn: r.text("drunkOn") }];
      case "reopen":
        return [{ kind: "reopen", itemId: r.id("itemId"), fill: r.int("fill", "Füllstand") ?? 0 }];
      case "addEncounter": {
        const year = requiredYear(r);
        const wine =
          r.text("wineMode") === "new"
            ? {
                new: {
                  name: r.text("newName"),
                  producer: r.text("newProducer") || null,
                  type: (r.text("newType") || null) as WineChanges["type"],
                  country: r.text("newCountry") || null,
                  region: r.text("newRegion") || null,
                  ...(r.has("forceNew") ? { forceNew: true } : {}),
                },
              }
            : { wineId: r.id("wineId") };
        const ratings = ratingFields(form).filter((x): x is { personId: string; rating: number } => x.rating != null);
        return [
          {
            kind: "addEncounter",
            wine,
            year,
            set: encounterFields(r),
            // Wer erfasst, setzt die Server Action aus der Anmeldung (nicht aus dem Formular).
            personId: null,
            source: "app",
            wantToBuy: r.has("wantToBuy"),
            ratings,
          },
        ];
      }
      case "encounter": {
        const set: EncounterChanges = encounterFields(r);
        if (r.has("year") || r.has("nv")) set.year = requiredYear(r);
        return [{ kind: "encounter", encounterId: r.id("encounterId"), set, ratings: ratingFields(form) }];
      }
      case "deleteEncounter":
        return [{ kind: "deleteEncounter", encounterId: r.id("encounterId") }];
      case "wantToBuy":
        return [{ kind: "wantToBuy", wineId: r.id("wineId"), value: r.text("value") === "1" }];
      default:
        return { error: "Unbekannte Bearbeitung." };
    }
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
}
