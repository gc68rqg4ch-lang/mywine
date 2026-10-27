// Gemeinsame Zeile für wine_tastings – App (Formular) und Telegram-Bot speichern gleich.

import type { Json, TablesInsert } from "@/lib/database.types";
import {
  QUALITY_OPTIONS,
  READINESS_OPTIONS,
  WINE_STYLE,
  currentScore,
  normalizeData,
  withCurrentTypeState,
} from "./sat";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stil, Qualität, Punkte und Trinkreife in die eigenen Spalten, das komplette Formular
 * (Struktur wie im Verkostungs-Tool) als JSON in sat.
 */
export function tastingRow(input: {
  item: { id: string; wine_id: string; vintage_year: number | null };
  personId: string | null;
  sat: unknown;
  today: string;
  source: "app" | "bot";
}) {
  const sat = withCurrentTypeState(normalizeData(input.sat, input.today));
  const fields = sat.fields;
  const quality =
    typeof fields.qualitaet === "string" && QUALITY_OPTIONS.includes(fields.qualitaet) ? fields.qualitaet : null;
  const readiness =
    typeof fields.trinkreife === "string" && READINESS_OPTIONS.includes(fields.trinkreife) ? fields.trinkreife : null;
  return {
    wine_id: input.item.wine_id,
    vintage_year: input.item.vintage_year,
    inventory_item_id: input.item.id,
    person_id: input.personId,
    tasted_at: sat.meta.date && DATE_RE.test(sat.meta.date) ? sat.meta.date : input.today,
    wine_style: WINE_STYLE[sat.type],
    quality_level: quality,
    quality_points: currentScore(sat),
    readiness,
    sat: sat as unknown as Json,
    notes: sat.notes.trim() || null,
    source: input.source,
  } satisfies TablesInsert<"wine_tastings">;
}
