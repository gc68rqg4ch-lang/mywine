// Vorhandene Produzenten (distinct wines.producer, mit Häufigkeit) und die Schreibweise, die ein
// neuer Wert annehmen soll. Rein im Code, ohne Claude-Aufruf.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { matchProducer, type ProducerMatch } from "./match";
import { tidyWineName } from "@/lib/ingest/wine-names";

type Db = SupabaseClient<Database>;

/** Alle Produzenten der Weine (je Wein einmal – mehrfach = häufiger). */
export async function loadProducers(db: Db): Promise<string[]> {
  const { data, error } = await db.from("wines").select("producer").not("producer", "is", null).limit(5000);
  if (error) throw error;
  return (data ?? []).map((r) => r.producer).filter((p): p is string => !!p?.trim());
}

/** Abgleich eines Namens mit den vorhandenen Produzenten (siehe match.ts). */
export async function resolveProducer(db: Db, name: string | null | undefined): Promise<ProducerMatch> {
  if (!name?.trim()) return { kind: "new" };
  return matchProducer(name, await loadProducers(db));
}

/** Schreibweise für einen neuen Wert: gleich → vorhandene, sonst wie angegeben (getrimmt). */
export async function canonicalProducer(db: Db, name: string): Promise<string> {
  const m = await resolveProducer(db, name);
  return m.kind === "same" ? m.producer : name.trim();
}

/**
 * Produzent und Weinname einheitlich (vor dem Speichern bzw. Vorschlagen): Produzent in der
 * gespeicherten Schreibweise (gleich nach Normalisierung, ohne Zusätze wie Vineyards/Cellars),
 * Produzent bzw. eine Variante davon vorne im Weinnamen weg. Fehler beim Laden: unverändert.
 */
export async function harmonizeWine<W extends { name: string | null; producer: string | null; type?: string | null }>(db: Db, wine: W): Promise<W> {
  const typed = wine.producer?.trim();
  const producer = typed ? await canonicalProducer(db, typed).catch(() => typed) : wine.producer;
  const name = tidyWineName(wine.name, producer, wine.type) ?? wine.name;
  return { ...wine, producer, name: tidyWineName(name, typed ?? null, wine.type) ?? name };
}
