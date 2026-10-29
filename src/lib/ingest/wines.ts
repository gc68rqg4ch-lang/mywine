import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/database.types";
import { asWineType } from "@/lib/format";
import { bottleSizeOf, grapeNames, type StorageRoom, type WineProposal } from "./schema";
import { similarWines } from "./wine-names";

type Wine = Tables<"wines">;

/** ILIKE-Muster ohne Platzhalter = Gleichheit ohne Gross-/Kleinschreibung. */
function exactILike(value: string) {
  return value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Sucht einen bestehenden Wein über Name + Produzent (case-insensitiv); ohne Produzent nur
 * über den Namen, und nur wenn er eindeutig ist (Nachkauf, „gibt es den Wein schon?“).
 */
export async function findWine(db: AdminClient, name: string | null, producer: string | null) {
  if (!name?.trim()) return null;
  if (!producer?.trim()) return findWineByName(db, name);
  const { data, error } = await db
    .from("wines")
    .select("*")
    .ilike("name", exactILike(name))
    .ilike("producer", exactILike(producer))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Bestehende Weine trotz anderer Schreibweise (bis 3) – nur aufrufen, wenn findWine nichts findet.
 * Akzente, Füllwörter, Bodegas/Quinta/…, Produzent im Namen egal (siehe wine-names.ts).
 */
export async function findSimilarWines(db: AdminClient, name: string | null, producer: string | null) {
  if (!name?.trim()) return [];
  const { data, error } = await db.from("wines").select("id, name, producer, type, country");
  if (error) throw error;
  return similarWines(name, producer, data ?? []);
}

/**
 * Ergänzt leere Felder des Vorschlags aus den Stammdaten eines bekannten Weins.
 * Name und Produzent werden in der Schreibweise der Stammdaten übernommen.
 */
export function mergeWithKnownWine(proposal: WineProposal, wine: Wine): WineProposal {
  return {
    ...proposal,
    name: wine.name,
    producer: wine.producer,
    country: wine.country ?? proposal.country,
    region: wine.region ?? proposal.region,
    appellation: wine.appellation ?? proposal.appellation,
    type: asWineType(wine.type) ?? proposal.type,
    alcohol_content: wine.alcohol_content ?? proposal.alcohol_content,
  };
}

/** Bestehenden Wein wiederverwenden oder neu anlegen. */
export async function resolveWine(
  db: AdminClient,
  proposal: WineProposal,
  matchedWineId: string | null,
): Promise<string> {
  if (matchedWineId) {
    const { data } = await db.from("wines").select("id").eq("id", matchedWineId).maybeSingle();
    if (data) return data.id;
  }

  const existing = await findWine(db, proposal.name, proposal.producer);
  if (existing) return existing.id;

  const { data, error } = await db
    .from("wines")
    .insert({
      name: proposal.name!.trim(),
      // Produzent darf fehlen (wird später ergänzt bzw. recherchiert).
      producer: proposal.producer?.trim() || null,
      country: proposal.country,
      region: proposal.region,
      appellation: proposal.appellation,
      type: proposal.type,
      grapes: grapeNames(proposal),
      alcohol_content: proposal.alcohol_content,
    })
    .select("id")
    .single();

  // Unique-Index wines_name_producer_uq: parallel angelegt → den vorhandenen nehmen.
  if (error?.code === "23505") {
    const again = await findWine(db, proposal.name, proposal.producer);
    if (again) return again.id;
  }
  if (error) throw error;
  return data.id;
}

export async function createInventoryItem(
  db: AdminClient,
  input: {
    wineId: string;
    proposal: WineProposal;
    quantity: number;
    price: number | null;
    regularPrice: number | null;
    vendorId: string | null;
    purchasedAt: string;
    storageRoom: StorageRoom;
    photoPaths: string[];
    /** Geschenk: is_gift; giftFrom nur mit Geschenk (DB-Check). */
    isGift?: boolean;
    giftFrom?: string | null;
  },
) {
  const { data, error } = await db
    .from("inventory_items")
    .insert({
      wine_id: input.wineId,
      vintage_year: input.proposal.vintage_year,
      bottle_size_ml: bottleSizeOf(input.proposal),
      quantity: input.quantity,
      purchase_price: input.price,
      regular_price: input.regularPrice,
      purchased_at: input.purchasedAt,
      vendor_id: input.vendorId,
      currency: "CHF",
      storage_house: "Zuhause",
      storage_room: input.storageRoom,
      status: "sealed",
      photo_urls: input.photoPaths,
      is_gift: Boolean(input.isGift),
      gift_from: input.isGift ? (input.giftFrom ?? null) : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** So viele meistgenutzte Händler als Knöpfe; dazu „📋 Alle Händler“. */
export const TOP_VENDORS = 8;

type VendorRow = { id: string; name: string };
type VendorUse = { vendor_id: string | null; purchased_at: string | null; created_at: string };

/**
 * Meistgenutzte Händler zuerst (rein): Anzahl Chargen, bei Gleichstand zuletzt benutzt, dann
 * alphabetisch. Unbenutzte kommen nach den benutzten (alphabetisch).
 */
export function rankVendors(vendors: VendorRow[], uses: VendorUse[], max = TOP_VENDORS): VendorRow[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const u of uses) {
    if (!u.vendor_id) continue;
    const s = stats.get(u.vendor_id) ?? { count: 0, last: "" };
    const at = u.purchased_at ?? u.created_at;
    stats.set(u.vendor_id, { count: s.count + 1, last: at > s.last ? at : s.last });
  }
  return [...vendors]
    .sort((a, b) => {
      const x = stats.get(a.id) ?? { count: 0, last: "" };
      const y = stats.get(b.id) ?? { count: 0, last: "" };
      return y.count - x.count || (y.last > x.last ? 1 : y.last < x.last ? -1 : 0) || a.name.localeCompare(b.name, "de");
    })
    .slice(0, max);
}

/** Alle aktiven Händler, alphabetisch. */
export async function listAllVendors(db: AdminClient): Promise<VendorRow[]> {
  const { data, error } = await db.from("vendors").select("id, name").eq("archived", false).order("name");
  if (error) throw error;
  return [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * Händler für die Knöpfe: die meistgenutzten aktiven (höchstens 8); more = es gibt weitere
 * (Knopf „📋 Alle Händler“).
 */
export async function listVendors(db: AdminClient): Promise<VendorRow[] & { more?: boolean }> {
  const all = await listAllVendors(db);
  const { data: uses, error } = await db.from("inventory_items").select("vendor_id, purchased_at, created_at").not("vendor_id", "is", null);
  if (error) throw error;
  const top: VendorRow[] & { more?: boolean } = rankVendors(all, uses ?? []);
  top.more = all.length > top.length;
  return top;
}

/**
 * Vergleichsschlüssel eines Händlernamens (rein): klein, ohne Akzente, Apostrophe und Satzzeichen,
 * ohne Domain-Endung – „Otto's“ = „Otto‘s“ = „ottos“, „Drinks.ch“ = „Drinks“.
 */
export function vendorKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/\.(ch|com|de|swiss|it|fr|at|net|shop)\b/g, "")
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** Ähnlicher bestehender Händler (gleicher Schlüssel, andere Schreibweise) – für „Meinst du …?“; sonst null. */
export function similarVendor(vendors: VendorRow[], name: string): VendorRow | null {
  const key = vendorKey(name);
  if (!key) return null;
  const exact = name.trim().toLowerCase();
  return vendors.find((v) => vendorKey(v.name) === key && v.name.trim().toLowerCase() !== exact) ?? null;
}

/** Händler mit genau diesem Namen (ohne Gross-/Kleinschreibung); sonst null. */
export async function findVendor(db: AdminClient, rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const { data, error } = await db.from("vendors").select("id, name").ilike("name", exactILike(name)).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Händler per Name finden (ohne Gross-/Kleinschreibung) oder neu anlegen. similar: einen
 * aktiven Händler mit gleichem Schlüssel (andere Schreibweise) nehmen statt doppelt anzulegen.
 */
export async function resolveVendor(db: AdminClient, rawName: string, options: { similar?: boolean } = {}) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const existing = await findVendor(db, name);
  if (existing) return existing;
  if (options.similar) {
    const like = similarVendor(await listAllVendors(db), name);
    if (like) return like;
  }

  const { data, error } = await db.from("vendors").insert({ name }).select("id, name").single();
  // Unique-Index vendors_name_uq: parallel angelegt → den vorhandenen nehmen.
  if (error?.code === "23505") {
    const again = await findVendor(db, name);
    if (again) return again;
  }
  if (error) throw error;
  return data;
}

/**
 * Bestehender Wein nur über den Namen (Erfassung per Text ohne Produzent) – nur wenn
 * der Name eindeutig ist.
 */
export async function findWineByName(db: AdminClient, name: string | null) {
  if (!name?.trim()) return null;
  const { data, error } = await db.from("wines").select("*").ilike("name", exactILike(name)).limit(2);
  if (error) throw error;
  return data?.length === 1 ? data[0] : null;
}
