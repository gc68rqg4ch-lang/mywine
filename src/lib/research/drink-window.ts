import "server-only";

// Trinkfenster eines Jahrgangs: erst eine Quelle suchen (Produzent, Kritik, Händler – nur zu genau
// diesem Wein und Jahrgang; Wein ohne Jahrgang: Quellen zum Wein), sonst eine Schätzung anhand von
// Typ, Herkunft, Rebsorten, Qualitätsstufe und Jahrgang. Ein Aufruf mit Websuche, strict-Tool ohne
// nullable-Felder und ohne min/max (0 bzw. leer = nichts). Gespeichert wird nach der Rangfolge in
// cellar/drink-window.ts; nie bei einem Fehler (auch nicht beim API-Limit).

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { webResearch } from "@/lib/ingest/recognize";
import { loadGrapeShares } from "@/lib/grapes/store";
import { formatShares } from "@/lib/grapes/shares";
import { asDrinkSource, decideDrinkWindow, drinkWindowText, saveVintageWindow, type FoundWindow } from "@/lib/cellar/drink-window";
import { recordSuggestion } from "./suggestions";
import { sourceNote } from "./compare";

type Db = SupabaseClient<Database>;

export const DrinkWindowSchema = z.object({
  matches_wine: z.boolean().describe("true nur, wenn die Quellen genau diesen Wein (Name + Produzent) betreffen"),
  same_vintage: z.boolean().describe("true, wenn das Trinkfenster der Quellen für genau den angefragten Jahrgang gilt (Wein ohne Jahrgang: true)"),
  drink_from: z.number().describe("Trinkreif ab (Jahr) laut Quelle; 0 = nicht genannt"),
  drink_until: z.number().describe("Trinkreif bis (Jahr) laut Quelle; 0 = nicht genannt"),
  sources: z
    .array(
      z.object({
        url: z.string().describe("Adresse der Quelle (https://…)"),
        title: z.string().describe("Titel der Seite"),
        kind: z.enum(["producer", "critic", "merchant", "other"]).describe("Weingut, Kritik, Händler oder andere"),
        vintage: z.number().describe("Jahrgang, um den es in der Quelle geht; 0 = ohne Jahrgang"),
      }),
    )
    .describe("Nur Quellen, die das Trinkfenster genau dieses Weins nennen; sonst leer"),
  quote: z.string().describe("Wörtliches Zitat (≤ 25 Wörter) mit dem Trinkfenster; leer ohne Quelle"),
  estimate_from: z.number().describe("Nur ohne Quelle: geschätzt trinkreif ab (Jahr); 0 = keine Schätzung"),
  estimate_until: z.number().describe("Nur ohne Quelle: geschätzt trinkreif bis (Jahr); 0 = keine Schätzung"),
  estimate_reason: z.string().describe("Nur ohne Quelle: ein kurzer Satz auf Deutsch, worauf die Schätzung beruht"),
});
export type DrinkWindowRaw = z.infer<typeof DrinkWindowSchema>;

export type DrinkWine = {
  name: string;
  producer: string | null;
  type: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  alcohol_content: number | null;
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/**
 * Antwort prüfen (rein): Quelle nur mit passendem Wein, Jahrgang, https-URL und Zitat; Jahre
 * plausibel (ab dem Jahrgang, höchstens 80 Jahre später, ab ≤ bis). Sonst die Schätzung mit
 * Begründung; sonst nichts.
 */
export function evaluateDrinkWindow(raw: DrinkWindowRaw, year: number | null, now = new Date().getFullYear()): FoundWindow | null {
  const min = year ?? 1900;
  const max = (year ?? now) + 80;
  const ok = (v: number) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
  const pair = (a: number, b: number) => {
    const from = ok(a);
    const until = ok(b);
    if (from == null && until == null) return null;
    if (from != null && until != null && from > until) return null;
    return { from, until };
  };
  const sources = raw.sources.filter((s) => /^https?:\/\//.test(s.url) && host(s.url) && (year == null || s.vintage === year));
  const found = pair(raw.drink_from, raw.drink_until);
  if (raw.matches_wine && (year == null || raw.same_vintage) && sources.length && raw.quote.trim() && found) {
    return { ...found, source: "research", note: sourceNote(sources.map((s) => s.url)) };
  }
  const estimate = pair(raw.estimate_from, raw.estimate_until);
  const reason = raw.estimate_reason.trim().replace(/\s+/g, " ");
  if (estimate && reason) return { ...estimate, source: "estimate", note: reason.slice(0, 200) };
  return null;
}

/** Websuche (bzw. Schätzung) für einen Jahrgang. Fehler (auch API-Limit) werden weitergegeben. */
export async function researchDrinkWindow(wine: DrinkWine, year: number | null, grapes: string | null): Promise<FoundWindow | null> {
  if (!wine.name) return null;
  const now = new Date().getFullYear();
  const raw = await webResearch({
    prompt: `Gesucht ist das Trinkfenster (trinkreif ab/bis) dieses Weins: ${JSON.stringify({
      name: wine.name,
      produzent: wine.producer,
      jahrgang: year ?? "ohne Jahrgang",
      typ: wine.type,
      land: wine.country,
      region: wine.region,
      appellation: wine.appellation,
      rebsorten: grapes,
      alkohol: wine.alcohol_content,
    })}
- Suche Angaben von Weingut, Kritikern oder Händlern zu ${year != null ? `genau Jahrgang ${year}` : "genau diesem Wein (ohne Jahrgang)"}. ${year != null ? "Angaben zu anderen Jahrgängen zählen nicht." : ""} Gefunden: drink_from/drink_until, sources, ein wörtliches Zitat; die Schätzungsfelder 0 bzw. leer.
- Keine passende Quelle: drink_from/drink_until 0, sources leer, quote leer – und schätze das Trinkfenster als Weinkenner anhand von Weintyp, Land/Region/Appellation, Rebsorten, Qualitätsstufe (z. B. Reserva, Gran Reserva, Grand Cru, Riserva) und Jahrgang (heute ist ${now}): estimate_from/estimate_until und estimate_reason (ein kurzer Satz auf Deutsch).
- Jahre als vierstellige Zahl.`,
    toolName: "report_drink_window",
    toolDescription: "Meldet das Trinkfenster des Weins mit Quelle bzw. eine begründete Schätzung.",
    schema: DrinkWindowSchema,
    maxSearches: 4,
  });
  return raw ? evaluateDrinkWindow(raw, year, now) : null;
}

export type DrinkWindowResult = "exists" | "set" | "suggested" | "unchanged" | "none";

/**
 * Trinkfenster suchen und nach der Rangfolge speichern. onlyIfEmpty (Standard): nur suchen, wenn
 * „ab“ und „bis“ leer sind. Wirft bei API-Fehlern – dann ist nichts gesetzt.
 */
export async function findAndStoreDrinkWindow(
  db: Db,
  wineId: string,
  year: number | null,
  options: { onlyIfEmpty?: boolean } = {},
): Promise<{ result: DrinkWindowResult; window?: FoundWindow }> {
  let q = db.from("wine_vintages").select("*").eq("wine_id", wineId);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const [{ data: row, error }, { data: wine, error: wineError }, grapes] = await Promise.all([
    q.maybeSingle(),
    db.from("wines").select("name, producer, type, country, region, appellation, alcohol_content, grapes").eq("id", wineId).maybeSingle(),
    loadGrapeShares(db, wineId, year).catch(() => null),
  ]);
  if (error) throw error;
  if (wineError) throw wineError;
  if (!wine) return { result: "none" };
  const existing = row ? { from: row.drink_from_year, until: row.drink_until_year, source: asDrinkSource(row.drink_window_source) } : null;
  if ((options.onlyIfEmpty ?? true) && (existing?.from != null || existing?.until != null)) return { result: "exists" };

  const grapeText = grapes?.shares.length ? formatShares(grapes.shares) : wine.grapes.join(", ") || null;
  const found = await researchDrinkWindow(wine, year, grapeText);
  if (!found) return { result: "none" };

  const decision = decideDrinkWindow(existing, found);
  if (decision === "set") {
    await saveVintageWindow(db, { rowId: row?.id ?? null, wineId, year }, { drink_from_year: found.from, drink_until_year: found.until }, found.source, found.note);
    return { result: "set", window: found };
  }
  if (decision === "suggest" && existing) {
    let suggested = 0;
    const note = found.note ?? null;
    if (found.from != null && found.from !== existing.from) {
      if ((await recordSuggestion(db, { wineId, year, field: "drink_from_year", current: existing.from, suggested: found.from, note })) !== "skipped") suggested++;
    }
    if (found.until != null && found.until !== existing.until) {
      if ((await recordSuggestion(db, { wineId, year, field: "drink_until_year", current: existing.until, suggested: found.until, note })) !== "skipped") suggested++;
    }
    return { result: suggested ? "suggested" : "unchanged", window: found };
  }
  return { result: "unchanged", window: found };
}

/** Kurz für Listen und Meldungen: „Trinkfenster 2019: ≈ 2024–2030“. */
export const drinkWindowFilled = (year: number | null, w: FoundWindow) =>
  `Trinkfenster ${year ?? "NV"}: ${drinkWindowText(w.from, w.until, w.source)}`;
