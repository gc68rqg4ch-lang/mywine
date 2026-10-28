import "server-only";

// Chat-Werkzeuge zum Bearbeiten: lesen (get_wine_details, list_batches) und vorschlagen.
// Jeder Vorschlag läuft durch prepareEdit des gemeinsamen Moduls (gleiche Prüfungen wie
// in der App) und wird erst nach [Ja] ausgeführt. Jahrgänge: 0 = ohne Jahrgang (NV) –
// so kommen die Schemas ohne nullable-Felder aus (Grenze von 16 Union-Feldern).

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { WINE_TYPES, formatBottleSize, wineTypeLabel, zurichDate } from "@/lib/format";
import { prepareEdit } from "@/lib/edit/edit";
import { CURRENCIES, PRICE_UNITS, ROOMS, previewLines, type BatchChanges, type Edit, type EncounterChanges, type WineChanges } from "@/lib/edit/types";
import { EMPTY_WINE_QUESTION, wouldLeaveEmptyWine } from "@/lib/edit/encounters";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import type { AdminClient } from "@/lib/supabase/admin";
import { fillAfterGlasses, type Proposal } from "./proposals";
import type { EditAlternative, PendingProposal } from "./tools";

const json = (value: unknown) => JSON.stringify(value);
const MAX_PENDING = 3;

/** 0 = ohne Jahrgang */
const yearParam = (v: number) => (v === 0 ? null : v);
const vintageSchema = z.number().int().min(0).max(2100).describe("Jahrgang; 0 = ohne Jahrgang (NV)");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Datum YYYY-MM-DD");

type Actor = { personId: string | null; name: string } | null;

/** Person aus dem Namen; ohne Namen die Person, die schreibt. */
export async function resolvePerson(db: AdminClient, actor: Actor, name?: string) {
  const { data, error } = await db.from("persons").select("id, name").order("sort_order");
  if (error) throw error;
  const persons = data ?? [];
  const wanted = name?.trim();
  const match = wanted
    ? persons.find((p) => p.name.toLowerCase() === wanted.toLowerCase())
    : (persons.find((p) => p.id === actor?.personId) ?? persons.find((p) => p.name === actor?.name));
  return { match, names: persons.map((p) => p.name) };
}

export function editTools(db: AdminClient, pending: PendingProposal[], actor: Actor) {
  const proposeEdit = async (edit: Edit) => {
    if (pending.length >= MAX_PENDING) return "Zu viele Vorschläge auf einmal – erst die offenen bestätigen lassen.";
    const prepared = await prepareEdit(db, edit);
    if (!prepared.ok) return `Nicht möglich: ${prepared.error} Sag das der Person in deinen Worten.`;
    const text = previewLines(prepared.preview).join(" · ");
    pending.push({ edit, preview: prepared.preview, text });
    return `Vorschlag wird mit vorher → nachher und [Ja] [Nein] angezeigt: ${text}. Noch ist nichts geändert – nicht als erledigt bezeichnen, höchstens kurz ankündigen.`;
  };
  const proposeQuick = (proposal: Proposal, text: string) => {
    if (pending.length >= MAX_PENDING) return "Zu viele Vorschläge auf einmal – erst die offenen bestätigen lassen.";
    pending.push({ proposal, text });
    return `Vorschlag „${text}“ wird mit [Ja] [Nein] angezeigt. Noch ist nichts geändert.`;
  };

  return [
    betaZodTool({
      name: "get_wine_details",
      description:
        "Stammdaten eines Weins (Name, Produzent, Typ, Herkunft, Alkohol), je Jahrgang: Trinkfenster, Rebsorten mit %, Bewertungen je Person und Verkostungen (mit tasting_id), dazu die abgelegten Dokumente (PDF, Jahrgang 0 = für alle). Vor jedem Bearbeiten aufrufen, um den aktuellen Stand zu kennen.",
      inputSchema: z.object({ wine_id: z.uuid() }),
      run: async ({ wine_id }) => {
        const [wine, items, vintages, ratings, tastings, docs] = await Promise.all([
          db.from("wines").select("name, producer, type, country, region, appellation, alcohol_content").eq("id", wine_id).maybeSingle(),
          db.from("inventory_items").select("vintage_year").eq("wine_id", wine_id),
          db.from("wine_vintages").select("vintage_year, drink_from_year, drink_until_year").eq("wine_id", wine_id),
          db.from("latest_wine_ratings").select("vintage_year, person_name, rating, rated_at").eq("wine_id", wine_id),
          db.from("wine_tastings").select("id, vintage_year, tasted_at, quality_level, quality_points, notes, person:persons(name)").eq("wine_id", wine_id).order("tasted_at", { ascending: false }),
          db.from("wine_media").select("vintage_year, file_name").eq("wine_id", wine_id).eq("kind", "document"),
        ]);
        for (const r of [wine, items, vintages, ratings, tastings, docs]) if (r.error) throw r.error;
        if (!wine.data) return "Fehler: Wein nicht gefunden.";
        const years = [...new Set([...(items.data ?? []), ...(vintages.data ?? [])].map((r) => r.vintage_year))];
        const perYear = await Promise.all(
          years.map(async (year) => {
            const window = (vintages.data ?? []).find((v) => v.vintage_year === year);
            const grapes = await loadGrapeShares(db, wine_id, year);
            return {
              vintage_year: year ?? 0,
              drink_window: window ? `${window.drink_from_year ?? "?"}–${window.drink_until_year ?? "?"}` : null,
              grapes: grapes ? `${formatShares(grapes.shares)}${grapes.vintageYear == null ? " (für alle Jahrgänge)" : ""}` : null,
              ratings: (ratings.data ?? []).filter((r) => r.vintage_year === year).map((r) => ({ person: r.person_name, rating: r.rating, rated_at: r.rated_at })),
              tastings: (tastings.data ?? []).filter((t) => t.vintage_year === year).map((t) => ({
                tasting_id: t.id,
                tasted_at: t.tasted_at,
                person: t.person?.name ?? null,
                quality: t.quality_level,
                points: t.quality_points,
                notes: t.notes,
              })),
            };
          }),
        );
        const documents = (docs.data ?? []).map((d) => ({ vintage_year: d.vintage_year ?? 0, file_name: d.file_name }));
        return json({ wine_id, ...wine.data, type: wineTypeLabel(wine.data.type), vintages: perYear, documents });
      },
    }),

    betaZodTool({
      name: "list_batches",
      description:
        "Alle Chargen/Flaschen eines Weins mit inventory_item_id: ungeöffnete Chargen (Anzahl, Lagerort, Grösse, Kaufdatum, Händler, Geschenk, Preise), offene Flaschen (Füllstand, geöffnet am) und getrunkene (getrunken am). Für jede Bearbeitung einer Charge oder Flasche nötig; passen mehrere, die Person fragen.",
      inputSchema: z.object({ wine_id: z.uuid(), vintage_year: vintageSchema.optional().describe("Nur dieser Jahrgang; 0 = ohne Jahrgang; weglassen = alle") }),
      run: async ({ wine_id, vintage_year }) => {
        let q = db
          .from("cellar_overview")
          .select("inventory_item_id, vintage_year, status, quantity, storage_room, bottle_size_ml, purchased_at, vendor_name, is_gift, purchase_price, regular_price, fill_level_percent, date_opened, drunk_at")
          .eq("wine_id", wine_id);
        if (vintage_year !== undefined) q = vintage_year === 0 ? q.is("vintage_year", null) : q.eq("vintage_year", vintage_year);
        const { data, error } = await q.order("vintage_year").order("status");
        if (error) throw error;
        return json(
          (data ?? []).map((r) => ({
            inventory_item_id: r.inventory_item_id,
            vintage_year: r.vintage_year ?? 0,
            status: r.status === "sealed" ? "ungeöffnet" : r.status === "open" ? "offen" : "getrunken",
            bottles: r.status === "sealed" ? r.quantity : 1,
            room: r.status === "drunk" ? null : (r.storage_room ?? "ohne Lagerort"),
            size: formatBottleSize(r.bottle_size_ml ?? 750),
            purchased_at: r.purchased_at,
            vendor: r.vendor_name,
            gift: r.is_gift,
            paid_chf: r.purchase_price,
            regular_chf: r.regular_price,
            ...(r.status === "open" ? { fill_percent: r.fill_level_percent, opened_on: r.date_opened } : {}),
            ...(r.status === "drunk" ? { drunk_on: zurichDate(r.drunk_at) } : {}),
          })),
        );
      },
    }),

    betaZodTool({
      name: "propose_wine_edit",
      description:
        "Schlägt Änderungen an den Stammdaten eines Weins vor (gelten für alle Jahrgänge). Nur Felder angeben, die sich ändern; clear leert Felder.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        name: z.string().min(1).max(200).optional(),
        producer: z.string().min(1).max(200).optional(),
        type: z.enum(WINE_TYPES).optional(),
        country: z.string().max(80).optional(),
        region: z.string().max(120).optional(),
        appellation: z.string().max(160).optional(),
        alcohol_content: z.number().min(0).max(25).optional().describe("% vol"),
        clear: z.array(z.enum(["type", "country", "region", "appellation", "alcohol_content"])).optional(),
      }),
      run: async ({ wine_id, clear = [], alcohol_content, ...fields }) => {
        const set: WineChanges = { ...fields };
        if (alcohol_content !== undefined) set.alcohol = alcohol_content;
        for (const c of clear) {
          if (c === "alcohol_content") set.alcohol = null;
          else set[c] = null;
        }
        return proposeEdit({ kind: "wine", wineId: wine_id, set });
      },
    }),

    betaZodTool({
      name: "propose_vintage_change",
      description:
        "Schlägt vor, den Jahrgang zu korrigieren. Ohne inventory_item_id: der ganze Jahrgang samt Bewertungen, Verkostungen, Trinkfenster, Rebsorten, Fotos (gibt es den Ziel-Jahrgang schon, wird zusammengeführt). Mit inventory_item_id: nur diese Charge.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        from_year: vintageSchema.describe("Bisheriger Jahrgang; 0 = ohne Jahrgang"),
        to_year: vintageSchema.describe("Neuer Jahrgang; 0 = ohne Jahrgang (NV)"),
        inventory_item_id: z.uuid().optional().describe("Nur diese Charge (aus list_batches)"),
      }),
      run: async ({ wine_id, from_year, to_year, inventory_item_id }) =>
        inventory_item_id
          ? proposeEdit({ kind: "batchVintage", itemId: inventory_item_id, to: yearParam(to_year) })
          : proposeEdit({ kind: "vintage", wineId: wine_id, from: yearParam(from_year), to: yearParam(to_year) }),
    }),

    betaZodTool({
      name: "propose_drink_window",
      description: "Schlägt ein neues Trinkfenster (trinkreif ab/bis, Jahreszahlen) für Wein + Jahrgang vor. Weggelassen = bleibt; 0 = leeren.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: vintageSchema,
        from_year: z.number().int().min(0).max(2200).optional(),
        until_year: z.number().int().min(0).max(2200).optional(),
      }),
      run: async ({ wine_id, vintage_year, from_year, until_year }) => {
        const year = yearParam(vintage_year);
        let q = db.from("wine_vintages").select("drink_from_year, drink_until_year").eq("wine_id", wine_id);
        q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
        const { data, error } = await q.maybeSingle();
        if (error) throw error;
        const pick = (v: number | undefined, current: number | null | undefined) => (v === undefined ? (current ?? null) : v === 0 ? null : v);
        return proposeEdit({
          kind: "drinkWindow",
          wineId: wine_id,
          year,
          from: pick(from_year, data?.drink_from_year),
          until: pick(until_year, data?.drink_until_year),
        });
      },
    }),

    betaZodTool({
      name: "propose_batch_edit",
      description:
        "Schlägt Änderungen an einer Charge vor: Anzahl (nur ungeöffnet), Flaschengrösse, Kaufdatum, Händler, Geschenk, bezahlter Preis, Normalpreis (CHF pro Flasche). Nur geänderte Felder angeben; clear leert Felder. Für Lagerort propose_move, für den Jahrgang propose_vintage_change.",
      inputSchema: z.object({
        inventory_item_id: z.uuid().describe("Aus list_batches"),
        quantity: z.number().int().min(1).max(999).optional(),
        bottle_size_ml: z.number().int().min(100).max(30000).optional(),
        purchased_at: dateSchema.optional(),
        vendor: z.string().min(1).max(120).optional().describe("Händlername; neue werden angelegt"),
        is_gift: z.boolean().optional(),
        purchase_price: z.number().min(0).max(99999).optional(),
        regular_price: z.number().min(0).max(99999).optional(),
        clear: z.array(z.enum(["purchased_at", "vendor", "purchase_price", "regular_price"])).optional(),
      }),
      run: async ({ inventory_item_id, quantity, bottle_size_ml, purchased_at, vendor, is_gift, purchase_price, regular_price, clear = [] }) => {
        const set: BatchChanges = {};
        if (quantity !== undefined) set.quantity = quantity;
        if (bottle_size_ml !== undefined) set.bottleSizeMl = bottle_size_ml;
        if (purchased_at !== undefined) set.purchasedAt = purchased_at;
        if (vendor !== undefined) set.vendor = vendor;
        if (is_gift !== undefined) set.isGift = is_gift;
        if (purchase_price !== undefined) set.purchasePrice = purchase_price;
        if (regular_price !== undefined) set.regularPrice = regular_price;
        if (clear.includes("purchased_at")) set.purchasedAt = null;
        if (clear.includes("vendor")) set.vendor = null;
        if (clear.includes("purchase_price")) set.purchasePrice = null;
        if (clear.includes("regular_price")) set.regularPrice = null;
        return proposeEdit({ kind: "batch", itemId: inventory_item_id, set });
      },
    }),

    betaZodTool({
      name: "propose_move",
      description: "Schlägt vor, Flaschen an einen anderen Lagerort zu verschieben – die ganze Charge oder mit count nur einen Teil.",
      inputSchema: z.object({
        inventory_item_id: z.uuid().describe("Aus list_batches"),
        room: z.enum(ROOMS),
        count: z.number().int().min(1).max(999).optional().describe("Nur so viele Flaschen; weglassen = alle"),
      }),
      run: async ({ inventory_item_id, room, count }) => proposeEdit({ kind: "move", itemId: inventory_item_id, room, count }),
    }),

    betaZodTool({
      name: "propose_delete_bottles",
      description:
        "Schlägt vor, Flaschen unwiderruflich zu löschen (falsch erfasst) – ganze Charge/Flasche oder mit count nur einen Teil. Wird im Journal als gelöscht vermerkt, nicht als getrunken. Nicht für Austrinken – dafür propose_mark_drunk.",
      inputSchema: z.object({
        inventory_item_id: z.uuid().describe("Aus list_batches"),
        count: z.number().int().min(1).max(999).optional().describe("Nur so viele Flaschen; weglassen = alle"),
      }),
      run: async ({ inventory_item_id, count }) => proposeEdit({ kind: "deleteBottles", itemId: inventory_item_id, count }),
    }),

    betaZodTool({
      name: "propose_delete_wine",
      description:
        "Schlägt vor, einen Wein mit allem (Flaschen, Bewertungen, Verkostungen, Verkostet-Einträge, Fotos, PDFs) unwiderruflich zu löschen. Nur auf ausdrücklichen Wunsch.",
      inputSchema: z.object({ wine_id: z.uuid() }),
      run: async ({ wine_id }) => proposeEdit({ kind: "deleteWine", wineId: wine_id }),
    }),

    betaZodTool({
      name: "propose_open_bottle_edit",
      description:
        "Offene Flasche bearbeiten: Füllstand (percent = neuer Stand oder glasses = getrunkene Gläser à 150 ml) und/oder „Geöffnet am“. Wird sie dabei leer, wird „ausgetrunken“ vorgeschlagen.",
      inputSchema: z.object({
        inventory_item_id: z.uuid().describe("Aus list_open_bottles oder list_batches"),
        percent: z.number().int().min(0).max(100).optional(),
        glasses: z.number().min(0.5).max(20).optional(),
        opened_on: dateSchema.optional(),
      }),
      run: async ({ inventory_item_id, percent, glasses, opened_on }) => {
        if (percent != null && glasses != null) return "Fehler: entweder percent oder glasses angeben, nicht beides.";
        let fill = percent;
        if (glasses != null) {
          const { data: r, error } = await db
            .from("cellar_overview")
            .select("status, bottle_size_ml, fill_level_percent, producer, name, vintage_year")
            .eq("inventory_item_id", inventory_item_id)
            .maybeSingle();
          if (error) throw error;
          if (r?.status !== "open") return "Fehler: Diese Flasche ist nicht offen. Prüfe list_open_bottles.";
          fill = fillAfterGlasses(r.fill_level_percent ?? 100, glasses, r.bottle_size_ml ?? 750);
        }
        if (fill === 0) {
          return proposeQuick({ kind: "drunk", itemId: inventory_item_id }, "Die Flasche ist danach leer – als ausgetrunken markieren");
        }
        if (fill === undefined && opened_on === undefined) return "Fehler: percent, glasses oder opened_on angeben.";
        return proposeEdit({ kind: "openBottle", itemId: inventory_item_id, ...(fill !== undefined ? { fill } : {}), ...(opened_on ? { openedOn: opened_on } : {}) });
      },
    }),

    betaZodTool({
      name: "propose_drunk_bottle_edit",
      description: "Getrunkene Flasche bearbeiten: „Getrunken am“ ändern oder mit reopen wieder auf offen setzen (mit Füllstand, Standard 50 %).",
      inputSchema: z.object({
        inventory_item_id: z.uuid().describe("Aus list_batches (status getrunken)"),
        drunk_on: dateSchema.optional(),
        reopen: z.boolean().optional(),
        fill_percent: z.number().int().min(1).max(100).optional(),
      }),
      run: async ({ inventory_item_id, drunk_on, reopen, fill_percent }) => {
        if (reopen) return proposeEdit({ kind: "reopen", itemId: inventory_item_id, fill: fill_percent ?? 50 });
        if (!drunk_on) return "Fehler: drunk_on oder reopen angeben.";
        return proposeEdit({ kind: "drunkBottle", itemId: inventory_item_id, drunkOn: drunk_on });
      },
    }),

    betaZodTool({
      name: "propose_grapes",
      description:
        "Schlägt die Rebsorten mit Anteilen in % für Wein + Jahrgang vor (ersetzt die bisherigen dieses Jahrgangs). Anteil weglassen, wenn unbekannt; zusammen höchstens 100 %.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: vintageSchema.describe("Jahrgang; 0 = ohne Jahrgang bzw. für alle Jahrgänge"),
        grapes: z.array(z.object({ grape: z.string().min(1).max(80), percent: z.number().min(0.5).max(100).optional() })).min(1).max(15),
      }),
      run: async ({ wine_id, vintage_year, grapes }) =>
        proposeEdit({
          kind: "grapes",
          wineId: wine_id,
          year: yearParam(vintage_year),
          shares: grapes.map((g) => ({ grape: g.grape, percent: g.percent ?? null })),
        }),
    }),

    betaZodTool({
      name: "propose_delete_rating",
      description: "Schlägt vor, die Bewertung einer Person für Wein + Jahrgang zu löschen (samt früherer Bewertungen). Ändern: propose_rating.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: vintageSchema,
        person: z.string().optional().describe("Nur wenn ausdrücklich eine andere Person gemeint ist; sonst die Person, die schreibt"),
      }),
      run: async ({ wine_id, vintage_year, person }) => {
        const { match, names } = await resolvePerson(db, actor, person);
        if (!match) return `Fehler: Unbekannte Person. Möglich: ${names.join(", ")}.`;
        return proposeEdit({ kind: "rating", wineId: wine_id, year: yearParam(vintage_year), personId: match.id, rating: null });
      },
    }),

    betaZodTool({
      name: "propose_tasting_edit",
      description: "Schlägt Änderungen an einer WSET-Verkostung vor: Datum, Person, Notizen. tasting_id aus get_wine_details oder get_tastings.",
      inputSchema: z.object({
        tasting_id: z.uuid(),
        tasted_on: dateSchema.optional(),
        person: z.string().optional().describe("Michel oder Sara"),
        notes: z.string().max(2000).optional().describe("Neuer Notiztext; leerer Text leert die Notizen"),
      }),
      run: async ({ tasting_id, tasted_on, person, notes }) => {
        const set: Extract<Edit, { kind: "tasting" }>["set"] = {};
        if (tasted_on) set.tastedOn = tasted_on;
        if (notes !== undefined) set.notes = notes;
        if (person) {
          const { match, names } = await resolvePerson(db, actor, person);
          if (!match) return `Fehler: Unbekannte Person. Möglich: ${names.join(", ")}.`;
          set.personId = match.id;
        }
        return proposeEdit({ kind: "tasting", tastingId: tasting_id, set });
      },
    }),

    betaZodTool({
      name: "propose_delete_tasting",
      description: "Schlägt vor, eine WSET-Verkostung zu löschen.",
      inputSchema: z.object({ tasting_id: z.uuid() }),
      run: async ({ tasting_id }) => proposeEdit({ kind: "deleteTasting", tastingId: tasting_id }),
    }),

    // --- Verkostet (wine_encounters) ---------------------------------------------------

    betaZodTool({
      name: "list_encounters",
      description:
        "Einträge „Verkostet“ (Wein irgendwo probiert, nicht im Bestand) mit encounter_id, Datum, Ort, Preis, Anlass, Begleitung, Notiz, Sterne. Ohne wine_id die letzten über alle Weine.",
      inputSchema: z.object({
        wine_id: z.uuid().optional(),
        limit: z.number().int().min(1).max(30).optional().describe("Standard 10"),
      }),
      run: async ({ wine_id, limit }) => {
        let q = db
          .from("wine_encounters")
          .select("id, wine_id, vintage_year, tasted_on, price, price_unit, currency, occasion, companions, note, place:places(name), wine:wines(name, producer, want_to_buy)")
          .order("tasted_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(limit ?? 10);
        if (wine_id) q = q.eq("wine_id", wine_id);
        const { data, error } = await q;
        if (error) throw error;
        const ids = (data ?? []).map((e) => e.id);
        const { data: ratings } = ids.length
          ? await db.from("wine_ratings").select("encounter_id, rating, person:persons(name)").in("encounter_id", ids)
          : { data: [] };
        return json(
          (data ?? []).map((e) => ({
            encounter_id: e.id,
            wine_id: e.wine_id,
            wine: [e.wine?.producer, e.wine?.name].filter(Boolean).join(" "),
            vintage_year: e.vintage_year ?? "ohne Jahrgang",
            tasted_on: e.tasted_on,
            place: e.place?.name ?? null,
            price: e.price != null ? `${e.price} ${e.currency}${e.price_unit === "glass" ? " pro Glas" : " pro Flasche"}` : null,
            occasion: e.occasion,
            companions: e.companions,
            note: e.note,
            ratings: (ratings ?? []).filter((r) => r.encounter_id === e.id).map((r) => `${r.person?.name ?? "?"} ${r.rating}`),
            want_to_buy: e.wine?.want_to_buy ?? false,
          })),
        );
      },
    }),

    betaZodTool({
      name: "propose_add_encounter",
      description:
        "Schlägt einen Eintrag „Verkostet“ zu einem bekannten Wein vor (wine_id aus search_cellar oder list_encounters). Für einen Bericht über einen neu probierten Wein lieber start_wine_entry mit intent tasted.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: vintageSchema,
        tasted_on: dateSchema.optional().describe("Standard heute"),
        place: z.string().min(1).max(120).optional().describe("Restaurant, Bar, Weingut oder bei wem"),
        price: z.number().min(0).max(100000).optional(),
        price_unit: z.enum(PRICE_UNITS).optional().describe("bottle = Flasche (Standard), glass = Glas"),
        currency: z.enum(CURRENCIES).optional().describe("Standard CHF"),
        occasion: z.string().max(500).optional(),
        companions: z.string().max(500).optional(),
        note: z.string().max(500).optional(),
        rating: z.number().min(0).max(5).optional().describe("Sterne der Person, die schreibt (halbe Schritte)"),
        want_to_buy: z.boolean().optional().describe("Merker „Kaufen?“ setzen"),
      }),
      run: async (input) =>
        proposeEdit({
          kind: "addEncounter",
          wine: { wineId: input.wine_id },
          year: yearParam(input.vintage_year),
          set: {
            ...(input.tasted_on ? { tastedOn: input.tasted_on } : {}),
            ...(input.place ? { place: { name: input.place, kind: null, city: null } } : {}),
            ...(input.price != null ? { price: input.price, priceUnit: input.price_unit ?? "bottle", currency: input.currency ?? "CHF" } : {}),
            ...(input.occasion ? { occasion: input.occasion } : {}),
            ...(input.companions ? { companions: input.companions } : {}),
            ...(input.note ? { note: input.note } : {}),
          },
          personId: actor?.personId ?? null,
          source: "bot",
          wantToBuy: input.want_to_buy ?? false,
          ratings: input.rating != null && actor?.personId ? [{ personId: actor.personId, rating: input.rating }] : [],
        }),
    }),

    betaZodTool({
      name: "propose_encounter_edit",
      description:
        "Schlägt Änderungen an einem Eintrag „Verkostet“ vor (encounter_id aus list_encounters). Nur angegebene Felder ändern sich; clear leert Felder. rating gilt für die Person, die schreibt (oder person).",
      inputSchema: z.object({
        encounter_id: z.uuid(),
        vintage_year: vintageSchema.optional(),
        tasted_on: dateSchema.optional(),
        place: z.string().min(1).max(120).optional(),
        price: z.number().min(0).max(100000).optional(),
        price_unit: z.enum(PRICE_UNITS).optional(),
        currency: z.enum(CURRENCIES).optional(),
        occasion: z.string().max(500).optional(),
        companions: z.string().max(500).optional(),
        note: z.string().max(500).optional(),
        rating: z.number().min(0).max(5).optional(),
        person: z.string().optional().describe("Nur wenn ausdrücklich eine andere Person bewertet"),
        clear: z.array(z.enum(["place", "price", "occasion", "companions", "note", "rating"])).optional(),
      }),
      run: async (input) => {
        const clear = input.clear ?? [];
        const set: EncounterChanges = {};
        if (input.vintage_year !== undefined) set.year = yearParam(input.vintage_year);
        if (input.tasted_on) set.tastedOn = input.tasted_on;
        if (input.place) set.place = { name: input.place, kind: null, city: null };
        if (clear.includes("place")) set.place = null;
        if (input.price != null) set.price = input.price;
        if (clear.includes("price")) set.price = null;
        if (input.price_unit) set.priceUnit = input.price_unit;
        if (input.currency) set.currency = input.currency;
        for (const key of ["occasion", "companions", "note"] as const) {
          if (input[key]) set[key] = input[key];
          if (clear.includes(key)) set[key] = null;
        }
        let ratings: { personId: string; rating: number | null }[] | undefined;
        if (input.rating != null || clear.includes("rating")) {
          const { match, names } = await resolvePerson(db, actor, input.person);
          if (!match) return `Fehler: Unbekannte Person. Möglich: ${names.join(", ")}.`;
          ratings = [{ personId: match.id, rating: clear.includes("rating") ? null : (input.rating ?? null) }];
        }
        return proposeEdit({ kind: "encounter", encounterId: input.encounter_id, set, ...(ratings ? { ratings } : {}) });
      },
    }),

    betaZodTool({
      name: "propose_delete_encounter",
      description:
        "Schlägt vor, einen Eintrag „Verkostet“ zu löschen (samt seinen Bewertungen). Bliebe der Wein danach leer zurück, frage ich zusätzlich, ob auch der Wein weg soll.",
      inputSchema: z.object({ encounter_id: z.uuid() }),
      run: async ({ encounter_id }) => {
        const result = await proposeEdit({ kind: "deleteEncounter", encounterId: encounter_id });
        const last = pending.at(-1);
        if (last && "edit" in last && last.edit.kind === "deleteEncounter" && last.edit.encounterId === encounter_id) {
          const alternative = await emptyWineAlternative(db, encounter_id);
          if (alternative) last.alternative = alternative;
        }
        return result;
      },
    }),

    betaZodTool({
      name: "propose_want_to_buy",
      description: "Schlägt vor, den Merker „Kaufen?“ eines Weins zu setzen (value true) oder zu entfernen (false).",
      inputSchema: z.object({ wine_id: z.uuid(), value: z.boolean() }),
      run: async ({ wine_id, value }) => proposeEdit({ kind: "wantToBuy", wineId: wine_id, value }),
    }),
  ];
}

/**
 * Bliebe der Wein nach dem Löschen des Eintrags leer zurück (keine Flaschen, keine weiteren
 * Bewertungen/Verkostungen)? Dann als zweite Möglichkeit „Eintrag und Wein“ anbieten.
 */
export async function emptyWineAlternative(db: AdminClient, encounterId: string): Promise<EditAlternative | null> {
  if (!(await wouldLeaveEmptyWine(db, encounterId))) return null;
  const { data: e } = await db.from("wine_encounters").select("wine_id").eq("id", encounterId).maybeSingle();
  if (!e) return null;
  const edit: Edit = { kind: "deleteWine", wineId: e.wine_id };
  const prepared = await prepareEdit(db, edit);
  if (!prepared.ok) return null;
  return {
    edit,
    label: "Eintrag und Wein",
    question: EMPTY_WINE_QUESTION,
    note: `Mit „Eintrag und Wein“ verschwindet auch ${prepared.preview.title} (${prepared.preview.notes.join(" ")})`,
  };
}
