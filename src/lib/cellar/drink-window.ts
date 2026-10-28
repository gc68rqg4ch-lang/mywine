// Trinkfenster je Jahrgang mit Herkunft (wine_vintages.drink_window_source / _note):
// label = Ablaufdatum vom Etikett, research = Quelle (Produzent, Kritik, Händler),
// estimate = Schätzung ohne Quelle, manual = von Hand bzw. alte App.
// Rangfolge: manual und label nie automatisch überschreiben; research ersetzt estimate;
// estimate ersetzt nichts; weicht research von manual ab → Vorschlag statt Überschreiben.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { ensureVintage } from "./vintage-row";

type Db = SupabaseClient<Database>;

export const DRINK_SOURCES = ["label", "research", "estimate", "manual"] as const;
export type DrinkSource = (typeof DRINK_SOURCES)[number];

export const asDrinkSource = (v: unknown): DrinkSource | null =>
  (DRINK_SOURCES as readonly unknown[]).includes(v) ? (v as DrinkSource) : null;

export type StoredWindow = { from: number | null; until: number | null; source: DrinkSource | null };
export type FoundWindow = { from: number | null; until: number | null; source: "research" | "estimate"; note: string | null };

/** Was mit einem gefundenen Trinkfenster passiert: setzen, lassen oder als Vorschlag ablegen. */
export function decideDrinkWindow(existing: StoredWindow | null, found: FoundWindow): "set" | "keep" | "suggest" {
  if (found.from == null && found.until == null) return "keep";
  if (!existing || (existing.from == null && existing.until == null)) return "set";
  // Werte ohne Herkunft (vor der Migration bzw. alte App) gelten als von Hand.
  const source = existing.source ?? "manual";
  const differs = existing.from !== found.from || existing.until !== found.until;
  if (source === "estimate") return found.source === "research" && differs ? "set" : "keep";
  if (source === "manual") return found.source === "research" && differs ? "suggest" : "keep";
  return "keep"; // label, research
}

/** „2024–2030“, „ab 2024“, „bis 2030“; Schätzung mit „≈“. */
export function drinkWindowText(from: number | null, until: number | null, source?: DrinkSource | string | null) {
  const range = from && until ? `${from}–${until}` : from ? `ab ${from}` : until ? `bis ${until}` : null;
  if (!range) return null;
  return source === "estimate" ? `≈ ${range}` : range;
}

/** „bald trinken“ (bis im laufenden Jahr), „über dem Höhepunkt“ (bis davor), sonst null. */
export function drinkWindowHint(until: number | null, year = new Date().getFullYear()) {
  if (until == null) return null;
  if (until < year) return "über dem Höhepunkt";
  if (until === year) return "bald trinken";
  return null;
}

/** Herkunft kurz für die App: „geschätzt“, „laut Etikett“, „recherchiert“. */
export const DRINK_SOURCE_LABELS: Record<DrinkSource, string> = {
  estimate: "geschätzt",
  label: "laut Etikett",
  research: "recherchiert",
  manual: "von Hand",
};

const missingColumn = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === "PGRST204" || /drink_window_(source|note)/.test(error.message ?? ""));

/**
 * Trinkfenster eines Jahrgangs speichern, mit Herkunft und Notiz. Fehlen die Spalten noch (Migration
 * nicht eingespielt), wird ohne Herkunft gespeichert – das Trinkfenster geht nicht verloren.
 */
export async function saveVintageWindow(
  db: Db,
  target: { rowId: string | null; wineId: string; year: number | null },
  values: Database["public"]["Tables"]["wine_vintages"]["Update"],
  source: DrinkSource | null,
  note: string | null = null,
) {
  const meta = { drink_window_source: source, drink_window_note: note?.trim() ? note.trim().slice(0, 300) : null };
  // Jahrgang sicher holen/anlegen (parallel zur Profilsuche), dann nur die eigenen Felder setzen.
  const rowId = target.rowId ?? (await ensureVintage(db, target.wineId, target.year));
  const write = (v: typeof values) => db.from("wine_vintages").update(v).eq("id", rowId);
  let { error } = await write({ ...values, ...meta });
  if (missingColumn(error)) ({ error } = await write(values));
  if (error) throw error;
}
