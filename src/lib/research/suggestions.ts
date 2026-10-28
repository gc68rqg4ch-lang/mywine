import "server-only";

// Vorschläge aus der Recherche (research_suggestions): anlegen bzw. aktualisieren, laden,
// entscheiden. Höchstens ein offener Vorschlag pro Wein/Jahrgang/Feld (Ausdrucks-Index →
// kein Upsert: erst lesen). Übernehmen läuft über das gemeinsame Bearbeiten-Modul.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { applyEdit, NOTHING } from "@/lib/edit/edit";
import type { Edit, WineChanges } from "@/lib/edit/types";
import type { GrapeShare } from "@/lib/grapes/shares";
import type { TasteProfileData } from "@/lib/taste/profile";
import { SUGGESTION_LABELS, displayValue, sameValue, type SuggestionField } from "./compare";

type Db = SupabaseClient<Database>;

export type Suggestion = {
  id: string;
  wineId: string;
  vintageYear: number | null;
  field: SuggestionField;
  label: string;
  current: string;
  suggested: string;
  sourceNote: string | null;
  wine: { name: string; producer: string | null } | null;
};

const byYear = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(
  q: Q,
  year: number | null,
) => (year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year));

/**
 * Abweichung festhalten. Gibt es schon einen offenen Vorschlag fürs gleiche Feld, wird er
 * aktualisiert; wurde derselbe Wert früher abgelehnt, kommt er nicht wieder.
 */
export async function recordSuggestion(
  db: Db,
  s: { wineId: string; year: number | null; field: SuggestionField; current: unknown; suggested: unknown; note: string | null },
): Promise<"created" | "updated" | "skipped"> {
  const { data: rows, error } = await byYear(
    db.from("research_suggestions").select("id, status, suggested_value").eq("wine_id", s.wineId).eq("field", s.field),
    s.year,
  );
  if (error) throw error;
  if ((rows ?? []).some((r) => r.status === "rejected" && sameValue(s.field, r.suggested_value, s.suggested))) return "skipped";
  const values = {
    current_value: (s.current ?? null) as Json,
    suggested_value: s.suggested as Json,
    source_note: s.note,
  };
  const pending = (rows ?? []).find((r) => r.status === "pending");
  if (pending) {
    if (sameValue(s.field, pending.suggested_value, s.suggested)) return "skipped";
    const { error: updateError } = await db.from("research_suggestions").update(values).eq("id", pending.id).eq("status", "pending");
    if (updateError) throw updateError;
    return "updated";
  }
  const { error: insertError } = await db
    .from("research_suggestions")
    .insert({ wine_id: s.wineId, vintage_year: s.year, field: s.field, status: "pending", ...values });
  if (insertError?.code === "23505") {
    // Gleichzeitig angelegt: den offenen Vorschlag aktualisieren.
    const again = await byYear(
      db.from("research_suggestions").update(values).eq("wine_id", s.wineId).eq("field", s.field).eq("status", "pending"),
      s.year,
    );
    if (again.error) throw again.error;
    return "updated";
  }
  if (insertError) throw insertError;
  return "created";
}

const COLUMNS = "id, wine_id, vintage_year, field, current_value, suggested_value, source_note, created_at, wine:wines(name, producer)" as const;

/** Offene Vorschläge, optional für einen Wein (und dessen Jahrgang plus „für den Wein“). */
export async function loadPendingSuggestions(db: Db, filter: { wineId?: string; year?: number | null } = {}): Promise<Suggestion[]> {
  let q = db.from("research_suggestions").select(COLUMNS).eq("status", "pending");
  if (filter.wineId) q = q.eq("wine_id", filter.wineId);
  if (filter.wineId && filter.year !== undefined) {
    q = filter.year == null ? q.is("vintage_year", null) : q.or(`vintage_year.eq.${filter.year},vintage_year.is.null`);
  }
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const field = r.field as SuggestionField;
    return {
      id: r.id,
      wineId: r.wine_id,
      vintageYear: r.vintage_year,
      field,
      label: `${SUGGESTION_LABELS[field]}${r.vintage_year != null && field !== "producer" ? ` ${r.vintage_year}` : ""}`,
      current: displayValue(field, r.current_value),
      suggested: displayValue(field, r.suggested_value),
      sourceNote: r.source_note,
      wine: r.wine,
    };
  });
}

export async function countPendingSuggestions(db: Db, wineId: string) {
  const { count, error } = await db
    .from("research_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("wine_id", wineId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

const WINE_FIELD: Partial<Record<SuggestionField, keyof WineChanges>> = {
  producer: "producer",
  country: "country",
  region: "region",
  appellation: "appellation",
  type: "type",
  alcohol_content: "alcohol",
};

/** Bearbeitung, die einen Vorschlag übernimmt (über das gemeinsame Modul). */
async function editFor(db: Db, row: { wine_id: string; vintage_year: number | null; field: string; suggested_value: Json }): Promise<Edit> {
  const field = row.field as SuggestionField;
  const wineField = WINE_FIELD[field];
  if (wineField) return { kind: "wine", wineId: row.wine_id, set: { [wineField]: row.suggested_value } as WineChanges };
  if (field === "taste_profile") {
    // Übernommen: das recherchierte Profil gilt wieder als Recherche (mit Quellen und Belegen).
    return { kind: "tasteProfile", wineId: row.wine_id, profile: row.suggested_value as unknown as TasteProfileData, source: "research" };
  }
  if (field === "grapes") {
    return { kind: "grapes", wineId: row.wine_id, year: row.vintage_year, shares: row.suggested_value as GrapeShare[], source: "research" };
  }
  const { data: window } = await byYear(
    db.from("wine_vintages").select("drink_from_year, drink_until_year").eq("wine_id", row.wine_id),
    row.vintage_year,
  ).maybeSingle();
  const value = row.suggested_value as number;
  return {
    kind: "drinkWindow",
    wineId: row.wine_id,
    year: row.vintage_year,
    from: field === "drink_from_year" ? value : (window?.drink_from_year ?? null),
    until: field === "drink_until_year" ? value : (window?.drink_until_year ?? null),
    // Übernommener Vorschlag: der Wert stammt aus einer Quelle.
    source: "research",
  };
}

/**
 * Vorschlag übernehmen (Wert über das Bearbeiten-Modul schreiben) oder behalten (ablehnen);
 * setzt status, decided_at und decided_by.
 */
export async function decideSuggestion(db: Db, id: string, accept: boolean, personId: string | null) {
  const { data: row, error } = await db
    .from("research_suggestions")
    .select("id, wine_id, vintage_year, field, suggested_value, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.status !== "pending") return { ok: false as const, error: "Diesen Vorschlag gibt es nicht mehr." };

  let message = "Behalten – deine Angabe bleibt.";
  if (accept) {
    const result = await applyEdit(db, await editFor(db, row));
    if (!result.ok && result.error !== NOTHING) return { ok: false as const, error: result.error };
    message = result.ok ? result.message : "Übernommen – der Wert war schon so.";
  }
  const { data: decided, error: decideError } = await db
    .from("research_suggestions")
    .update({ status: accept ? "accepted" : "rejected", decided_at: new Date().toISOString(), decided_by: personId })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (decideError) throw decideError;
  if (!decided?.length) return { ok: false as const, error: "Dieser Vorschlag wurde schon entschieden." };
  return { ok: true as const, message, wineId: row.wine_id };
}
