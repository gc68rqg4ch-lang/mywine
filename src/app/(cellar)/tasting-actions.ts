"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import { applyEdit } from "@/lib/edit/edit";
import { tastingRow } from "@/lib/tasting/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberSession() {
  const session = await getSession();
  return session.isMember ? session : null;
}

/** Woran eine WSET-Verkostung hängt: eine Flasche oder ein Eintrag „Verkostet“. */
export type TastingTarget = { kind: "item" | "encounter"; id: string };

async function loadTarget(target: TastingTarget) {
  if (target.kind === "item") {
    const ctx = await loadItem(target.id);
    return ctx ? { ...ctx, encounterId: null } : null;
  }
  const session = await memberSession();
  if (!session || !UUID_RE.test(target.id)) return null;
  const { data } = await session.supabase
    .from("wine_encounters")
    .select("id, wine_id, vintage_year")
    .eq("id", target.id)
    .maybeSingle();
  return data
    ? { session, item: { id: null, wine_id: data.wine_id, vintage_year: data.vintage_year }, encounterId: data.id }
    : null;
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
  target: TastingTarget;
  tastingId: string | null;
  personId: string | null;
  sat: unknown;
}): Promise<SaveTastingResult> {
  const ctx = await loadTarget(input.target);
  if (!ctx) return { ok: false, error: "Kein Zugriff oder Flasche bzw. Eintrag nicht gefunden." };
  if (input.tastingId && !UUID_RE.test(input.tastingId)) return { ok: false, error: "Ungültige Verkostung." };
  if (input.personId && !UUID_RE.test(input.personId)) return { ok: false, error: "Ungültige Person." };

  const row = tastingRow({
    item: ctx.item,
    encounterId: ctx.encounterId,
    personId: input.personId,
    sat: input.sat,
    today: todayIso(),
    source: "app",
  });

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
