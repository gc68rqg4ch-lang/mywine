// WSET-Bewertung (wine_tastings) speichern – hängt am Wein und Jahrgang, nicht an einer Flasche.
// Woran sie startet (target):
// - item: eine Flasche im Bestand (wie bisher) → inventory_item_id gesetzt
// - encounter: ein Eintrag „Verkostet“ (auch über den Link von Antoine) → encounter_id, Ort,
//   Jahrgang aus dem Eintrag, inventory_item_id leer
// - wine: nur Wein + Jahrgang (z. B. von der Weinseite ohne Bestand) → beide leer
// Beim Bearbeiten bleibt die Zuordnung (Flasche, Eintrag, Ort, Herkunft) unverändert – eine
// später eingebuchte Flasche hängt nichts um. Rein bis auf den übergebenen Client.

import type { Database } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tastingRow } from "./store";

type Db = SupabaseClient<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Woran eine WSET-Bewertung startet: Flasche, Eintrag „Verkostet“ oder nur Wein + Jahrgang. */
export type TastingTarget =
  | { kind: "item" | "encounter"; id: string }
  | { kind: "wine"; id: string; year: number | null };

export type TastingContext = {
  item: { id: string | null; wine_id: string; vintage_year: number | null };
  encounterId: string | null;
  placeId: string | null;
};

/** Ziel laden und prüfen (Flasche, Eintrag bzw. Wein muss es geben). */
export async function loadTastingTarget(db: Db, target: TastingTarget): Promise<TastingContext | null> {
  if (!target || !UUID_RE.test(target.id)) return null;
  if (target.kind === "item") {
    const { data } = await db.from("inventory_items").select("id, wine_id, vintage_year").eq("id", target.id).maybeSingle();
    return data ? { item: data, encounterId: null, placeId: null } : null;
  }
  if (target.kind === "encounter") {
    const { data } = await db
      .from("wine_encounters")
      .select("id, wine_id, vintage_year, place_id")
      .eq("id", target.id)
      .maybeSingle();
    return data
      ? { item: { id: null, wine_id: data.wine_id, vintage_year: data.vintage_year }, encounterId: data.id, placeId: data.place_id ?? null }
      : null;
  }
  if (target.kind === "wine") {
    const year = target.year;
    if (year != null && !(Number.isInteger(year) && year >= 1800 && year <= 2100)) return null;
    const { data } = await db.from("wines").select("id").eq("id", target.id).maybeSingle();
    return data ? { item: { id: null, wine_id: data.id, vintage_year: year }, encounterId: null, placeId: null } : null;
  }
  return null;
}

export type SaveTastingResult = { ok: true; id: string; wineId: string } | { ok: false; error: string };

/**
 * Speichert eine WSET-Bewertung. Pflicht: Wein (über das Ziel) und Person; Flasche,
 * Eintrag und Ort optional. Neu: Zuordnung aus dem Ziel. Bearbeiten: nur die Bewertung selbst
 * (Formular, Datum, Person) – Flasche, Eintrag, Ort und Herkunft bleiben.
 */
export async function storeTasting(
  db: Db,
  input: { target: TastingTarget; tastingId: string | null; personId: string | null; sat: unknown; today: string },
): Promise<SaveTastingResult> {
  if (input.tastingId && !UUID_RE.test(input.tastingId)) return { ok: false, error: "Ungültige Verkostung." };
  if (!input.personId || !UUID_RE.test(input.personId)) return { ok: false, error: "Bitte eine Person wählen." };
  const ctx = await loadTastingTarget(db, input.target);
  if (!ctx) return { ok: false, error: "Kein Zugriff oder Wein, Flasche bzw. Eintrag nicht gefunden." };

  const row = tastingRow({
    item: ctx.item,
    encounterId: ctx.encounterId,
    placeId: ctx.placeId,
    personId: input.personId,
    sat: input.sat,
    today: input.today,
    source: "app",
  });

  if (input.tastingId) {
    const changes = tastingChanges(row);
    const { data, error } = await db
      .from("wine_tastings")
      .update(changes)
      .eq("id", input.tastingId)
      .eq("wine_id", ctx.item.wine_id)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      if (error) console.error("save tasting failed", error);
      return { ok: false, error: "Die Verkostung konnte nicht gespeichert werden." };
    }
    return { ok: true, id: data.id, wineId: ctx.item.wine_id };
  }
  const { data, error } = await db.from("wine_tastings").insert(row).select("id").single();
  if (error || !data) {
    console.error("save tasting failed", error);
    return { ok: false, error: "Die Verkostung konnte nicht gespeichert werden." };
  }
  return { ok: true, id: data.id, wineId: ctx.item.wine_id };
}

/** Felder beim Bearbeiten: ohne Zuordnung (Flasche, Eintrag, Ort, Wein, Jahrgang) und Herkunft. */
export function tastingChanges(row: ReturnType<typeof tastingRow>) {
  const changes: Partial<ReturnType<typeof tastingRow>> & { encounter_id?: string; place_id?: string } = { ...row };
  for (const key of ["wine_id", "vintage_year", "inventory_item_id", "encounter_id", "place_id", "source"] as const) delete changes[key];
  return changes;
}
