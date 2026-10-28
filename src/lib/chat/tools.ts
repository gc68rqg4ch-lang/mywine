import "server-only";

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  DRINK_STATUS_LABELS,
  DRINK_STATUS_ORDER,
  buildCellarWines,
  emptyDrinkCounts,
  matchesQuery,
  toSummaryWine,
  toVintageRow,
  type CellarWine,
} from "@/lib/cellar/overview";
import { WINE_TYPES, daysSince, formatBottleSize, todayIso, wineTypeLabel, zurichDate } from "@/lib/format";
import { isValidRating } from "@/lib/ratings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Edit, EditPreview } from "@/lib/edit/types";
import { editTools, resolvePerson } from "./edit-tools";
import type { WineRef } from "./menu";
import { daysLabel, openBottleLine, typeEmoji } from "./menu-view";
import { personKey, type Proposal } from "./proposals";

export type PendingProposal =
  | { proposal: Proposal; text: string }
  /** Bearbeitung über das gemeinsame Modul (liegt bis zur Antwort in ingest_jobs). */
  | { edit: Edit; preview: EditPreview; text: string };

const DRINK_STATUSES = ["overdue", "now", "ready", "wait", "unknown"] as const;

const nonNull = <T,>(v: T | null): v is T => v != null;
const json = (value: unknown) => JSON.stringify(value);

function title(w: { producer?: string | null; name?: string | null; vintage_year?: number | null }) {
  return [w.producer, w.name, w.vintage_year ?? "ohne Jahrgang"].filter(Boolean).join(" ");
}

function place(r: { storage_house?: string | null; storage_room?: string | null }) {
  return r.storage_room ?? "ohne Lagerort";
}

/** Suchbegriff für PostgREST-Filter entschärfen (keine Kommas/Klammern/Wildcards). */
function searchTerms(query: string) {
  return query
    .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5);
}

/**
 * Wein-IDs (auch ausgetrunkene Weine) zu einem Freitext über Name und Produzent;
 * null = der Text enthält nichts Suchbares (dann nicht filtern).
 */
async function findWineIds(db: AdminClient, query: string) {
  const terms = searchTerms(query).filter((t) => !/^\d{4}$/.test(t));
  if (!terms.length) return null;
  let q = db.from("wines").select("id");
  for (const term of terms) q = q.or(`name.ilike.%${term}%,producer.ilike.%${term}%`);
  const { data, error } = await q.limit(50);
  if (error) throw error;
  return (data ?? []).map((w) => w.id);
}

export async function loadCellar(db: AdminClient, room: string | null) {
  const [summary, rows] = await Promise.all([
    db.from("cellar_wine_summary").select("wine_id, name, producer, country, region, type, grapes"),
    db.from("cellar_wines").select("*"),
  ]);
  if (summary.error) throw summary.error;
  if (rows.error) throw rows.error;
  return buildCellarWines(
    (summary.data ?? []).map(toSummaryWine).filter(nonNull),
    (rows.data ?? []).map((r) => toVintageRow(r)).filter(nonNull),
    room ? { house: null, room } : null,
  );
}

function describeWine(w: CellarWine) {
  return {
    wine_id: w.wine_id,
    emoji: typeEmoji(w.type),
    producer: w.producer,
    name: w.name,
    type: wineTypeLabel(w.type),
    origin: [w.region, w.country].filter(Boolean).join(", ") || null,
    grapes: w.grapes,
    sealed_bottles: w.sealed,
    open_bottles: w.open,
    vintages: w.rows.map((r) => ({
      vintage_year: r.vintage_year,
      bottle_size: formatBottleSize(r.bottle_size_ml),
      sealed: r.sealed,
      open: r.open,
      avg_price_chf: r.avg_price,
      price_class: r.price_class,
      drink_status: DRINK_STATUS_LABELS[r.drink_status],
      drink_window: r.drink_from_year || r.drink_until_year
        ? `${r.drink_from_year ?? "?"}–${r.drink_until_year ?? "?"}`
        : null,
      locations: r.locations
        .filter((l) => l.sealed + l.open > 0)
        .map((l) => ({ room: place(l), sealed: l.sealed, open: l.open })),
    })),
  };
}

/**
 * Die Werkzeuge für ein Gespräch. Schreib-Werkzeuge ändern nichts, sondern legen
 * einen Vorschlag in `pending` ab; der Bot zeigt ihn mit [Ja] [Nein] an.
 */
export function chatTools(
  db: AdminClient,
  pending: PendingProposal[],
  wineRefs: WineRef[] = [],
  actor: { personId: string | null; name: string } | null = null,
  newEntries: string[] = [],
  /** Weine, die nach der Antwort recherchiert werden sollen (research_wine). */
  researchRequests: { wineId: string; year: number | null }[] = [],
) {
  const propose = (proposal: Proposal, text: string) => {
    if (pending.length >= 3) return "Zu viele Vorschläge auf einmal – bitte erst die offenen bestätigen lassen.";
    pending.push({ proposal, text });
    return `Vorschlag „${text}“ wird dem Nutzer mit den Buttons [Ja] [Nein] angezeigt. Noch nichts ist geändert – nicht als erledigt bezeichnen.`;
  };

  return [
    betaZodTool({
      name: "search_cellar",
      description:
        "Sucht im aktuellen Bestand (ungeöffnete und offene Flaschen). Liefert pro Wein die wine_id, Jahrgänge mit Flaschenzahl, Ø Preis, Preisklasse, Trinkreife und Lagerorten. Ohne Suchtext: ganzer Bestand.",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Freitext: Wein, Produzent, Region, Land, Rebsorte, Jahrgang"),
        room: z.string().max(80).optional().describe("Nur dieser Lagerort, z. B. Weinkeller oder Wohnzimmer"),
        type: z.enum(WINE_TYPES).optional(),
      }),
      run: async ({ query, room, type }) => {
        let wines = await loadCellar(db, room ?? null);
        if (type) wines = wines.filter((w) => w.type === type);
        if (query) wines = wines.filter((w) => matchesQuery(w, query) || w.rows.some((r) => String(r.vintage_year) === query.trim()));
        const total = wines.reduce((s, w) => s + w.sealed, 0);
        return json({
          wines_found: wines.length,
          sealed_bottles_total: total,
          wines: wines.slice(0, 20).map(describeWine),
          truncated: wines.length > 20,
        });
      },
    }),

    betaZodTool({
      name: "list_open_bottles",
      description:
        "Alle offenen Flaschen mit inventory_item_id, Füllstand in %, Flaschengrösse, Tagen seit dem Öffnen und Lagerort.",
      inputSchema: z.object({}),
      run: async () => {
        const { data, error } = await db
          .from("cellar_overview")
          .select("inventory_item_id, wine_id, producer, name, vintage_year, type, bottle_size_ml, fill_level_percent, date_opened, storage_room")
          .eq("status", "open")
          .order("date_opened", { ascending: true, nullsFirst: false });
        if (error) throw error;
        return json(
          (data ?? []).map((r) => ({
            inventory_item_id: r.inventory_item_id,
            wine_id: r.wine_id,
            line: openBottleLine(
              {
                itemId: r.inventory_item_id ?? "",
                wineId: r.wine_id ?? "",
                producer: r.producer ?? "",
                name: r.name ?? "",
                year: r.vintage_year,
                type: r.type,
                fill: r.fill_level_percent,
                days: daysSince(r.date_opened),
                room: r.storage_room,
              },
              `${r.name ?? ""} ${r.vintage_year ?? "o. J."}`,
            ),
            since: daysLabel(daysSince(r.date_opened)),
            wine: title(r),
            type: wineTypeLabel(r.type),
            bottle_size_ml: r.bottle_size_ml ?? 750,
            fill_level_percent: r.fill_level_percent,
            days_open: daysSince(r.date_opened),
            room: place(r),
          })),
        );
      },
    }),

    betaZodTool({
      name: "drink_readiness",
      description:
        "Trinkreife des Bestands (aus dem Trinkfenster je Jahrgang): Anzahl ungeöffneter Flaschen pro Status – overdue = über dem Höhepunkt (bis-Jahr vorbei), now = jetzt trinken (bis-Jahr = dieses Jahr), ready = trinkreif, wait = noch lagern, unknown = kein Trinkfenster – und die Weine dazu.",
      inputSchema: z.object({
        status: z.enum(DRINK_STATUSES).optional().describe("Nur Weine mit diesem Status auflisten"),
        room: z.string().max(80).optional(),
      }),
      run: async ({ status, room }) => {
        const wines = await loadCellar(db, room ?? null);
        const counts = emptyDrinkCounts();
        const list: { wine_id: string; wine: string; status: string; window: string | null; sealed: number }[] = [];
        for (const w of wines) {
          for (const r of w.rows) {
            if (r.sealed === 0) continue;
            counts[r.drink_status] += r.sealed;
            if (status && r.drink_status !== status) continue;
            list.push({
              wine_id: w.wine_id,
              wine: title({ ...w, vintage_year: r.vintage_year }),
              status: DRINK_STATUS_LABELS[r.drink_status],
              window: r.drink_from_year || r.drink_until_year ? `${r.drink_from_year ?? "?"}–${r.drink_until_year ?? "?"}` : null,
              sealed: r.sealed,
            });
          }
        }
        return json({
          today: todayIso(),
          bottles_by_status: Object.fromEntries(DRINK_STATUS_ORDER.map((s) => [DRINK_STATUS_LABELS[s], counts[s]])),
          wines: list.slice(0, 30),
          truncated: list.length > 30,
        });
      },
    }),

    betaZodTool({
      name: "get_ratings",
      description:
        "Neueste persönliche Bewertungen (0–5 Sterne) je Person, Wein und Jahrgang – auch für bereits ausgetrunkene Weine. Ohne Filter: die letzten 20.",
      inputSchema: z.object({
        wine_id: z.uuid().optional(),
        query: z.string().max(200).optional().describe("Wein oder Produzent"),
      }),
      run: async ({ wine_id, query }) => {
        let q = db.from("latest_wine_ratings").select("wine_id, vintage_year, person_name, rating, rated_at, note");
        if (wine_id) q = q.eq("wine_id", wine_id);
        else if (query) {
          const ids = await findWineIds(db, query);
          if (ids) q = q.in("wine_id", ids);
        }
        const { data, error } = await q.order("rated_at", { ascending: false }).limit(20);
        if (error) throw error;
        const names = await wineNames(db, (data ?? []).map((r) => r.wine_id).filter(nonNull));
        return json(
          (data ?? []).map((r) => ({
            wine_id: r.wine_id,
            wine: title({ ...names.get(r.wine_id ?? ""), vintage_year: r.vintage_year }),
            person: r.person_name,
            rating: r.rating,
            rated_at: r.rated_at,
            note: r.note,
          })),
        );
      },
    }),

    betaZodTool({
      name: "get_tastings",
      description:
        "WSET-Verkostungen (Stil, Qualität, Punkte, Trinkreife, Notizen). Ohne Filter: die letzten 10.",
      inputSchema: z.object({
        wine_id: z.uuid().optional(),
        query: z.string().max(200).optional().describe("Wein oder Produzent"),
      }),
      run: async ({ wine_id, query }) => {
        let q = db
          .from("wine_tastings")
          .select("id, wine_id, vintage_year, tasted_at, wine_style, quality_level, quality_points, readiness, notes, person:persons(name)");
        if (wine_id) q = q.eq("wine_id", wine_id);
        else if (query) {
          const ids = await findWineIds(db, query);
          if (ids) q = q.in("wine_id", ids);
        }
        const { data, error } = await q.order("tasted_at", { ascending: false }).limit(10);
        if (error) throw error;
        const names = await wineNames(db, (data ?? []).map((r) => r.wine_id));
        return json(
          (data ?? []).map((r) => ({
            tasting_id: r.id,
            wine: title({ ...names.get(r.wine_id), vintage_year: r.vintage_year }),
            tasted_at: r.tasted_at,
            person: r.person?.name ?? null,
            style: r.wine_style,
            quality: r.quality_level,
            points: r.quality_points,
            readiness: r.readiness,
            notes: r.notes,
          })),
        );
      },
    }),

    betaZodTool({
      name: "recent_journal",
      description: "Letzte Einträge im Journal: Käufe, Öffnen, Füllstand, Ausgetrunken, Umlagern.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
      run: async ({ limit }) => {
        const { data, error } = await db
          .from("inventory_events")
          .select("wine_id, vintage_year, event_type, occurred_at, quantity, price, fill_level_percent, storage_from, storage_to, note")
          .order("occurred_at", { ascending: false })
          .limit(limit ?? 10);
        if (error) throw error;
        const names = await wineNames(db, (data ?? []).map((r) => r.wine_id));
        return json(
          (data ?? []).map((r) => ({
            date: zurichDate(r.occurred_at),
            event: r.event_type,
            wine: title({ ...names.get(r.wine_id), vintage_year: r.vintage_year }),
            quantity: r.quantity,
            price_chf: r.price,
            fill_level_percent: r.fill_level_percent,
            from: r.storage_from,
            to: r.storage_to,
            note: r.note,
          })),
        );
      },
    }),

    betaZodTool({
      name: "attach_wine_buttons",
      description:
        "Hängt unter deine Antwort je Wein einen Knopf zum Antippen (Gläser, Füllstand, Öffnen, Bewertung). Immer aufrufen, wenn die Antwort konkrete Weine oder Flaschen nennt – in derselben Reihenfolge. Offene Flaschen mit inventory_item_id, sonst wine_id + vintage_year.",
      inputSchema: z.object({
        wines: z
          .array(
            z.object({
              inventory_item_id: z.uuid().optional(),
              wine_id: z.uuid().optional(),
              vintage_year: z.number().int().nullable().optional(),
            }),
          )
          .min(1)
          .max(30),
      }),
      run: async ({ wines }) => {
        for (const w of wines) {
          if (w.inventory_item_id) wineRefs.push({ itemId: w.inventory_item_id });
          else if (w.wine_id) wineRefs.push({ wineId: w.wine_id, year: w.vintage_year ?? null });
        }
        return `${wines.length} Knöpfe werden unter der Antwort angezeigt.`;
      },
    }),

    betaZodTool({
      name: "start_wine_entry",
      description:
        "Startet die Erfassung eines neuen Weins bzw. Kaufs aus Text (ohne Foto), z. B. „Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“. Danach recherchierst du wie bei Fotos und fragst Fehlendes nach (läuft automatisch).",
      inputSchema: z.object({
        description: z.string().min(2).max(2000).describe("Die Angaben der Person zum Kauf, möglichst wörtlich"),
      }),
      run: async ({ description }) => {
        if (newEntries.length) return "Es läuft schon eine Erfassung.";
        newEntries.push(description);
        return "Erfassung gestartet – ich melde mich gleich mit Rückfragen. Antworte höchstens mit einem kurzen Satz, z. B. „Ich recherchiere den Wein und melde mich gleich.“";
      },
    }),

    betaZodTool({
      name: "propose_open_bottle",
      description:
        "Schlägt vor, eine ungeöffnete Flasche zu öffnen (ändert noch nichts). Liegt der Wein an mehreren Lagerorten oder in mehreren Grössen, kommt eine Rückfrage zurück – dann den Nutzer fragen und `room` bzw. `bottle_size_ml` angeben.",
      inputSchema: z.object({
        wine_id: z.uuid().describe("Aus search_cellar"),
        vintage_year: z.number().int().nullable().describe("Jahrgang; null = ohne Jahrgang"),
        room: z.string().max(80).optional().describe("Lagerort, aus dem die Flasche kommt"),
        bottle_size_ml: z.number().int().optional(),
      }),
      run: async ({ wine_id, vintage_year, room, bottle_size_ml }) => {
        let q = db
          .from("inventory_items")
          .select("id, quantity, bottle_size_ml, storage_room, purchased_at, wine:wines(producer, name)")
          .eq("wine_id", wine_id)
          .eq("status", "sealed")
          .gt("quantity", 0);
        q = vintage_year == null ? q.is("vintage_year", null) : q.eq("vintage_year", vintage_year);
        const { data, error } = await q.order("purchased_at", { ascending: true, nullsFirst: true });
        if (error) throw error;
        let batches = data ?? [];
        if (room) batches = batches.filter((b) => (b.storage_room ?? "").toLowerCase() === room.toLowerCase());
        if (bottle_size_ml) batches = batches.filter((b) => (b.bottle_size_ml ?? 750) === bottle_size_ml);
        if (!batches.length) {
          return "Fehler: Keine ungeöffnete Flasche dieses Weins/Jahrgangs" + (room ? ` im ${room}` : "") + ". Prüfe search_cellar.";
        }
        const options = [...new Set(batches.map((b) => `${place(b)} · ${formatBottleSize(b.bottle_size_ml) ?? "75 cl"}`))];
        if (options.length > 1) {
          return `Rückfrage nötig: Der Wein liegt an mehreren Orten bzw. in mehreren Grössen: ${options.join("; ")}. Frag den Nutzer, welche Flasche.`;
        }
        const batch = batches[0];
        const wine = batch.wine;
        return propose(
          { kind: "open", itemId: batch.id },
          `${title({ ...wine, vintage_year })} öffnen (aus ${place(batch)}, ${formatBottleSize(batch.bottle_size_ml) ?? "75 cl"})`,
        );
      },
    }),

    betaZodTool({
      name: "propose_mark_drunk",
      description: "Schlägt vor, eine offene Flasche als ausgetrunken zu markieren (ändert noch nichts).",
      inputSchema: z.object({ inventory_item_id: z.uuid().describe("Aus list_open_bottles") }),
      run: async ({ inventory_item_id }) => {
        const { data: r, error } = await db
          .from("cellar_overview")
          .select("producer, name, vintage_year, status")
          .eq("inventory_item_id", inventory_item_id)
          .maybeSingle();
        if (error) throw error;
        if (!r || r.status !== "open") return "Fehler: Diese Flasche ist nicht offen. Prüfe list_open_bottles.";
        return propose({ kind: "drunk", itemId: inventory_item_id }, `${title(r)} als ausgetrunken markieren`);
      },
    }),

    betaZodTool({
      name: "propose_rating",
      description:
        "Schlägt eine persönliche Bewertung für Wein + Jahrgang vor (ändert noch nichts). 0–5 Sterne in halben Schritten, pro Person.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: z.number().int().nullable(),
        person: z
          .string()
          .optional()
          .describe("Nur angeben, wenn ausdrücklich für eine andere Person bewertet wird (Michel oder Sara); sonst weglassen = die Person, die schreibt"),
        rating: z.number().min(0).max(5),
      }),
      run: async ({ wine_id, vintage_year, person, rating }) => {
        if (!isValidRating(rating)) return "Fehler: Bewertung nur in halben Schritten von 0 bis 5.";
        const { match, names } = await resolvePerson(db, actor, person);
        if (!match) return `Fehler: Unbekannte Person. Möglich: ${names.join(", ")}.`;
        const { data: wine, error } = await db.from("wines").select("producer, name").eq("id", wine_id).maybeSingle();
        if (error) throw error;
        if (!wine) return "Fehler: Wein nicht gefunden.";
        const stars = rating.toLocaleString("de-CH");
        return propose(
          { kind: "rate", wineId: wine_id, vintageYear: vintage_year, personKey: personKey(match.id), rating },
          `Bewertung ${match.name}: ${title({ ...wine, vintage_year })} → ${stars} von 5 Sternen`,
        );
      },
    }),
    ...editTools(db, pending, actor),

    betaZodTool({
      name: "research_wine",
      description:
        "Recherchiert einen Wein im Web (dauert etwa eine Minute, läuft nach deiner Antwort): Leeres wird ergänzt, Abweichungen von den gespeicherten Angaben fragst du danach einzeln mit [Ja] [Nein] nach. Für „recherchier mal …“, „stimmt der Alkohol?“ u. ä.",
      inputSchema: z.object({
        wine_id: z.uuid(),
        vintage_year: z.number().int().min(0).optional().describe("Jahrgang für den Link; 0 = ohne Jahrgang"),
      }),
      run: async ({ wine_id, vintage_year }) => {
        if (researchRequests.length) return "Es läuft schon eine Recherche – eine nach der anderen.";
        researchRequests.push({ wineId: wine_id, year: vintage_year ? vintage_year : null });
        return "Recherche gestartet. Antworte höchstens mit einem kurzen Satz wie „Ich recherchiere den Wein und melde mich gleich.“";
      },
    }),
  ];
}

async function wineNames(db: AdminClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const map = new Map<string, { producer: string; name: string }>();
  if (!unique.length) return map;
  const { data, error } = await db.from("wines").select("id, producer, name").in("id", unique);
  if (error) throw error;
  for (const w of data ?? []) map.set(w.id, w);
  return map;
}
