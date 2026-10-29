import "server-only";

// Antoines Tagestext: pro Person und Tag (Europe/Zurich) einmal von Claude geschrieben und in
// daily_notes gespeichert. Jeden Morgen um 05:00 über /api/home/daily; fehlt er beim Öffnen der
// Startseite, holt die App ihn einmal im Hintergrund nach. Ablauf: Zeile „pending“ anlegen (nur
// einer schreibt), Daten laden, Claude fragen, „done“ bzw. „failed“ speichern. Beim API-Limit
// „failed“ – bis morgen gibt es den Ersatztext, kein neuer Versuch.

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { usageLimit } from "@/lib/ai/api-errors";
import { RECOGNITION_MODEL, anthropic } from "@/lib/ingest/recognize";
import { noteContext, previousTexts } from "./compose";
import { loadHomeData, missingNotesTable } from "./data";
import { zurichParts } from "./dates";
import { placeholdersIn } from "./note";
import { DAILY_SYSTEM, DailyNoteSchema, dailyPrompt } from "./prompt";

type Db = SupabaseClient<Database>;

/** Klein und günstig: Haiku. */
export const DAILY_MODEL = RECOGNITION_MODEL;
/** Eine „pending“-Zeile älter als das gilt als abgebrochen (z. B. Zeitlimit) und darf neu. */
export const PENDING_STALE_MS = 10 * 60 * 1000;
/** Fehlertext beim API-Limit (kein neuer Versuch bis morgen). */
export const USAGE_LIMIT_ERROR = "usage_limit";

export type Generate = (system: string, prompt: string) => Promise<string>;

/** Claude: Text mit Platzhaltern (strukturiert, Schema DailyNoteSchema). */
export const claudeGenerate: Generate = async (system, prompt) => {
  const response = await anthropic().beta.messages.parse({
    model: DAILY_MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: betaZodOutputFormat(DailyNoteSchema) },
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`${DAILY_MODEL}: kein gültiges Ergebnis (${response.stop_reason})`);
  }
  return response.parsed_output.text.trim();
};

export type Person = { id: string; name: string };
export type DailyResult = "done" | "failed" | "limit" | "skipped" | "unavailable";

type Options = { generate?: Generate; retryFailed?: boolean; limitReached?: boolean };

/** Zeile für heute übernehmen: null = jemand anders schreibt gerade bzw. heute ist erledigt. */
async function claim(db: Db, personId: string, today: string, now: number, retryFailed: boolean): Promise<string | null | "missing"> {
  const { data: row, error } = await db.from("daily_notes").select("id, status, error, created_at").eq("person_id", personId).eq("note_date", today).maybeSingle();
  if (missingNotesTable(error)) return "missing";
  if (error) throw error;
  if (row) {
    const stale = row.status === "pending" && now - Date.parse(row.created_at) >= PENDING_STALE_MS;
    const retry = retryFailed && row.status === "failed" && row.error !== USAGE_LIMIT_ERROR;
    if (!stale && !retry) return null;
    // Nur übernehmen, wenn sich die Zeile seither nicht geändert hat (zwei gleichzeitige Aufrufe).
    const { data, error: updateError } = await db
      .from("daily_notes")
      .update({ status: "pending", error: null, created_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .eq("created_at", row.created_at)
      .select("id");
    if (updateError) throw updateError;
    return data?.[0]?.id ?? null;
  }
  const { data, error: insertError } = await db
    .from("daily_notes")
    .upsert({ person_id: personId, note_date: today, status: "pending", created_at: new Date(now).toISOString() }, { onConflict: "person_id,note_date", ignoreDuplicates: true })
    .select("id");
  if (missingNotesTable(insertError)) return "missing";
  if (insertError) throw insertError;
  return data?.[0]?.id ?? null;
}

/** Tagestext einer Person schreiben (falls heute noch keiner da ist). */
export async function generateDailyNote(db: Db, person: Person, at: Date | number = Date.now(), options: Options = {}): Promise<DailyResult> {
  const now = Number(new Date(at));
  const today = zurichParts(now).date;
  const id = await claim(db, person.id, today, now, !!options.retryFailed);
  if (id === "missing") return "unavailable";
  if (!id) return "skipped";
  const fail = async (error: string) => {
    const { error: e } = await db.from("daily_notes").update({ status: "failed", error: error.slice(0, 500), generated_at: new Date().toISOString() }).eq("id", id);
    if (e) console.error("daily note: saving failure failed", e.message);
  };
  if (options.limitReached) {
    await fail(USAGE_LIMIT_ERROR);
    return "limit";
  }
  try {
    const data = await loadHomeData(db, person.id, now);
    const context = noteContext(data, person.name, now);
    const prompt = dailyPrompt({ ...context.prompt, person: person.name, refs: context.refs, previous: previousTexts(data.notes ?? [], today) });
    const text = await (options.generate ?? claudeGenerate)(DAILY_SYSTEM, prompt);
    if (!text) throw new Error("leerer Text");
    // Nur die genannten Weine speichern; unbekannte Kürzel fallen beim Anzeigen weg (geloggt).
    const used = new Set(placeholdersIn(text));
    const unknown = [...used].filter((r) => !context.refs.some((x) => x.ref === r));
    if (unknown.length) console.warn("daily note: unknown wine refs", person.id, unknown.join(","));
    const { error } = await db
      .from("daily_notes")
      .update({ status: "done", text, wines: context.refs.filter((r) => used.has(r.ref)), model: DAILY_MODEL, error: null, generated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return "done";
  } catch (error) {
    if (usageLimit(error)) {
      console.warn("daily note: API usage limit", person.id);
      await fail(USAGE_LIMIT_ERROR);
      return "limit";
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("daily note failed", person.id, message);
    await fail(message);
    return "failed";
  }
}

/** Für alle Personen mit Login (Cron am Morgen). Nach dem API-Limit niemand mehr fragen. */
export async function generateAllDailyNotes(db: Db, at: Date | number = Date.now(), options: Omit<Options, "limitReached"> = {}) {
  const { data, error } = await db.from("persons").select("id, name").not("user_id", "is", null).order("sort_order");
  if (error) throw error;
  const results: Record<string, DailyResult> = {};
  let limitReached = false;
  for (const p of data ?? []) {
    const result = await generateDailyNote(db, p, at, { retryFailed: true, ...options, limitReached });
    if (result === "limit") limitReached = true;
    results[p.name] = result;
  }
  return results;
}
