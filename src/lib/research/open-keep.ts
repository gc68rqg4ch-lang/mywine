import "server-only";

// Haltbarkeit offen für Likörweine und Liköre (Spirituosen der Kategorie Likör): erst eine Quelle
// suchen (Produzent, Händler, Fachseite zu genau diesem Wein bzw. Stil), sonst nach Stil schätzen
// (Tabelle in fortified/keep.ts; Likör: Stil aus der Unterkategorie). Gespeichert wird nach der
// Rangfolge (manual nie, research ersetzt estimate); nie bei einem Fehler (auch nicht beim
// API-Limit). Ein Aufruf mit Websuche, strict-Tool ohne nullable-Felder und ohne min/max
// (0 bzw. leer = nichts).

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { webResearch } from "@/lib/ingest/recognize";
import { apiProblem } from "@/lib/ai/api-errors";
import {
  KEEP_STYLE_KEYS,
  KEEP_STYLES,
  WINE_KEEP_STYLES,
  asKeepSource,
  decideKeep,
  estimateKeep,
  guessKeepStyle,
  keepText,
  type FoundKeep,
  type KeepStyle,
} from "@/lib/fortified/keep";
import { keepNotAllowed, loadKeepWines } from "@/lib/fortified/store";
import { sourceNote } from "./compare";

type Db = SupabaseClient<Database>;

export const OpenKeepSchema = z.object({
  matches_wine: z.boolean().describe("true nur, wenn die Quellen genau diesen Wein bzw. Likör (Name + Produzent) oder genau seinen Stil betreffen"),
  style: z.enum(KEEP_STYLE_KEYS as [KeepStyle, ...KeepStyle[]]).describe("Stil; unknown, wenn unklar"),
  keep_days: z.number().describe("Haltbarkeit nach dem Öffnen (verschlossen) in Tagen laut Quelle; 0 = nicht genannt"),
  sources: z.array(z.object({ url: z.string().describe("Adresse der Quelle (https://…)"), title: z.string() })).describe("Nur Quellen mit Angabe zur Haltbarkeit nach dem Öffnen; sonst leer"),
  quote: z.string().describe("Wörtliches Zitat (≤ 25 Wörter) zur Haltbarkeit nach dem Öffnen; leer ohne Quelle"),
});
export type OpenKeepRaw = z.infer<typeof OpenKeepSchema>;

export type KeepResearchWine = { name: string; producer: string | null; country: string | null; region: string | null; appellation: string | null; alcohol_content?: number | null };

/**
 * Antwort prüfen (rein): Quelle nur mit passendem Wein/Stil, https-URL, Zitat und plausiblen Tagen
 * (1–3650); sonst Schätzung nach Stil. Likör (liqueurStyle): Stil aus der Unterkategorie; Likörwein:
 * der gemeldete Stil, sonst aus dem Namen erraten.
 */
export function evaluateOpenKeep(raw: OpenKeepRaw | null, wine: KeepResearchWine, liqueurStyle: KeepStyle | null = null): FoundKeep {
  const reported = raw && raw.style !== "unknown" && (WINE_KEEP_STYLES as string[]).includes(raw.style) ? raw.style : null;
  const style: KeepStyle = liqueurStyle ?? reported ?? guessKeepStyle(wine);
  if (raw) {
    const sources = raw.sources.map((s) => s.url).filter((u) => /^https:\/\//.test(u));
    const days = Math.round(raw.keep_days);
    if (raw.matches_wine && sources.length && raw.quote.trim() && days >= 1 && days <= 3650) {
      return { days, source: "research", note: `${sourceNote(sources)} (${KEEP_STYLES[style].label})`.slice(0, 200) };
    }
  }
  return estimateKeep(style);
}

/** Websuche (Fehler – auch API-Limit – werden weitergegeben). liqueurStyle: Likör mit diesem Stil. */
export async function researchOpenKeep(wine: KeepResearchWine, liqueurStyle: KeepStyle | null = null): Promise<FoundKeep> {
  const what = liqueurStyle ? `dieser Likör (${KEEP_STYLES[liqueurStyle].label})` : "dieser Likörwein";
  const raw = await webResearch({
    prompt: `Gesucht ist, wie lange ${what} nach dem Öffnen gut bleibt (wieder verschlossen${liqueurStyle === "liqueur_cream" || !liqueurStyle ? ", im Kühlschrank" : ""}): ${JSON.stringify({
      name: wine.name,
      produzent: wine.producer,
      land: wine.country,
      region: wine.region,
      appellation: wine.appellation,
      alkohol: wine.alcohol_content ?? null,
    })}
- ${liqueurStyle ? `Stil (style): ${liqueurStyle}.` : `Bestimme den Stil (style): ${WINE_KEEP_STYLES.map((k) => `${k} = ${KEEP_STYLES[k].label}`).join("; ")}.`}
- Suche Angaben von Produzent, Händler oder Fachseiten zur Haltbarkeit nach dem Öffnen – zu genau ${liqueurStyle ? "diesem Likör" : "diesem Wein"} oder genau seinem Stil. Gefunden: keep_days (Tage; „4–6 Wochen“ → 35, „12 Monate“ → 365), sources, ein wörtliches Zitat.
- Keine passende Quelle: keep_days 0, sources leer, quote leer – nur den Stil angeben.`,
    toolName: "report_open_keep",
    toolDescription: "Meldet den Stil und die Haltbarkeit nach dem Öffnen mit Quelle.",
    schema: OpenKeepSchema,
    maxSearches: 3,
  });
  return evaluateOpenKeep(raw, wine, liqueurStyle);
}

export type OpenKeepResult = "exists" | "set" | "unchanged" | "none";

/**
 * Haltbarkeit suchen und nach der Rangfolge speichern. onlyIfEmpty (Standard): nur suchen, wenn
 * noch keine gesetzt ist; sonst auch eine Schätzung durch eine Quelle ersetzen (manual nie).
 * Wirft bei API-Fehlern – dann ist nichts gesetzt.
 */
export async function findAndStoreOpenKeep(db: Db, wineId: string, options: { onlyIfEmpty?: boolean } = {}): Promise<{ result: OpenKeepResult; keep?: FoundKeep }> {
  const [wine] = await loadKeepWines(db, [wineId]);
  // Weder Likörwein noch Likör (bzw. Spalten fehlen): nichts.
  if (!wine) return { result: "none" };
  const existing = { days: wine.open_keep_days, source: asKeepSource(wine.open_keep_source) };
  if (existing.days != null && ((options.onlyIfEmpty ?? true) || (existing.source ?? "manual") !== "estimate")) return { result: "exists" };

  const found = await researchOpenKeep(wine, wine.liqueur ? wine.style : null);
  if (decideKeep(existing.days == null ? null : existing, found) !== "set") return { result: "unchanged", keep: found };
  let q = db.from("wines").update({ open_keep_days: found.days, open_keep_source: found.source, open_keep_note: found.note }).eq("id", wineId);
  // Gleichzeitig von Hand gesetzt? Dann nichts überschreiben.
  q = existing.days == null ? q.is("open_keep_days", null) : q.eq("open_keep_source", "estimate");
  const { data: updated, error: updateError } = await q.select("id");
  // Likör vor der Migration (Haltbarkeit bei Spirituosen noch nicht erlaubt): nichts gesetzt.
  if (keepNotAllowed(updateError)) return { result: "none" };
  if (updateError) throw updateError;
  return updated?.length ? { result: "set", keep: found } : { result: "unchanged", keep: found };
}

/** Kurz für Meldungen: „Haltbarkeit offen: ≈ 4 Wochen“. */
export const openKeepFilled = (k: FoundKeep) => `Haltbarkeit offen (${keepText(k.days, k.source)?.replace(/^offen /, "")})`;

/** Sammellauf „Haltbarkeit offen fehlt“ für einen Wein (Ergebnis wie die anderen Läufe). */
export async function researchOpenKeepJob(db: Db, wineId: string) {
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  try {
    const { result, keep } = await findAndStoreOpenKeep(db, wineId, { onlyIfEmpty: false });
    const filled = result === "set" && keep ? [openKeepFilled(keep)] : [];
    return { status: filled.length ? ("filled" as const) : ("nothing" as const), filled, suggested: 0, seconds: seconds() };
  } catch (error) {
    const problem = apiProblem(error);
    if (problem?.kind === "usage_limit") console.error("api limit reached", wineId, problem.message);
    else console.error("open keep research failed", wineId, error);
    return { status: "error" as const, filled: [] as string[], suggested: 0, seconds: seconds(), error: problem ?? { kind: "other" as const, message: "Die Suche ist fehlgeschlagen." } };
  }
}
