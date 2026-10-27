"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { isValidRating, saveRating } from "@/lib/ratings";
import { tastingRow } from "@/lib/tasting/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberSession() {
  const session = await getSession();
  return session.isMember ? session : null;
}

async function loadItem(itemId: string) {
  const session = await memberSession();
  if (!session || !UUID_RE.test(itemId)) return null;
  const { data } = await session.supabase
    .from("inventory_items")
    .select("id, wine_id, vintage_year")
    .eq("id", itemId)
    .maybeSingle();
  return data ? { session, item: data } : null;
}

export type SaveTastingResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Speichert eine WSET-Verkostung: Stil, Qualität, Punkte und Trinkreife in die eigenen
 * Spalten, das komplette Formular (Struktur wie im Verkostungs-Tool) als JSON in sat.
 */
export async function saveTasting(input: {
  itemId: string;
  tastingId: string | null;
  personId: string | null;
  sat: unknown;
}): Promise<SaveTastingResult> {
  const ctx = await loadItem(input.itemId);
  if (!ctx) return { ok: false, error: "Kein Zugriff oder Flasche nicht gefunden." };
  if (input.tastingId && !UUID_RE.test(input.tastingId)) return { ok: false, error: "Ungültige Verkostung." };
  if (input.personId && !UUID_RE.test(input.personId)) return { ok: false, error: "Ungültige Person." };

  const row = tastingRow({ item: ctx.item, personId: input.personId, sat: input.sat, today: todayIso(), source: "app" });

  // Beim Bearbeiten bleibt die Herkunft (z. B. „bot“) erhalten.
  const changes: Omit<typeof row, "source"> & { source?: string } = { ...row };
  delete changes.source;
  const { data, error } = await (input.tastingId
    ? ctx.session.supabase.from("wine_tastings").update(changes).eq("id", input.tastingId).select("id").single()
    : ctx.session.supabase.from("wine_tastings").insert(row).select("id").single());
  if (error || !data) {
    console.error("save tasting failed", error);
    return { ok: false, error: "Die Verkostung konnte nicht gespeichert werden." };
  }

  revalidatePath(`/wein/${ctx.item.wine_id}`);
  return { ok: true, id: data.id };
}

export async function deleteTasting(itemId: string, tastingId: string) {
  const ctx = await loadItem(itemId);
  if (!ctx || !UUID_RE.test(tastingId)) return { ok: false as const, error: "Kein Zugriff." };
  const { error } = await ctx.session.supabase.from("wine_tastings").delete().eq("id", tastingId);
  if (error) {
    console.error("delete tasting failed", error);
    return { ok: false as const, error: "Löschen fehlgeschlagen." };
  }
  revalidatePath(`/wein/${ctx.item.wine_id}`);
  return { ok: true as const };
}

/** Subjektive Bewertung einer Person für Wein + Jahrgang der Flasche (siehe saveRating). */
export async function setRating(itemId: string, personId: string, rating: number | null) {
  const ctx = await loadItem(itemId);
  if (!ctx || !UUID_RE.test(personId)) return { ok: false as const, error: "Kein Zugriff." };
  if (rating != null && !isValidRating(rating)) {
    return { ok: false as const, error: "Bewertung muss zwischen 0 und 5 in halben Schritten liegen." };
  }

  try {
    await saveRating(
      ctx.session.supabase,
      { wineId: ctx.item.wine_id, vintageYear: ctx.item.vintage_year, itemId: ctx.item.id },
      personId,
      rating,
    );
  } catch (error) {
    console.error("set rating failed", error);
    return { ok: false as const, error: "Bewertung konnte nicht gespeichert werden." };
  }
  revalidatePath(`/wein/${ctx.item.wine_id}`);
  return { ok: true as const };
}
