"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/database.types";
import { getSession } from "@/lib/auth";
import { todayIso } from "@/lib/format";
import {
  QUALITY_OPTIONS,
  READINESS_OPTIONS,
  WINE_STYLE,
  currentScore,
  normalizeData,
  withCurrentTypeState,
} from "@/lib/tasting/sat";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const today = todayIso();
  const sat = withCurrentTypeState(normalizeData(input.sat, today));
  const fields = sat.fields;
  const date = sat.meta.date && DATE_RE.test(sat.meta.date) ? sat.meta.date : today;
  const quality = typeof fields.qualitaet === "string" && QUALITY_OPTIONS.includes(fields.qualitaet)
    ? fields.qualitaet
    : null;
  const readiness = typeof fields.trinkreife === "string" && READINESS_OPTIONS.includes(fields.trinkreife)
    ? fields.trinkreife
    : null;
  const score = currentScore(sat);

  const row = {
    wine_id: ctx.item.wine_id,
    vintage_year: ctx.item.vintage_year,
    inventory_item_id: ctx.item.id,
    person_id: input.personId,
    tasted_at: date,
    wine_style: WINE_STYLE[sat.type],
    quality_level: quality,
    quality_points: score,
    readiness,
    sat: sat as unknown as Json,
    notes: sat.notes.trim() || null,
    source: "app",
  };

  const write = (values: typeof row) =>
    input.tastingId
      ? ctx.session.supabase.from("wine_tastings").update(values).eq("id", input.tastingId).select("id").single()
      : ctx.session.supabase.from("wine_tastings").insert(values).select("id").single();

  let { data, error } = await write(row);
  // quality_points ist (noch) smallint: halbe Summen wie 2.5 passen nicht. Dann ohne
  // Punkte speichern – der genaue Wert steht in sat.fields. Nach der Migration
  // wine_tastings_quality_points_half_steps entfällt dieser Fall von selbst.
  if (error?.code === "22P02" && score != null && !Number.isInteger(score)) {
    ({ data, error } = await write({ ...row, quality_points: null }));
  }
  if (error || !data) {
    console.error("save tasting failed", error);
    return { ok: false, error: "Die Verkostung konnte nicht gespeichert werden." };
  }

  revalidatePath(`/flasche/${ctx.item.id}`);
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
  revalidatePath(`/flasche/${ctx.item.id}`);
  return { ok: true as const };
}

/**
 * Subjektive Bewertung einer Person (0–5 in halben Schritten) für Wein + Jahrgang.
 * Pro Person und Tag gibt es eine Bewertung: am selben Tag wird sie überschrieben,
 * an einem neuen Tag kommt eine neue hinzu (Verlauf bleibt erhalten).
 * rating = null entfernt die heutige Bewertung.
 */
export async function setRating(itemId: string, personId: string, rating: number | null) {
  const ctx = await loadItem(itemId);
  if (!ctx || !UUID_RE.test(personId)) return { ok: false as const, error: "Kein Zugriff." };
  if (rating != null && !(rating >= 0 && rating <= 5 && Number.isInteger(rating * 2))) {
    return { ok: false as const, error: "Bewertung muss zwischen 0 und 5 in halben Schritten liegen." };
  }

  const { supabase } = ctx.session;
  const today = todayIso();
  let query = supabase
    .from("wine_ratings")
    .select("id")
    .eq("wine_id", ctx.item.wine_id)
    .eq("person_id", personId)
    .eq("rated_at", today);
  query = ctx.item.vintage_year == null
    ? query.is("vintage_year", null)
    : query.eq("vintage_year", ctx.item.vintage_year);
  const { data: existing, error: findError } = await query.order("created_at", { ascending: false });
  if (findError) return { ok: false as const, error: "Bewertung konnte nicht gelesen werden." };

  const todayId = existing?.[0]?.id;
  let error;
  if (rating == null) {
    if (!todayId) return { ok: true as const };
    ({ error } = await supabase.from("wine_ratings").delete().eq("id", todayId));
  } else if (todayId) {
    ({ error } = await supabase
      .from("wine_ratings")
      .update({ rating, inventory_item_id: ctx.item.id })
      .eq("id", todayId));
  } else {
    ({ error } = await supabase.from("wine_ratings").insert({
      wine_id: ctx.item.wine_id,
      vintage_year: ctx.item.vintage_year,
      person_id: personId,
      rating,
      rated_at: today,
      inventory_item_id: ctx.item.id,
      source: "manual",
    }));
  }
  if (error) {
    console.error("set rating failed", error);
    return { ok: false as const, error: "Bewertung konnte nicht gespeichert werden." };
  }
  revalidatePath(`/flasche/${ctx.item.id}`);
  return { ok: true as const };
}
