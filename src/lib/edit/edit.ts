import "server-only";

// Bearbeiten – ein Modul für App und Bot: prepareEdit prüft eine Bearbeitung gegen den
// aktuellen Stand und liefert „vorher → nachher“; applyEdit prüft nochmals und führt aus.
// Gleiche Prüfungen, gleiche Meldungen. Das Journal (inventory_events) schreibt die DB per
// Trigger – hier entstehen nie eigene Einträge.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { WINE_TYPE_LABELS, formatBottleSize, formatDate, formatMoney, todayIso, zurichDate, type WineType } from "@/lib/format";
import { formatShares, normalizeGrapeShares, percentSum } from "@/lib/grapes/shares";
import { loadGrapeShares, replaceGrapeShares } from "@/lib/grapes/store";
import { isValidRating, saveRating } from "@/lib/ratings";
import {
  ROOMS,
  yearText,
  type BatchChanges,
  type Edit,
  type EditChange,
  type EditPreview,
  type EditResult,
  type Room,
  type WineChanges,
} from "./types";

type Db = SupabaseClient<Database>;

export type PreparedEdit =
  | { ok: false; error: string }
  | {
      ok: true;
      preview: EditPreview;
      wineId: string | null;
      year?: number | null;
      /** Führt aus und liefert, was getan wurde („2 Flaschen ins Wohnzimmer verschoben“). */
      run: () => Promise<string>;
    };

export const NOTHING = "Nichts zu ändern – die Angaben sind schon so.";
const DASH = "–";
const WINE_TYPES = Object.keys(WINE_TYPE_LABELS) as WineType[];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (error: string): PreparedEdit => ({ ok: false, error });
const show = (v: string | number | null | undefined) => (v == null || v === "" ? DASH : String(v));
const money = (v: number | null | undefined) => formatMoney(v, "CHF") ?? DASH;
const date = (v: string | null | undefined) => formatDate(v) ?? DASH;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** „in den Weinkeller“ / „ins Wohnzimmer“ */
export const intoRoom = (room: string) => (room === "Wohnzimmer" ? "ins Wohnzimmer" : `in den ${room}`);
const inRoom = (room: string | null) => (room == null ? "ohne Lagerort" : room === "Wohnzimmer" ? "im Wohnzimmer" : `im ${room}`);
const bottles = (n: number) => (n === 1 ? "1 Flasche" : `${n} Flaschen`);

/** Leerer Text → null, sonst getrimmt. */
const clean = (v: string | null | undefined) => {
  const t = v?.trim().replace(/\s+/g, " ");
  return t ? t : null;
};
/** Für ilike: exakte Suche ohne Platzhalter. */
const exact = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function validYear(year: number | null, label = "Jahrgang") {
  if (year == null) return null;
  const max = Number(todayIso().slice(0, 4)) + 1;
  return Number.isInteger(year) && year >= 1800 && year <= max ? null : `${label}: bitte eine Jahreszahl zwischen 1800 und ${max}.`;
}

function validDate(value: string, label: string) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return `${label}: ungültiges Datum.`;
  if (value > todayIso()) return `${label}: darf nicht in der Zukunft liegen.`;
  return null;
}

const validPrice = (v: number | null, label: string) =>
  v == null || (Number.isFinite(v) && v >= 0 && v < 100_000) ? null : `${label}: ungültiger Preis.`;

const sameVintage = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(
  q: Q,
  year: number | null,
) => (year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year));

// ---------------------------------------------------------------------------
// Laden

async function loadWine(db: Db, wineId: string) {
  const { data, error } = await db.from("wines").select("*").eq("id", wineId).maybeSingle();
  if (error) throw error;
  return data;
}

const wineTitle = (w: { producer: string; name: string }, year?: number | null) =>
  `${w.producer} – ${w.name}${year === undefined ? "" : ` ${year ?? "NV"}`}`;

async function loadItem(db: Db, itemId: string) {
  const { data, error } = await db
    .from("inventory_items")
    .select(
      "id, wine_id, vintage_year, status, quantity, bottle_size_ml, purchased_at, vendor_id, is_gift, purchase_price, regular_price, currency, storage_house, storage_room, storage_compartment, storage_location, drunk_at, wine:wines(name, producer), vendor:vendors(name), open:open_bottle_details(fill_level_percent, date_opened)",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
type Item = NonNullable<Awaited<ReturnType<typeof loadItem>>>;

const STATUS_TEXT = { sealed: "", open: "offene Flasche", drunk: "getrunkene Flasche" } as const;
const itemTitle = (i: Item) =>
  [wineTitle(i.wine, i.vintage_year), i.status === "sealed" ? `${bottles(i.quantity)} ${inRoom(i.storage_room)}` : STATUS_TEXT[i.status]]
    .filter(Boolean)
    .join(" · ");

function diff(changes: EditChange[], label: string, before: string, after: string) {
  if (before !== after) changes.push({ label, before, after });
}

function ready(
  preview: EditPreview,
  wineId: string | null,
  run: () => Promise<string>,
  year?: number | null,
): PreparedEdit {
  if (!preview.changes.length && !preview.notes.length) return fail(NOTHING);
  return { ok: true, preview, wineId, year, run };
}

// ---------------------------------------------------------------------------
// Wein

async function prepareWine(db: Db, wineId: string, set: WineChanges): Promise<PreparedEdit> {
  const wine = await loadWine(db, wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  const next = {
    name: set.name === undefined ? wine.name : clean(set.name),
    producer: set.producer === undefined ? wine.producer : clean(set.producer),
    type: set.type === undefined ? wine.type : set.type,
    country: set.country === undefined ? wine.country : clean(set.country),
    region: set.region === undefined ? wine.region : clean(set.region),
    appellation: set.appellation === undefined ? wine.appellation : clean(set.appellation),
    alcohol_content: set.alcohol === undefined ? wine.alcohol_content : set.alcohol,
  };
  const name = next.name;
  const producer = next.producer;
  if (!name) return fail("Der Name darf nicht leer sein.");
  if (!producer) return fail("Der Produzent darf nicht leer sein.");
  if (next.type != null && !WINE_TYPES.includes(next.type)) return fail("Unbekannter Weintyp.");
  const alc = next.alcohol_content;
  if (alc != null && !(Number.isFinite(alc) && alc >= 0 && alc <= 25)) return fail("Alkohol: bitte 0–25 % vol.");

  if (name.toLowerCase() !== wine.name.toLowerCase() || producer.toLowerCase() !== wine.producer.toLowerCase()) {
    const { data: other, error } = await db
      .from("wines")
      .select("id, name, producer")
      .ilike("name", exact(name))
      .ilike("producer", exact(producer))
      .neq("id", wineId)
      .limit(1);
    if (error) throw error;
    if (other?.length) {
      return fail(
        `Es gibt schon einen Wein „${other[0].name}“ von ${other[0].producer}. Name und Produzent müssen zusammen eindeutig sein – bitte anders benennen.`,
      );
    }
  }

  const changes: EditChange[] = [];
  diff(changes, "Name", wine.name, name);
  diff(changes, "Produzent", wine.producer, producer);
  diff(changes, "Typ", wine.type ? WINE_TYPE_LABELS[wine.type] : DASH, next.type ? WINE_TYPE_LABELS[next.type] : DASH);
  diff(changes, "Land", show(wine.country), show(next.country));
  diff(changes, "Region", show(wine.region), show(next.region));
  diff(changes, "Appellation", show(wine.appellation), show(next.appellation));
  const pct = (v: number | null) => (v == null ? DASH : `${v.toLocaleString("de-CH")} % vol`);
  diff(changes, "Alkohol", pct(wine.alcohol_content), pct(alc));

  return ready({ title: wineTitle(wine), action: "Wein bearbeiten", changes, notes: [] }, wineId, async () => {
    const { error } = await db.from("wines").update({ ...next, name, producer }).eq("id", wineId);
    if (error) throw error;
    return `die Angaben zu ${wineTitle({ name, producer })} gespeichert`;
  });
}

// ---------------------------------------------------------------------------
// Jahrgang

async function vintageExists(db: Db, wineId: string, year: number | null) {
  const [items, vintages] = await Promise.all([
    sameVintage(db.from("inventory_items").select("id", { count: "exact", head: true }).eq("wine_id", wineId), year),
    sameVintage(db.from("wine_vintages").select("id", { count: "exact", head: true }).eq("wine_id", wineId), year),
  ]);
  if (items.error) throw items.error;
  if (vintages.error) throw vintages.error;
  return { items: items.count ?? 0, any: (items.count ?? 0) + (vintages.count ?? 0) > 0 };
}

const vintageRpc = (db: Db, wineId: string, from: number | null, to: number | null, itemId?: string) =>
  db.rpc("change_vintage", {
    p_wine_id: wineId,
    // null = ohne Jahrgang; der generierte Typ kennt die Nullbarkeit nicht.
    p_from: from as number,
    p_to: to as number,
    ...(itemId ? { p_item_id: itemId } : {}),
  });

async function prepareVintage(db: Db, wineId: string, from: number | null, to: number | null): Promise<PreparedEdit> {
  const wine = await loadWine(db, wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  const invalid = validYear(to);
  if (invalid) return fail(invalid);
  if (from === to) return fail(NOTHING);
  const [source, target] = await Promise.all([vintageExists(db, wineId, from), vintageExists(db, wineId, to)]);
  if (!source.any) return fail(`Den Jahrgang ${yearText(from)} gibt es bei diesem Wein nicht.`);
  const notes = [
    "Alles dieses Jahrgangs zieht mit: Flaschen, Bewertungen, Verkostungen, Trinkfenster, Rebsorten und Fotos.",
    ...(target.any
      ? [
          `Jahrgang ${yearText(to)} gibt es schon – beide werden zusammengeführt. Vorhandene Angaben von ${yearText(to)} bleiben, leere werden ergänzt.`,
        ]
      : []),
  ];
  return ready(
    {
      title: wineTitle(wine),
      action: "Jahrgang ändern",
      changes: [{ label: "Jahrgang", before: yearText(from), after: yearText(to) }],
      notes,
    },
    wineId,
    async () => {
      const { error } = await vintageRpc(db, wineId, from, to);
      if (error) throw error;
      return `den Jahrgang ${yearText(from)} in ${yearText(to)} geändert${target.any ? " und mit dem bestehenden zusammengeführt" : ""}`;
    },
    to,
  );
}

async function prepareDrinkWindow(
  db: Db,
  wineId: string,
  year: number | null,
  from: number | null,
  until: number | null,
): Promise<PreparedEdit> {
  const wine = await loadWine(db, wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  for (const [v, label] of [[from, "Trinkreif ab"], [until, "Trinkreif bis"]] as const) {
    if (v != null && !(Number.isInteger(v) && v >= 1800 && v <= 2200)) return fail(`${label}: bitte eine Jahreszahl.`);
  }
  if (from != null && until != null && from > until) return fail("„Ab“ muss vor „bis“ liegen.");
  if (year != null && from != null && from < year) return fail("Trinkreif ab kann nicht vor dem Jahrgang liegen.");
  const { data: row, error } = await sameVintage(
    db.from("wine_vintages").select("id, drink_from_year, drink_until_year").eq("wine_id", wineId),
    year,
  ).maybeSingle();
  if (error) throw error;
  const changes: EditChange[] = [];
  diff(changes, "Trinkreif ab", show(row?.drink_from_year), show(from));
  diff(changes, "Trinkreif bis", show(row?.drink_until_year), show(until));
  return ready(
    { title: wineTitle(wine, year), action: "Trinkfenster ändern", changes, notes: [] },
    wineId,
    async () => {
      const values = { drink_from_year: from, drink_until_year: until };
      const { error: saveError } = row
        ? await db.from("wine_vintages").update(values).eq("id", row.id)
        : await db.from("wine_vintages").insert({ wine_id: wineId, vintage_year: year, ...values });
      if (saveError) throw saveError;
      return `das Trinkfenster auf ${from ?? "?"}–${until ?? "?"} gesetzt`;
    },
    year,
  );
}

// ---------------------------------------------------------------------------
// Charge

async function findVendor(db: Db, name: string) {
  const { data, error } = await db.from("vendors").select("id, name").ilike("name", exact(name)).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function prepareBatch(db: Db, itemId: string, set: BatchChanges): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Charge gibt es nicht mehr.");
  const changes: EditChange[] = [];
  const notes: string[] = [];
  const update: Database["public"]["Tables"]["inventory_items"]["Update"] = {};

  if (set.quantity !== undefined) {
    if (item.status !== "sealed") return fail("Die Anzahl gibt es nur bei ungeöffneten Flaschen.");
    if (set.quantity === 0) return fail("Für 0 Flaschen bitte die Charge löschen.");
    if (!Number.isInteger(set.quantity) || set.quantity < 1 || set.quantity > 999) return fail("Anzahl: bitte 1–999.");
    diff(changes, "Anzahl", String(item.quantity), String(set.quantity));
    update.quantity = set.quantity;
  }
  if (set.bottleSizeMl !== undefined) {
    if (!Number.isInteger(set.bottleSizeMl) || set.bottleSizeMl < 100 || set.bottleSizeMl > 30_000) {
      return fail("Flaschengrösse: bitte in ml, z. B. 750 oder 1500.");
    }
    diff(changes, "Flaschengrösse", show(formatBottleSize(item.bottle_size_ml ?? 750)), show(formatBottleSize(set.bottleSizeMl)));
    update.bottle_size_ml = set.bottleSizeMl;
  }
  if (set.purchasedAt !== undefined) {
    const invalid = set.purchasedAt && validDate(set.purchasedAt, "Kaufdatum");
    if (invalid) return fail(invalid);
    diff(changes, "Kaufdatum", date(item.purchased_at), date(set.purchasedAt));
    update.purchased_at = set.purchasedAt;
  }
  let newVendor: string | null = null;
  if (set.vendor !== undefined) {
    const name = clean(set.vendor);
    const existing = name ? await findVendor(db, name) : null;
    if (name && !existing) {
      newVendor = name;
      notes.push(`Händler „${name}“ gibt es noch nicht – wird neu angelegt.`);
    }
    diff(changes, "Händler", show(item.vendor?.name), show(existing?.name ?? name));
    update.vendor_id = existing?.id ?? null;
  }
  if (set.isGift !== undefined) {
    diff(changes, "Geschenk", item.is_gift ? "ja" : "nein", set.isGift ? "ja" : "nein");
    update.is_gift = set.isGift;
  }
  for (const [key, column, label] of [
    ["purchasePrice", "purchase_price", "Bezahlt"],
    ["regularPrice", "regular_price", "Normalpreis"],
  ] as const) {
    const value = set[key];
    if (value === undefined) continue;
    const invalid = validPrice(value, label);
    if (invalid) return fail(invalid);
    diff(changes, label, money(item[column]), money(value));
    update[column] = value;
  }
  if (!changes.length) return fail(NOTHING);

  return ready({ title: itemTitle(item), action: "Charge bearbeiten", changes, notes }, item.wine_id, async () => {
    if (newVendor) {
      const { data, error } = await db.from("vendors").insert({ name: newVendor }).select("id").single();
      if (error) throw error;
      update.vendor_id = data.id;
    }
    const { error } = await db.from("inventory_items").update(update).eq("id", itemId);
    if (error) throw error;
    return `${changes.map((c) => `${c.label} ${c.after}`).join(", ")} gespeichert`;
  }, item.vintage_year);
}

/** Gibt es am Ziel schon eine gleiche ungeöffnete Charge? (Dann führt move_bottles zusammen.) */
async function sameBatchAt(db: Db, item: Item, room: Room) {
  const eqOrNull = <Q extends { eq: (c: never, v: never) => Q; is: (c: never, v: null) => Q }>(q: Q, col: string, v: unknown) =>
    v == null ? q.is(col as never, null) : q.eq(col as never, v as never);
  let q = db
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("wine_id", item.wine_id)
    .eq("status", "sealed")
    .eq("storage_room", room)
    .neq("id", item.id)
    .eq("is_gift", item.is_gift);
  for (const [col, v] of [
    ["vintage_year", item.vintage_year],
    ["bottle_size_ml", item.bottle_size_ml],
    ["purchase_price", item.purchase_price],
    ["regular_price", item.regular_price],
    ["purchased_at", item.purchased_at],
    ["vendor_id", item.vendor_id],
  ] as const) {
    q = eqOrNull(q, col, v);
  }
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function prepareMove(db: Db, itemId: string, room: Room, count?: number): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Charge gibt es nicht mehr.");
  if (!ROOMS.includes(room)) return fail(`Unbekannter Lagerort. Möglich: ${ROOMS.join(", ")}.`);
  if (item.status === "drunk") return fail("Getrunkene Flaschen haben keinen Lagerort mehr.");
  if (item.storage_room === room) return fail(`Die Flaschen sind schon ${inRoom(room)}.`);
  const total = item.status === "sealed" ? item.quantity : 1;
  const n = count ?? total;
  if (!Number.isInteger(n) || n < 1 || n > total) return fail(`Anzahl: bitte 1–${total}.`);
  const partial = n < total;
  const notes = partial ? [`${bottles(total - n)} ${total - n === 1 ? "bleibt" : "bleiben"} ${inRoom(item.storage_room)}.`] : [];
  if (item.status === "sealed" && (await sameBatchAt(db, item, room))) {
    notes.push(`${inRoom(room).replace(/^./, (c) => c.toUpperCase())} liegt schon eine gleiche Charge – die Flaschen kommen dazu.`);
  }

  return ready(
    {
      title: itemTitle(item),
      action: "Verschieben",
      changes: [
        { label: "Lagerort", before: show(item.storage_room), after: room },
        ...(item.status === "sealed" ? [{ label: "Flaschen", before: String(total), after: partial ? `${n} von ${total}` : String(n) }] : []),
      ],
      notes,
    },
    item.wine_id,
    async () => {
      // Atomar in der DB: ganz oder teilweise, mit Zusammenführen am Ziel und genau einem Journal-Eintrag.
      const { error } = await db.rpc("move_bottles", {
        p_item_id: itemId,
        p_quantity: n,
        p_house: item.storage_house ?? "Zuhause",
        p_room: room,
      });
      if (error) throw error;
      return `${bottles(n)} ${intoRoom(room)} verschoben`;
    },
    item.vintage_year,
  );
}

async function prepareBatchVintage(db: Db, itemId: string, to: number | null): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Charge gibt es nicht mehr.");
  const invalid = validYear(to);
  if (invalid) return fail(invalid);
  if (item.vintage_year === to) return fail(NOTHING);
  const target = await vintageExists(db, item.wine_id, to);
  const notes = [
    `Nur diese Charge – Bewertungen, Verkostungen und Fotos bleiben bei ${yearText(item.vintage_year)}.`,
    ...(target.items ? [`Kommt zum bestehenden Jahrgang ${yearText(to)} dazu.`] : []),
  ];
  return ready(
    {
      title: itemTitle(item),
      action: "Jahrgang dieser Charge ändern",
      changes: [{ label: "Jahrgang", before: yearText(item.vintage_year), after: yearText(to) }],
      notes,
    },
    item.wine_id,
    async () => {
      const { error } = await vintageRpc(db, item.wine_id, item.vintage_year, to, itemId);
      if (error) throw error;
      return `den Jahrgang dieser Charge auf ${yearText(to)} geändert`;
    },
    to,
  );
}

async function prepareDeleteBatch(db: Db, itemId: string): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Charge gibt es nicht mehr.");
  const facts = [
    item.status === "sealed" ? bottles(item.quantity) : STATUS_TEXT[item.status],
    item.storage_room,
    item.purchased_at && `gekauft ${date(item.purchased_at)}`,
    item.purchase_price != null && money(item.purchase_price),
  ].filter(Boolean);
  return ready(
    {
      title: itemTitle(item),
      action: "Charge löschen",
      changes: [],
      notes: [`Wird endgültig gelöscht: ${facts.join(", ")}. Bewertungen und Verkostungen bleiben beim Wein.`],
    },
    item.wine_id,
    async () => {
      const { error } = await db.from("inventory_items").delete().eq("id", itemId);
      if (error) throw error;
      return `die Charge gelöscht (${facts[0]})`;
    },
    item.vintage_year,
  );
}

// ---------------------------------------------------------------------------
// Offene und getrunkene Flaschen

async function prepareOpenBottle(db: Db, itemId: string, fill?: number, openedOn?: string): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Flasche gibt es nicht mehr.");
  if (item.status !== "open") return fail("Diese Flasche ist nicht offen.");
  if (fill !== undefined && !(Number.isInteger(fill) && fill >= 1 && fill <= 100)) {
    return fail(fill === 0 ? "Bei 0 % bitte „Ausgetrunken“ wählen." : "Füllstand: bitte 1–100 %.");
  }
  if (openedOn !== undefined) {
    const invalid = validDate(openedOn, "Geöffnet am");
    if (invalid) return fail(invalid);
  }
  const changes: EditChange[] = [];
  if (fill !== undefined) diff(changes, "Füllstand", `${item.open?.fill_level_percent ?? "?"} %`, `${fill} %`);
  if (openedOn !== undefined) diff(changes, "Geöffnet am", date(item.open?.date_opened), date(openedOn));
  return ready({ title: itemTitle(item), action: "Offene Flasche", changes, notes: [] }, item.wine_id, async () => {
    const { error } = await db.from("open_bottle_details").upsert(
      {
        inventory_item_id: itemId,
        ...(fill !== undefined ? { fill_level_percent: fill } : {}),
        ...(openedOn !== undefined ? { date_opened: openedOn } : {}),
      },
      { onConflict: "inventory_item_id" },
    );
    if (error) throw error;
    return changes.map((c) => `${c.label === "Füllstand" ? "den Füllstand" : "„Geöffnet am“"} auf ${c.after}`).join(" und ") + " gesetzt";
  }, item.vintage_year);
}

async function prepareDrunkBottle(db: Db, itemId: string, drunkOn: string): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Flasche gibt es nicht mehr.");
  if (item.status !== "drunk") return fail("Diese Flasche ist nicht als getrunken erfasst.");
  const invalid = validDate(drunkOn, "Getrunken am");
  if (invalid) return fail(invalid);
  const changes: EditChange[] = [];
  diff(changes, "Getrunken am", date(zurichDate(item.drunk_at)), date(drunkOn));
  return ready({ title: itemTitle(item), action: "Getrunkene Flasche", changes, notes: [] }, item.wine_id, async () => {
    // Mittag UTC: bleibt in Europe/Zurich sicher derselbe Tag.
    const { error } = await db.from("inventory_items").update({ drunk_at: `${drunkOn}T12:00:00Z` }).eq("id", itemId);
    if (error) throw error;
    return `„Getrunken am“ auf ${date(drunkOn)} gesetzt`;
  }, item.vintage_year);
}

async function prepareReopen(db: Db, itemId: string, fill: number): Promise<PreparedEdit> {
  const item = await loadItem(db, itemId);
  if (!item) return fail("Diese Flasche gibt es nicht mehr.");
  if (item.status !== "drunk") return fail("Diese Flasche ist nicht als getrunken erfasst.");
  if (!(Number.isInteger(fill) && fill >= 1 && fill <= 100)) return fail("Füllstand: bitte 1–100 %.");
  return ready(
    {
      title: itemTitle(item),
      action: "Zurück auf offen",
      changes: [
        { label: "Status", before: "getrunken", after: "offen" },
        { label: "Füllstand", before: `${item.open?.fill_level_percent ?? 0} %`, after: `${fill} %` },
      ],
      notes: [],
    },
    item.wine_id,
    async () => {
      const { data, error } = await db.from("inventory_items").update({ status: "open" }).eq("id", itemId).eq("status", "drunk").select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Die Flasche ist nicht mehr als getrunken erfasst.");
      const { error: fillError } = await db
        .from("open_bottle_details")
        .upsert({ inventory_item_id: itemId, fill_level_percent: fill }, { onConflict: "inventory_item_id" });
      if (fillError) throw fillError;
      return `die Flasche wieder auf offen gesetzt (${fill} %)`;
    },
    item.vintage_year,
  );
}

// ---------------------------------------------------------------------------
// Rebsorten, Bewertungen, Verkostungen

async function prepareGrapes(db: Db, edit: Extract<Edit, { kind: "grapes" }>): Promise<PreparedEdit> {
  const wine = await loadWine(db, edit.wineId);
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  for (const s of edit.shares) {
    if (!clean(s.grape)) return fail("Bitte bei jedem Anteil auch die Rebsorte angeben.");
    if (s.percent != null && !(Number.isFinite(s.percent) && s.percent > 0 && s.percent <= 100)) {
      return fail(`Ungültiger Anteil bei ${s.grape} (1–100 %).`);
    }
  }
  if (percentSum(edit.shares) > 100.5) {
    return fail(`Die Anteile ergeben ${percentSum(edit.shares).toLocaleString("de-CH")} % – höchstens 100 %.`);
  }
  const shares = normalizeGrapeShares(edit.shares);
  const current = await loadGrapeShares(db, edit.wineId, edit.year);
  const before = current && current.vintageYear === edit.year ? formatShares(current.shares) : "";
  const changes: EditChange[] = [];
  diff(changes, "Rebsorten", before || DASH, formatShares(shares) || DASH);
  return ready(
    {
      title: wineTitle(wine, edit.year),
      action: "Rebsorten ändern",
      changes,
      notes: edit.year == null ? ["Gilt für alle Jahrgänge ohne eigene Angaben."] : [],
    },
    edit.wineId,
    async () => {
      await replaceGrapeShares(db, { wineId: edit.wineId, vintageYear: edit.year, shares, source: "manual", keepManual: false });
      return `die Rebsorten gespeichert (${formatShares(shares) || "keine"})`;
    },
    edit.year,
  );
}

async function prepareRating(db: Db, edit: Extract<Edit, { kind: "rating" }>): Promise<PreparedEdit> {
  const [wine, { data: person, error: pErr }] = await Promise.all([
    loadWine(db, edit.wineId),
    db.from("persons").select("id, name").eq("id", edit.personId).maybeSingle(),
  ]);
  if (pErr) throw pErr;
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  if (!person) return fail("Diese Person gibt es nicht.");
  if (edit.rating != null && !isValidRating(edit.rating)) return fail("Bewertung: 0–5 Sterne in halben Schritten.");
  const { data: rows, error } = await sameVintage(
    db.from("wine_ratings").select("id, rating, rated_at").eq("wine_id", edit.wineId).eq("person_id", edit.personId),
    edit.year,
  ).order("rated_at", { ascending: false });
  if (error) throw error;
  const latest = rows?.[0]?.rating ?? null;
  const stars = (v: number | null) => (v == null ? DASH : `${v.toLocaleString("de-CH")} ★`);
  const label = `Bewertung ${person.name}`;

  if (edit.rating == null) {
    if (!rows?.length) return fail(`${person.name} hat diesen Jahrgang noch nicht bewertet.`);
    return ready(
      {
        title: wineTitle(wine, edit.year),
        action: "Bewertung löschen",
        changes: [{ label, before: stars(latest), after: "gelöscht" }],
        notes: rows.length > 1 ? [`Auch die ${rows.length - 1} früheren Bewertungen (Verlauf) werden gelöscht.`] : [],
      },
      edit.wineId,
      async () => {
        const { error: delError } = await db.from("wine_ratings").delete().in("id", rows.map((r) => r.id));
        if (delError) throw delError;
        return `die Bewertung von ${person.name} gelöscht`;
      },
      edit.year,
    );
  }
  const changes: EditChange[] = [];
  diff(changes, label, stars(latest), stars(edit.rating));
  return ready({ title: wineTitle(wine, edit.year), action: "Bewertung", changes, notes: [] }, edit.wineId, async () => {
    await saveRating(db, { wineId: edit.wineId, vintageYear: edit.year, itemId: edit.itemId ?? null }, person.id, edit.rating);
    return `die Bewertung von ${person.name} auf ${stars(edit.rating)} gesetzt`;
  }, edit.year);
}

async function loadTasting(db: Db, tastingId: string) {
  const { data, error } = await db
    .from("wine_tastings")
    .select("id, wine_id, vintage_year, tasted_at, notes, quality_level, person_id, person:persons(name), wine:wines(name, producer)")
    .eq("id", tastingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function prepareTasting(db: Db, edit: Extract<Edit, { kind: "tasting" }>): Promise<PreparedEdit> {
  const t = await loadTasting(db, edit.tastingId);
  if (!t) return fail("Diese Verkostung gibt es nicht mehr.");
  const update: Database["public"]["Tables"]["wine_tastings"]["Update"] = {};
  const changes: EditChange[] = [];
  if (edit.set.tastedOn !== undefined) {
    const invalid = validDate(edit.set.tastedOn, "Verkostet am");
    if (invalid) return fail(invalid);
    diff(changes, "Verkostet am", date(t.tasted_at), date(edit.set.tastedOn));
    update.tasted_at = edit.set.tastedOn;
  }
  if (edit.set.personId !== undefined) {
    let name: string | null = null;
    if (edit.set.personId) {
      const { data: p, error } = await db.from("persons").select("name").eq("id", edit.set.personId).maybeSingle();
      if (error) throw error;
      if (!p) return fail("Diese Person gibt es nicht.");
      name = p.name;
    }
    diff(changes, "Person", show(t.person?.name), show(name));
    update.person_id = edit.set.personId;
  }
  if (edit.set.notes !== undefined) {
    const notes = clean(edit.set.notes);
    diff(changes, "Notizen", show(t.notes), show(notes));
    update.notes = notes;
  }
  const title = `Verkostung ${wineTitle(t.wine, t.vintage_year)} vom ${date(t.tasted_at)}`;
  return ready({ title, action: "Verkostung bearbeiten", changes, notes: [] }, t.wine_id, async () => {
    const { error } = await db.from("wine_tastings").update(update).eq("id", t.id);
    if (error) throw error;
    return "die Verkostung gespeichert";
  }, t.vintage_year);
}

async function prepareDeleteTasting(db: Db, tastingId: string): Promise<PreparedEdit> {
  const t = await loadTasting(db, tastingId);
  if (!t) return fail("Diese Verkostung gibt es nicht mehr.");
  return ready(
    {
      title: `${wineTitle(t.wine, t.vintage_year)} vom ${date(t.tasted_at)}${t.person ? ` (${t.person.name})` : ""}`,
      action: "Verkostung löschen",
      changes: [],
      notes: [`Wird endgültig gelöscht${t.quality_level ? ` (Qualität: ${t.quality_level})` : ""}.`],
    },
    t.wine_id,
    async () => {
      const { error } = await db.from("wine_tastings").delete().eq("id", t.id);
      if (error) throw error;
      return "die Verkostung gelöscht";
    },
    t.vintage_year,
  );
}

// ---------------------------------------------------------------------------
// Einstieg

/** Prüft eine Bearbeitung gegen den aktuellen Stand und beschreibt sie (ändert noch nichts). */
export async function prepareEdit(db: Db, edit: Edit): Promise<PreparedEdit> {
  switch (edit.kind) {
    case "wine":
      return prepareWine(db, edit.wineId, edit.set);
    case "vintage":
      return prepareVintage(db, edit.wineId, edit.from, edit.to);
    case "drinkWindow":
      return prepareDrinkWindow(db, edit.wineId, edit.year, edit.from, edit.until);
    case "batch":
      return prepareBatch(db, edit.itemId, edit.set);
    case "move":
      return prepareMove(db, edit.itemId, edit.room, edit.count);
    case "batchVintage":
      return prepareBatchVintage(db, edit.itemId, edit.to);
    case "deleteBatch":
      return prepareDeleteBatch(db, edit.itemId);
    case "openBottle":
      return prepareOpenBottle(db, edit.itemId, edit.fill, edit.openedOn);
    case "drunkBottle":
      return prepareDrunkBottle(db, edit.itemId, edit.drunkOn);
    case "reopen":
      return prepareReopen(db, edit.itemId, edit.fill);
    case "grapes":
      return prepareGrapes(db, edit);
    case "rating":
      return prepareRating(db, edit);
    case "tasting":
      return prepareTasting(db, edit);
    case "deleteTasting":
      return prepareDeleteTasting(db, edit.tastingId);
  }
}

function errorText(error: unknown) {
  const code = (error as PostgrestError | null)?.code;
  if (code === "23505") return "Das gibt es schon (gleicher Name) – nichts geändert.";
  if (code === "42501") return "Keine Berechtigung – nichts geändert.";
  if (code === "22023") return "Ungültiger Wert – nichts geändert.";
  if (code === "P0002") return "Das passt nicht mehr zum aktuellen Stand – nichts geändert.";
  return "Speichern ist fehlgeschlagen – nichts geändert.";
}

/**
 * Prüft (nochmals, mit dem aktuellen Stand) und führt aus. `message` passt für die App
 * („2 Flaschen ins Wohnzimmer verschoben.“), `done` für den Bot („Ich habe … “).
 */
export async function applyEdit(db: Db, edit: Edit): Promise<EditResult & { done?: string }> {
  try {
    const prepared = await prepareEdit(db, edit);
    if (!prepared.ok) return prepared;
    const done = await prepared.run();
    return { ok: true, message: `${capitalize(done)}.`, done, wineId: prepared.wineId, year: prepared.year };
  } catch (error) {
    console.error("edit failed", edit.kind, error);
    return { ok: false, error: errorText(error) };
  }
}

/**
 * Mehrere Bearbeitungen nacheinander (z. B. ein Chargen-Formular: Angaben, Lagerort,
 * Jahrgang). Jede wird erst unmittelbar vor dem Ausführen geprüft; unveränderte fallen weg.
 */
export async function applyEdits(db: Db, edits: Edit[]): Promise<EditResult> {
  const done: string[] = [];
  let last: EditResult | null = null;
  for (const edit of edits) {
    const result = await applyEdit(db, edit);
    if (!result.ok && result.error === NOTHING) continue;
    if (!result.ok) {
      return done.length ? { ok: false, error: `${capitalize(done.join(", "))} – aber: ${result.error}` } : result;
    }
    done.push(result.done ?? result.message);
    last = result;
  }
  if (!last?.ok) return { ok: false, error: NOTHING };
  return { ...last, message: `${capitalize(done.join(", "))}.` };
}
