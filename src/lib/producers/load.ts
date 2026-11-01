// Vorhandene Produzenten (distinct wines.producer, mit Häufigkeit) und die Schreibweise, die ein
// neuer Wert annehmen soll. Rein im Code, ohne Claude-Aufruf.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { matchProducer, type ProducerMatch } from "./match";

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
