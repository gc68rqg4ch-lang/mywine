// Verwaiste Dateien in Storage (wine-photos, wine-documents) finden und – nur auf Wunsch – löschen.
// Verweis = wine_media.storage_path bzw. thumb_path, Fotos einer noch offenen Erfassung
// (ingest_jobs.photo_paths bei received/processing/needs_review) und inventory_items.photo_urls.
// Frische Dateien (jünger als minAgeMs) bleiben immer: ein Upload kann gerade laufen.
// Für scripts/cleanup-orphan-files.ts; ohne „server-only“, damit es auch als Skript läuft.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export const ORPHAN_BUCKETS = ["wine-photos", "wine-documents"] as const;
export const OPEN_JOB_STATUSES = ["received", "processing", "needs_review"] as const;
/** Standard: Dateien unter einer Stunde nie anfassen. */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

export type StorageFile = { bucket: string; path: string; createdAt: string | null; size: number | null };

/** Alle Dateien eines Buckets (Ordner rekursiv, seitenweise). */
export async function listBucket(db: Db, bucket: string, prefix = ""): Promise<StorageFile[]> {
  const out: StorageFile[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === ".emptyFolderPlaceholder") continue;
      // Ordner haben keine id.
      if (entry.id == null) out.push(...(await listBucket(db, bucket, path)));
      else out.push({ bucket, path, createdAt: entry.created_at ?? null, size: (entry.metadata as { size?: number } | null)?.size ?? null });
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

/** Alle Verweise als „bucket/pfad“. */
export async function loadReferences(db: Db) {
  const [media, jobs, items] = await Promise.all([
    db.from("wine_media").select("storage_bucket, storage_path, thumb_path"),
    db.from("ingest_jobs").select("photo_paths").in("status", [...OPEN_JOB_STATUSES]),
    db.from("inventory_items").select("photo_urls"),
  ]);
  for (const r of [media, jobs, items]) if (r.error) throw r.error;
  const refs = new Set<string>();
  for (const m of media.data ?? []) {
    refs.add(`${m.storage_bucket}/${m.storage_path}`);
    if (m.thumb_path) refs.add(`${m.storage_bucket}/${m.thumb_path}`);
  }
  for (const j of jobs.data ?? []) for (const p of j.photo_paths ?? []) refs.add(`wine-photos/${p}`);
  for (const i of items.data ?? []) for (const p of i.photo_urls ?? []) refs.add(`wine-photos/${p}`);
  return refs;
}

/** Dateien ohne Verweis, älter als minAgeMs (ohne Datum: gilt als alt). */
export async function findOrphanFiles(db: Db, options: { now?: number; minAgeMs?: number } = {}) {
  const now = options.now ?? Date.now();
  const minAge = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const [refs, ...lists] = await Promise.all([loadReferences(db), ...ORPHAN_BUCKETS.map((b) => listBucket(db, b))]);
  return lists
    .flat()
    .filter((f) => !refs.has(`${f.bucket}/${f.path}`))
    .filter((f) => !f.createdAt || now - Date.parse(f.createdAt) >= minAge);
}

/** Trockenlauf (Standard) bzw. mit apply löschen – nur Dateien ohne Verweis. */
export async function cleanupOrphanFiles(db: Db, options: { apply?: boolean; now?: number; minAgeMs?: number } = {}) {
  const orphans = await findOrphanFiles(db, options);
  let deleted = 0;
  if (options.apply) {
    for (const bucket of ORPHAN_BUCKETS) {
      const paths = orphans.filter((f) => f.bucket === bucket).map((f) => f.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { data, error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw error;
        deleted += data?.length ?? 0;
      }
    }
  }
  return { orphans, deleted };
}
