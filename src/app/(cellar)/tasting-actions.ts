"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { applyEdit } from "@/lib/edit/edit";
import { loadTastingTarget, storeTasting, type TastingTarget } from "@/lib/tasting/save";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberSession() {
  const session = await getSession();
  return session.isMember ? session : null;
}

export type { TastingTarget } from "@/lib/tasting/save";

async function loadTarget(target: TastingTarget) {
  const session = await memberSession();
  if (!session) return null;
  const ctx = await loadTastingTarget(session.supabase, target);
  return ctx ? { session, ...ctx } : null;
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
 * Speichert eine WSET-Bewertung – mit Flasche, mit Eintrag „Verkostet“ oder nur für Wein +
 * Jahrgang (gemeinsame Logik in lib/tasting/save).
 */
export async function saveTasting(input: {
  target: TastingTarget;
  tastingId: string | null;
  personId: string | null;
  sat: unknown;
}): Promise<SaveTastingResult> {
  const session = await memberSession();
  if (!session) return { ok: false, error: "Kein Zugriff." };
  const result = await storeTasting(session.supabase, { ...input, today: todayIso() });
  if (!result.ok) return result;
  revalidatePath(`/wein/${result.wineId}`);
  return { ok: true, id: result.id };
}

export async function deleteTasting(target: TastingTarget, tastingId: string) {
  const ctx = await loadTarget(target);
  if (!ctx || !UUID_RE.test(tastingId)) return { ok: false as const, error: "Kein Zugriff." };
  const result = await applyEdit(ctx.session.supabase, { kind: "deleteTasting", tastingId });
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath(`/wein/${ctx.item.wine_id}`);
  return { ok: true as const };
}

/**
 * Bewertung einer Person für Wein + Jahrgang der Flasche setzen; null löscht sie samt
 * Verlauf (gemeinsames Bearbeiten-Modul, wie im Bot).
 */
export async function setRating(itemId: string, personId: string, rating: number | null) {
  const ctx = await loadItem(itemId);
  if (!ctx || !UUID_RE.test(personId)) return { ok: false as const, error: "Kein Zugriff." };
  const result = await applyEdit(ctx.session.supabase, {
    kind: "rating",
    wineId: ctx.item.wine_id,
    year: ctx.item.vintage_year,
    personId,
    rating,
    itemId: ctx.item.id,
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  revalidatePath(`/wein/${ctx.item.wine_id}`);
  return { ok: true as const };
}
