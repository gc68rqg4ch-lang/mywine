import "server-only";

// Gemeinsame Bausteine des Bearbeiten-Moduls: Prüfungen, Vorschau „vorher → nachher“ und
// das Ergebnis einer vorbereiteten Bearbeitung. Genutzt von edit.ts und encounters.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatDate, todayIso } from "@/lib/format";
import type { EditChange, EditPreview } from "./types";

export type Db = SupabaseClient<Database>;

export type PreparedEdit =
  | { ok: false; error: string }
  | {
      ok: true;
      preview: EditPreview;
      wineId: string | null;
      year?: number | null;
      /** Führt aus und liefert, was getan wurde („2 Flaschen ins Wohnzimmer verschoben“). */
      run: () => Promise<string>;
    };

export const NOTHING = "Nichts zu ändern – die Angaben sind schon so.";
export const DASH = "–";
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const fail = (error: string): PreparedEdit => ({ ok: false, error });
export const show = (v: string | number | null | undefined) => (v == null || v === "" ? DASH : String(v));
export const date = (v: string | null | undefined) => formatDate(v) ?? DASH;
/** Leerer Text → null, sonst getrimmt. */
export const clean = (v: string | null | undefined) => {
  const t = v?.trim().replace(/\s+/g, " ");
  return t ? t : null;
};
/** Für ilike: exakte Suche ohne Platzhalter. */
export const exact = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function validYear(year: number | null, label = "Jahrgang") {
  if (year == null) return null;
  const max = Number(todayIso().slice(0, 4)) + 1;
  return Number.isInteger(year) && year >= 1800 && year <= max ? null : `${label}: bitte eine Jahreszahl zwischen 1800 und ${max}.`;
}

export function validDate(value: string, label: string) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return `${label}: ungültiges Datum.`;
  if (value > todayIso()) return `${label}: darf nicht in der Zukunft liegen.`;
  return null;
}

export const validPrice = (v: number | null, label: string) =>
  v == null || (Number.isFinite(v) && v >= 0 && v < 100_000) ? null : `${label}: ungültiger Preis.`;

export async function loadWine(db: Db, wineId: string) {
  const { data, error } = await db.from("wines").select("*").eq("id", wineId).maybeSingle();
  if (error) throw error;
  return data;
}

export const wineTitle = (w: { producer: string; name: string }, year?: number | null) =>
  `${w.producer} – ${w.name}${year === undefined ? "" : ` ${year ?? "NV"}`}`;

export function diff(changes: EditChange[], label: string, before: string, after: string) {
  if (before !== after) changes.push({ label, before, after });
}

export function ready(
  preview: EditPreview,
  wineId: string | null,
  run: () => Promise<string>,
  year?: number | null,
): PreparedEdit {
  if (!preview.changes.length && !preview.notes.length) return fail(NOTHING);
  return { ok: true, preview, wineId, year, run };
}

