"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { parsePrice, todayIso } from "@/lib/format";

export type ActionState = { error?: string; ok?: string } | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readItemId(formData: FormData) {
  const id = String(formData.get("itemId") ?? "");
  return UUID_RE.test(id) ? id : null;
}

function readFillLevel(formData: FormData) {
  const raw = formData.get("fillLevel");
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

async function memberSession() {
  const session = await getSession();
  return session.isMember ? session : null;
}

/** Öffnet eine Flasche aus einer ungeöffneten Charge (atomar via RPC). */
export async function openBottle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await memberSession();
  if (!session) return { error: "Kein Zugriff." };

  const itemId = readItemId(formData);
  const fillLevel = readFillLevel(formData) ?? 100;
  const dateRaw = String(formData.get("dateOpened") ?? "");
  const dateOpened = DATE_RE.test(dateRaw) ? dateRaw : todayIso();
  if (!itemId) return { error: "Ungültige Position." };

  const { data: openId, error } = await session.supabase.rpc("open_bottle", {
    p_item_id: itemId,
    p_fill_level_percent: fillLevel,
    p_date_opened: dateOpened,
  });

  if (error || !openId) {
    console.error("open_bottle failed", error);
    return { error: "Die Flasche konnte nicht geöffnet werden." };
  }

  const { data: opened } = await session.supabase
    .from("inventory_items")
    .select("wine_id, vintage_year")
    .eq("id", openId)
    .single();

  revalidatePath("/", "layout");
  redirect(opened ? wineHref(opened.wine_id, opened.vintage_year, { geoeffnet: "1" }) : "/offen");
}

/** Setzt den Füllstand einer offenen Flasche. */
export async function updateFillLevel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await memberSession();
  if (!session) return { error: "Kein Zugriff." };

  const itemId = readItemId(formData);
  const fillLevel = readFillLevel(formData);
  if (!itemId) return { error: "Ungültige Position." };
  if (fillLevel == null) return { error: "Füllstand muss zwischen 0 und 100 % liegen." };

  const { data: item, error: itemError } = await session.supabase
    .from("inventory_items")
    .select("status")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError || !item) return { error: "Position nicht gefunden." };
  if (item.status !== "open") return { error: "Nur offene Flaschen haben einen Füllstand." };

  const { error } = await session.supabase
    .from("open_bottle_details")
    .upsert(
      { inventory_item_id: itemId, fill_level_percent: fillLevel },
      { onConflict: "inventory_item_id" },
    );

  if (error) {
    console.error("update fill level failed", error);
    return { error: "Füllstand konnte nicht gespeichert werden." };
  }

  revalidatePath("/", "layout");
  return { ok: `Füllstand auf ${fillLevel} % gesetzt.` };
}

/** Markiert eine offene Flasche als ausgetrunken. */
export async function markDrunk(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await memberSession();
  if (!session) return { error: "Kein Zugriff." };

  const itemId = readItemId(formData);
  if (!itemId) return { error: "Ungültige Position." };

  const { data: updated, error } = await session.supabase
    .from("inventory_items")
    .update({ status: "drunk" })
    .eq("id", itemId)
    .eq("status", "open")
    .select("id, wine_id, vintage_year");

  if (error) {
    console.error("mark drunk failed", error);
    return { error: "Konnte nicht als ausgetrunken markiert werden." };
  }
  if (!updated?.length) return { error: "Diese Flasche ist nicht (mehr) offen." };

  await session.supabase
    .from("open_bottle_details")
    .update({ fill_level_percent: 0 })
    .eq("inventory_item_id", itemId);

  revalidatePath("/", "layout");
  redirect(wineHref(updated[0].wine_id, updated[0].vintage_year, { ausgetrunken: "1" }));
}

/** Leeres Feld = kein Preis (null); sonst muss die Eingabe ein gültiger Preis sein. */
function readPrice(formData: FormData, name: string): number | null | undefined {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  return parsePrice(raw) ?? undefined;
}

/** Ändert bezahlten Preis und Normalpreis einer Position. */
export async function updatePrices(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await memberSession();
  if (!session) return { error: "Kein Zugriff." };

  const itemId = readItemId(formData);
  if (!itemId) return { error: "Ungültige Position." };

  const purchasePrice = readPrice(formData, "purchasePrice");
  const regularPrice = readPrice(formData, "regularPrice");
  if (purchasePrice === undefined || regularPrice === undefined) {
    return { error: "Bitte Preise wie 24.50 eingeben oder das Feld leer lassen." };
  }

  const { data, error } = await session.supabase
    .from("inventory_items")
    .update({ purchase_price: purchasePrice, regular_price: regularPrice })
    .eq("id", itemId)
    .select("id");

  if (error) {
    console.error("update prices failed", error);
    return { error: "Preise konnten nicht gespeichert werden." };
  }
  if (!data?.length) return { error: "Position nicht gefunden." };

  revalidatePath("/", "layout");
  return { ok: "Preise gespeichert." };
}
