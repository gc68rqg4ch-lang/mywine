"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { wineHref } from "@/lib/cellar/wine-page";
import { applyEdit } from "@/lib/edit/edit";
import { NOTHING } from "@/lib/edit/helpers";
import { cleanNotes } from "@/lib/edit/notes";
import { todayIso } from "@/lib/format";
import { emptySpiritBottle, setSpiritFill } from "@/lib/spirits/bottles";

export type ActionState = { error?: string; ok?: string; link?: { href: string; label: string } } | undefined;

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

/** Setzt den Füllstand einer offenen Flasche (gemeinsames Bearbeiten-Modul). */
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

  const result = await applyEdit(session.supabase, { kind: "openBottle", itemId, fill: fillLevel });
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return { ok: result.message };
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

/**
 * Notizen zum Wein automatisch speichern (Feld auf der Weinseite, ohne ✏️): getrimmt, leer →
 * NULL. Kein Neuladen der Seite (die Listen laden ohnehin frisch). Liefert die gespeicherte Form.
 */
export async function saveWineNotes(wineId: string, text: string): Promise<{ ok: true; notes: string | null } | { ok: false; error: string }> {
  if (!UUID_RE.test(wineId)) return { ok: false, error: "Kein Zugriff." };
  // Ohne Umleitung auf /login (wie getSession): sonst wäre der getippte Text weg.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, error: "Nicht mehr angemeldet." };
  const { data: member } = await supabase.from("app_members").select("user_id").eq("user_id", userId).maybeSingle();
  if (!member) return { ok: false, error: "Kein Zugriff." };
  const result = await applyEdit(supabase, { kind: "wineNotes", wineId, notes: typeof text === "string" ? text : "" });
  // „Nichts zu ändern“ ist kein Fehler – die Notiz steht schon so in der DB.
  if (result.ok || result.error === NOTHING) return { ok: true, notes: cleanNotes(text) };
  return { ok: false, error: result.error };
}

/**
 * Spirituose: Füllstand der aktuellen Flasche speichern (Regler auf der Weinseite, speichert
 * selbst wie die Notizen). 0 % ist „leer“ – dafür emptySpiritAction (mit Bestätigung).
 */
export async function saveSpiritFill(wineId: string, percent: number): Promise<{ ok: true; fill: number } | { ok: false; error: string }> {
  const session = await memberSession();
  if (!session) return { ok: false, error: "Kein Zugriff." };
  if (!UUID_RE.test(wineId)) return { ok: false, error: "Ungültiger Wein." };
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return { ok: false, error: "Füllstand bitte zwischen 10 und 100 %." };
  const result = await setSpiritFill(session.supabase, wineId, percent);
  if (!result.ok) return result;
  return { ok: true, fill: result.fill };
}

/** Spirituose: aktuelle Flasche leer – getrunken, die nächste volle wird aktuell (100 %). */
export async function emptySpiritAction(wineId: string): Promise<{ ok: true; message: string; remaining: number } | { ok: false; error: string }> {
  const session = await memberSession();
  if (!session) return { ok: false, error: "Kein Zugriff." };
  if (!UUID_RE.test(wineId)) return { ok: false, error: "Ungültiger Wein." };
  const result = await emptySpiritBottle(session.supabase, wineId);
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return {
    ok: true,
    remaining: result.remaining,
    message:
      result.remaining > 0
        ? `Als getrunken gebucht – noch ${result.remaining === 1 ? "1 Flasche" : `${result.remaining} Flaschen`}, neue aktuelle Flasche 100 %.`
        : "Als getrunken gebucht – das war die letzte Flasche, nicht mehr im Bestand.",
  };
}
