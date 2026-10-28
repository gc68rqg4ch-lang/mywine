import "server-only";

// Dokumente zum Wein (PDF): wine_media mit kind = 'document' im privaten Bucket
// wine-documents. Angezeigt für den gewählten Jahrgang und „ohne Jahrgang“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scheduleTasteProfile } from "@/lib/research/taste-auto";

type Db = SupabaseClient<Database>;

export const DOCUMENT_BUCKET = "wine-documents";
/** 20 MB in App und Bot (Grenze des Buckets; Telegram liefert Dateien bis 20 MB). */
export { DOCUMENT_TOO_BIG, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_MB } from "./document-limits";
export const PDF_MIME = "application/pdf";
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

/** Dateinamen der Dokumente (Jahrgang + ohne Jahrgang), neueste zuerst – für ℹ️ Details im Bot. */
export async function documentNames(db: Db, wineId: string, year: number | null) {
  let query = db
    .from("wine_media")
    .select("file_name, storage_path, created_at")
    .eq("wine_id", wineId)
    .eq("kind", "document");
  query = year == null ? query.is("vintage_year", null) : query.or(`vintage_year.eq.${year},vintage_year.is.null`);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => d.file_name || d.storage_path.split("/").pop() || "Dokument");
}

/** Pfad für ein neues Dokument; der Browser lädt dorthin hoch, der Server prüft das Präfix. */
export const documentPrefix = (wineId: string) => `app/${wineId}/`;

/** Originalname behalten, nur Steuerzeichen weg, höchstens 200 Zeichen. */
export const cleanFileName = (name: string | null | undefined) =>
  (name ?? "").trim().replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "Dokument.pdf";

/** Sieht nach einem PDF aus (Dateianfang „%PDF“)? */
export const isPdfBytes = (bytes: Uint8Array) => bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";

/**
 * Dokument eintragen (wine_media, kind document) – gemeinsam für App und Bot. Die Datei liegt
 * schon im Bucket; klappt der Eintrag nicht, wird sie wieder gelöscht (removeOnError).
 * Mit Jahrgang und noch ohne Profil dafür: Profilsuche im Hintergrund (auch innerhalb von 12 Monaten).
 */
export async function insertDocumentRow(
  db: Db,
  doc: { wineId: string; vintageYear: number | null; path: string; fileName: string; mime?: string },
  removeOnError: (path: string) => Promise<unknown>,
) {
  const fileName = cleanFileName(doc.fileName);
  const { data, error } = await db
    .from("wine_media")
    .insert({
      wine_id: doc.wineId,
      vintage_year: doc.vintageYear,
      kind: "document",
      storage_bucket: DOCUMENT_BUCKET,
      storage_path: doc.path,
      mime_type: doc.mime ?? PDF_MIME,
      file_name: fileName,
    })
    .select("id")
    .single();
  if (error) {
    await removeOnError(doc.path);
    throw error;
  }
  if (doc.vintageYear != null) scheduleTasteProfile(doc.wineId, doc.vintageYear, { force: true });
  return { id: data.id, fileName };
}

/** PDF hochladen und eintragen (Bot) – gleicher Ort und gleicher Eintrag wie in der App. */
export async function storeDocument(db: Db, doc: { wineId: string; vintageYear: number | null; bytes: Uint8Array; fileName: string }) {
  if (!isPdfBytes(doc.bytes)) throw new Error("kein PDF");
  const path = `${documentPrefix(doc.wineId)}${crypto.randomUUID()}.pdf`;
  const { error } = await db.storage.from(DOCUMENT_BUCKET).upload(path, doc.bytes, { contentType: PDF_MIME, upsert: false });
  if (error) throw error;
  return insertDocumentRow(db, { ...doc, path }, (p) => db.storage.from(DOCUMENT_BUCKET).remove([p]));
}
