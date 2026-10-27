import "server-only";

import type { AdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/database.types";
import { grapeNames, type StorageRoom, type WineProposal } from "./schema";

type Wine = Tables<"wines">;

/** ILIKE-Muster ohne Platzhalter = Gleichheit ohne Gross-/Kleinschreibung. */
function exactILike(value: string) {
  return value.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Sucht einen bestehenden Wein über Name + Produzent (case-insensitiv). */
export async function findWine(db: AdminClient, name: string | null, producer: string | null) {
  if (!name?.trim() || !producer?.trim()) return null;
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
    type: wine.type ?? proposal.type,
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
      producer: proposal.producer!.trim(),
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
  },
) {
  const { data, error } = await db
    .from("inventory_items")
    .insert({
      wine_id: input.wineId,
      vintage_year: input.proposal.vintage_year,
      bottle_size_ml: input.proposal.bottle_size_ml,
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
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Händler für die Buttons: aktive, alphabetisch (höchstens zwölf). */
export async function listVendors(db: AdminClient) {
  const { data, error } = await db
    .from("vendors")
    .select("id, name")
    .eq("archived", false)
    .order("name")
    .limit(12);
  if (error) throw error;
  return data ?? [];
}

/** Händler per Name finden (ohne Gross-/Kleinschreibung) oder neu anlegen. */
export async function resolveVendor(db: AdminClient, rawName: string) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const find = async () => {
    const { data, error } = await db
      .from("vendors")
      .select("id, name")
      .ilike("name", exactILike(name))
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  };
  const existing = await find();
  if (existing) return existing;

  const { data, error } = await db.from("vendors").insert({ name }).select("id, name").single();
  // Unique-Index vendors_name_uq: parallel angelegt → den vorhandenen nehmen.
  if (error?.code === "23505") {
    const again = await find();
    if (again) return again;
  }
  if (error) throw error;
  return data;
}
