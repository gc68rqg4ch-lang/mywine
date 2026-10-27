import "server-only";

// Dokumente zum Wein (PDF): wine_media mit kind = 'document' im privaten Bucket
// wine-documents. Angezeigt für den gewählten Jahrgang und „ohne Jahrgang“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export const DOCUMENT_BUCKET = "wine-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const SIGNED_SECONDS = 60 * 60;

export type WineDocument = { id: string; name: string; url: string | null; vintageYear: number | null };

/** Dokumente eines Jahrgangs plus die ohne Jahrgang, mit signierten Links (ein Aufruf). */
export async function loadDocuments(db: Db, wineId: string, year: number | null): Promise<WineDocument[]> {
  let query = db
    .from("wine_media")
    .select("id, storage_path, file_name, vintage_year, created_at")
    .eq("wine_id", wineId)
    .eq("kind", "document")
    .eq("storage_bucket", DOCUMENT_BUCKET);
  query = year == null ? query.is("vintage_year", null) : query.or(`vintage_year.eq.${year},vintage_year.is.null`);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    console.error("loading documents failed", error);
    return [];
  }
  if (!data?.length) return [];
  const { data: signed } = await db.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrls(data.map((d) => d.storage_path), SIGNED_SECONDS);
  const urls = new Map((signed ?? []).flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
  return data.map((d) => ({
    id: d.id,
    name: d.file_name || d.storage_path.split("/").pop() || "Dokument",
    url: urls.get(d.storage_path) ?? null,
    vintageYear: d.vintage_year,
  }));
}

/** Anzahl Dokumente für Jahrgang + ohne Jahrgang (Bot-Details). */
export async function countDocuments(db: Db, wineId: string, year: number | null) {
  let query = db
    .from("wine_media")
    .select("id", { count: "exact", head: true })
    .eq("wine_id", wineId)
    .eq("kind", "document");
  query = year == null ? query.is("vintage_year", null) : query.or(`vintage_year.eq.${year},vintage_year.is.null`);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Pfad für ein neues Dokument; der Browser lädt dorthin hoch, der Server prüft das Präfix. */
export const documentPrefix = (wineId: string) => `app/${wineId}/`;
