import { loadWineNotes } from "@/lib/cellar/notes";
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
import { loadSpirits } from "@/lib/spirits/load";
import { T } from "@/lib/bot/texts";
import { currentFills, withSpiritTags } from "@/lib/spirits/tag";
import { WINE_TYPES, daysSince, formatBottleSize, todayIso, wineTypeLabel, zurichDate } from "@/lib/format";
import { isValidRating } from "@/lib/ratings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Edit, EditPreview } from "@/lib/edit/types";
import { editTools, resolvePerson } from "./edit-tools";
import { flowTools } from "./flow-tools";
import type { WineRef } from "./menu";
import { daysLabel, openBottleLine, typeEmoji } from "./menu-view";
import { personKey, type Proposal } from "./proposals";

/** Neuer Wein per Text: Kauf (Bestand), nur verkostet oder unklar (dann fragt der Bot nach). */
export type NewEntry = { description: string; intent: "bought" | "tasted" | "unclear" };

export type PendingProposal =
  | { proposal: Proposal; text: string }
  /** Bearbeitung über das gemeinsame Modul (liegt bis zur Antwort in ingest_jobs). */
  | { edit: Edit; preview: EditPreview; text: string; alternative?: EditAlternative };

/** Zweite Möglichkeit unter einem Vorschlag, z. B. „Eintrag und Wein“ löschen. */
export type EditAlternative = { edit: Edit; label: string; question: string; note: string };

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
  const [summary, rows, spirits, open] = await Promise.all([
    db.from("cellar_wine_summary").select("wine_id, name, producer, country, region, type, grapes"),
    db.from("cellar_wines").select("*"),
    // Spirituosen: Kategorie, Alter, Fass (vor der Migration leer).
    loadSpirits(db, null),
    // Spirituosen: Füllstand der aktuellen Flasche.
    db.from("cellar_overview").select("wine_id, status, type, fill_level_percent").eq("status", "open").eq("type", "spirit"),
  ]);
  if (summary.error) throw summary.error;
  if (rows.error) throw rows.error;
  const fills = currentFills(open.data ?? []);
  return withSpiritTags(
    buildCellarWines(
      (summary.data ?? []).map(toSummaryWine).filter(nonNull),
      (rows.data ?? []).map((r) => toVintageRow(r)).filter(nonNull),
      room ? { house: null, room } : null,
    ),
    (w) => w.wine_id,
    spirits,
  ).map((w) => (w.type === "spirit" ? { ...w, currentFill: fills.get(w.wine_id) ?? null } : w));
}

function describeWine(w: CellarWine & { currentFill?: number | null }) {
  // Spirituose: Art „Spirituose“ mit Kategorie, Alter und Fass; ohne Rebsorten und Trinkreife.
  const spirit = w.type === "spirit";
  return {
    wine_id: w.wine_id,
    emoji: typeEmoji(w.type),
    kind: spirit ? "Spirituose" : "Wein",
    producer: w.producer,
    name: w.name,
    type: wineTypeLabel(w.type),
    ...(spirit
      ? {
          category: w.spirit?.label ?? null,
          age_years: w.spirit?.ageYears ?? null,
          cask: w.spirit?.cask ?? null,
          // Alle Flaschen inkl. der aktuellen (angebrochenen); deren Füllstand.
          bottles_incl_current: w.sealed,
          current_bottle_fill_percent: w.currentFill ?? 100,
        }
      : {}),
    origin: [w.region, w.country].filter(Boolean).join(", ") || null,
    grapes: spirit ? undefined : w.grapes,
    sealed_bottles: w.sealed,
    open_bottles: w.open,
    vintages: w.rows.map((r) => ({
      vintage_year: r.vintage_year,
      bottle_size: formatBottleSize(r.bottle_size_ml),
      sealed: r.sealed,
      open: r.open,
      avg_price_chf: r.avg_price,
      price_class: r.price_class,
      drink_status: spirit ? undefined : DRINK_STATUS_LABELS[r.drink_status],
      drink_window: spirit ? undefined : r.drink_from_year || r.drink_until_year
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
  newEntries: NewEntry[] = [],
  /** Weine, die nach der Antwort recherchiert werden sollen (research_wine). */
  researchRequests: { wineId: string; year: number | null }[] = [],
  /** Chat für die offenen Erfassungen (list_open_entries, cancel_open_entry). */
  chatId: number | null = null,
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
        "Sucht im aktuellen Bestand (ungeöffnete und offene Flaschen) – Weine und Spirituosen (kind „Wein“ bzw. „Spirituose“, bei Spirituosen mit Kategorie wie „Whisky › Bourbon“, Alter, Fass). Liefert pro Eintrag die wine_id, Jahrgänge mit Flaschenzahl, Ø Preis, Preisklasse, Trinkreife (nur Wein) und Lagerorten. Ohne Suchtext: ganzer Bestand. type „spirit“ = nur Spirituosen.",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Freitext: Wein, Produzent, Region, Land, Rebsorte, Jahrgang, Kategorie (z. B. Bourbon), Fass"),
        room: z.string().max(80).optional().describe("Nur dieser Lagerort, z. B. Weinkeller oder Wohnzimmer"),
        type: z.enum(WINE_TYPES).optional(),
      }),
      run: async ({ query, room, type }) => {
        let wines = await loadCellar(db, room ?? null);
        if (type) wines = wines.filter((w) => w.type === type);
        if (query) {
          const notes = await loadWineNotes(db, wines.map((w) => w.wine_id));
          wines = wines.filter((w) => matchesQuery(w, query, notes.get(w.wine_id)) || w.rows.some((r) => String(r.vintage_year) === query.trim()));
        }
        const total = wines.reduce((s, w) => s + w.sealed, 0);
        const spiritBottles = wines.filter((w) => w.type === "spirit").reduce((s, w) => s + w.sealed, 0);
        return json({
          wines_found: wines.length,
          sealed_bottles_total: total,
          // Getrennt: Wein und Spirituosen.
          sealed_bottles_wine: total - spiritBottles,
          sealed_bottles_spirits: spiritBottles,
          wines: wines.slice(0, 20).map(describeWine),
          truncated: wines.length > 20,
        });
      },
    }),

    betaZodTool({
      name: "list_open_bottles",
      description:
        "Alle offenen Weinflaschen mit inventory_item_id, Füllstand in %, Flaschengrösse, Tagen seit dem Öffnen und Lagerort. Spirituosen sind nicht dabei (sie haben eine aktuelle Flasche – siehe search_cellar, propose_spirit_bottle).",
      inputSchema: z.object({}),
      run: async () => {
        const { data, error } = await db
          .from("cellar_overview")
          .select("inventory_item_id, wine_id, producer, name, vintage_year, type, bottle_size_ml, fill_level_percent, date_opened, storage_room")
          .eq("status", "open")
          // Spirituosen haben kein „offen“ (aktuelle Flasche steht in search_cellar).
          .or("type.is.null,type.neq.spirit")
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
            bottle_size_ml: r.bottle_size_ml ?? (r.type === "spirit" ? 700 : 750),
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
        "Trinkreife des Weinbestands (Spirituosen haben keine; aus dem Trinkfenster je Jahrgang): Anzahl ungeöffneter Flaschen pro Status – overdue = über dem Höhepunkt (bis-Jahr vorbei), now = jetzt trinken (bis-Jahr = dieses Jahr), ready = trinkreif, wait = noch lagern, unknown = kein Trinkfenster – und die Weine dazu.",
      inputSchema: z.object({
        status: z.enum(DRINK_STATUSES).optional().describe("Nur Weine mit diesem Status auflisten"),
        room: z.string().max(80).optional(),
      }),
      run: async ({ status, room }) => {
        const wines = await loadCellar(db, room ?? null);
        const counts = emptyDrinkCounts();
        const list: { wine_id: string; wine: string; status: string; window: string | null; sealed: number }[] = [];
        for (const w of wines) {
          if (w.type === "spirit") continue;
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
        "Startet die Erfassung eines Weins aus Text (ohne Foto): einen Kauf für den Bestand („Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“) oder einen Wein, den die Person irgendwo nur verkostet hat („Heute im Kronenhalle den Pintia 2019 probiert, 120 Franken die Flasche, 4,5 Sterne“). Fehlendes frage ich danach automatisch nach.",
      inputSchema: z.object({
        description: z.string().min(2).max(2000).describe("Die Angaben der Person, möglichst wörtlich"),
        intent: z
          .enum(["bought", "tasted", "unclear"])
          .describe("bought = gekauft (Bestand), tasted = nur verkostet (Restaurant, Bar, bei Freunden, probiert), unclear = kein klarer Hinweis – dann frage ich mit Knöpfen nach"),
      }),
      run: async ({ description, intent }) => {
        if (newEntries.length) return "Es läuft schon eine Erfassung.";
        newEntries.push({ description, intent });
        return "Erfassung gestartet – ich melde mich gleich mit Rückfragen. Antworte höchstens mit einem kurzen Satz.";
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
          .select("id, quantity, bottle_size_ml, storage_room, purchased_at, wine:wines(producer, name, type)")
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
        if ((wine as { type?: string | null } | null)?.type === "spirit") return `Hinweis für den Nutzer (nichts vorschlagen): ${T.spiritNoOpen}`;
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
      name: "propose_spirit_bottle",
      description:
        "Spirituosen (Whisky, Grappa, Likör …): Füllstand der aktuellen Flasche setzen („Lagavulin noch 30 %“ → action fill, percent 30) oder die aktuelle Flasche leer buchen („Lagavulin leer“ → action empty; die nächste volle wird automatisch aktuell mit 100 %). 0 % gilt als leer. Passen mehrere Spirituosen im Bestand, bekommt jede einen eigenen Vorschlag mit [Ja] [Nein] (höchstens 3) – sonst eine Rückfrage. Ändert noch nichts.",
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe("Wie die Person die Spirituose nennt, z. B. „Lagavulin“"),
        action: z.enum(["fill", "empty"]),
        percent: z.number().int().min(0).max(100).optional().describe("Nur bei fill: neuer Füllstand in %"),
      }),
      run: async ({ query, action, percent }) => {
        if (action === "fill" && percent == null) return "Fehler: Bei fill den Füllstand (percent) angeben.";
        const spirits = (await loadCellar(db, null)).filter((w) => w.type === "spirit" && w.sealed > 0);
        const notes = await loadWineNotes(db, spirits.map((w) => w.wine_id));
        const hits = spirits.filter((w) => matchesQuery(w, query, notes.get(w.wine_id)));
        if (!hits.length) return `Fehler: Keine Spirituose im Bestand passt zu „${query}“. Prüfe search_cellar (type spirit).`;
        if (hits.length > 3) {
          return `Rückfrage nötig: Mehrere Spirituosen passen (${hits.map((w) => title(w)).join("; ")}). Frag den Nutzer, welche.`;
        }
        const empty = action === "empty" || percent === 0;
        const out = hits.map((w) => {
          const name = title(w);
          return empty
            ? propose({ kind: "spiritEmpty", wineId: w.wine_id }, `${name}: aktuelle Flasche leer buchen (noch ${w.sealed} Fl. inkl. aktueller)`)
            : propose({ kind: "spiritFill", wineId: w.wine_id, percent: percent! }, `${name}: aktuelle Flasche noch ${percent} %`);
        });
        return hits.length > 1 ? `Mehrere passen – je ein Vorschlag mit Knöpfen: ${out.join(" ")}` : out[0];
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
    ...flowTools(db, chatId),

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
  const map = new Map<string, { producer: string | null; name: string }>();
  if (!unique.length) return map;
  const { data, error } = await db.from("wines").select("id, producer, name").in("id", unique);
  if (error) throw error;
  for (const w of data ?? []) map.set(w.id, w);
  return map;
}
