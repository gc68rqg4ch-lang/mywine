import "server-only";

// Etikettfotos (wine_media) speichern und für die Anzeige signieren. Die Originale
// und die Vorschaubilder liegen im privaten Bucket wine-photos.

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Database } from "@/lib/database.types";
import { pickLabels, thumbPathFor, vintagePhotos, type MediaKind, type MediaRow } from "./pick";

type Db = SupabaseClient<Database>;

export const PHOTO_BUCKET = "wine-photos";
export const THUMB_WIDTH = 160;
/** Signierte URLs gelten eine Stunde – länger bleibt eine Seite selten offen. */
const SIGNED_SECONDS = 60 * 60;

const MEDIA_COLUMNS =
  "id, wine_id, inventory_item_id, kind, vintage_year, storage_path, thumb_path, sort_order, created_at" as const;

/** Vorschaubild: ca. 160 px breit, WebP; dreht nach EXIF, damit Handyfotos richtig stehen. */
export async function makeThumb(bytes: Uint8Array) {
  return sharp(bytes).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}

export type NewMedia = {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  kind: MediaKind;
  sortOrder: number;
  fileName?: string | null;
};

/**
 * Legt zu bereits hochgeladenen Originalen je ein Vorschaubild an und schreibt die
 * wine_media-Zeilen. Schlägt nur das Vorschaubild fehl, bleibt thumb_path leer –
 * die Anzeige nimmt dann das Original.
 */
export async function saveWineMedia(
  db: Db,
  target: { wineId: string; vintageYear: number | null; itemId: string | null },
  media: NewMedia[],
) {
  const rows = await Promise.all(
    media.map(async (m) => {
      let thumb: string | null = thumbPathFor(m.path);
      try {
        const { error } = await db.storage
          .from(PHOTO_BUCKET)
          .upload(thumb, await makeThumb(m.bytes), { contentType: "image/webp", upsert: false });
        if (error) throw error;
      } catch (error) {
        console.error("thumbnail failed", m.path, error);
        thumb = null;
      }
      return {
        wine_id: target.wineId,
        vintage_year: target.vintageYear,
        inventory_item_id: target.itemId,
        kind: m.kind,
        storage_bucket: PHOTO_BUCKET,
        storage_path: m.path,
        thumb_path: thumb,
        mime_type: m.mimeType,
        file_name: m.fileName ?? null,
        sort_order: m.sortOrder,
      };
    }),
  );
  if (!rows.length) return;
  const { error } = await db.from("wine_media").insert(rows);
  if (error) throw error;
}

/** Ein Foto, wie es Liste und Overlay brauchen (signierte URLs). */
export type ViewPhoto = { id: string; kind: MediaKind; thumb: string; full: string };

async function loadRows(db: Db, wineIds: string[], kinds: MediaKind[]) {
  if (!wineIds.length) return [];
  let query = db.from("wine_media").select(MEDIA_COLUMNS).in("kind", kinds).eq("storage_bucket", PHOTO_BUCKET);
  // Lange Listen nicht in die URL packen: dann alle Etiketten laden und hier filtern.
  if (wineIds.length <= 100) query = query.in("wine_id", wineIds);
  const { data, error } = await query;
  if (error) throw error;
  const wanted = new Set(wineIds);
  return (data satisfies MediaRow[]).filter((r) => wanted.has(r.wine_id));
}

/** Signiert alle Pfade mit einem einzigen Aufruf. */
async function signPaths(db: Db, paths: string[]) {
  const unique = [...new Set(paths)];
  const urls = new Map<string, string>();
  if (!unique.length) return urls;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(unique, SIGNED_SECONDS);
  if (error) {
    console.error("signing photos failed", error);
    return urls;
  }
  for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  return urls;
}

function toView(row: MediaRow, urls: Map<string, string>): ViewPhoto | null {
  const full = urls.get(row.storage_path);
  if (!full) return null;
  return { id: row.id, kind: row.kind, full, thumb: (row.thumb_path && urls.get(row.thumb_path)) || full };
}

export type LabelPair = { front: ViewPhoto; back: ViewPhoto | null };

/**
 * Etikettfotos für eine Liste: alle Vorder-/Rückseiten der Weine auf der Seite,
 * mit einem Abfrage- und einem Signier-Aufruf. `pick(wineId, jahrgang)` wählt dann
 * je Karte den gewünschten bzw. neuesten Jahrgang.
 */
export async function loadLabelPhotos(db: Db, wineIds: string[]) {
  const rows = await loadRows(db, [...new Set(wineIds)], ["label_front", "label_back"]).catch((error) => {
    // Ohne Fotos geht die Liste trotzdem (Trauben-Symbol).
    console.error("loading label photos failed", error);
    return [] as MediaRow[];
  });
  const byWine = new Map<string, MediaRow[]>();
  for (const r of rows) byWine.set(r.wine_id, [...(byWine.get(r.wine_id) ?? []), r]);
  const urls = await signPaths(
    db,
    rows.flatMap((r) => [r.storage_path, ...(r.thumb_path ? [r.thumb_path] : [])]),
  );
  return (wineId: string, year: number | null | undefined): LabelPair | null => {
    const picked = pickLabels(byWine.get(wineId) ?? [], year);
    const front = picked && toView(picked.front, urls);
    if (!front) return null;
    return { front, back: picked.back ? toView(picked.back, urls) : null };
  };
}

/**
 * Fotos eines Jahrgangs für die Weinseite (Vorderseite, Rückseite, weitere). Ältere
 * Bot-Fotos stehen nur in inventory_items.photo_urls – die kommen ohne Vorschaubild dazu.
 */
export async function loadVintagePhotos(db: Db, wineId: string, year: number | null, itemIds: string[]) {
  const [rows, legacy] = await Promise.all([
    loadRows(db, [wineId], ["label_front", "label_back", "photo"]),
    itemIds.length
      ? db.from("inventory_items").select("photo_urls").in("id", itemIds)
      : Promise.resolve({ data: [] as { photo_urls: string[] }[] }),
  ]);
  const media = vintagePhotos(rows, year);
  const known = new Set(rows.map((r) => r.storage_path));
  const legacyPaths = [...new Set((legacy.data ?? []).flatMap((r) => r.photo_urls))].filter(
    (p) => !/^[a-z]+:\/\//i.test(p) && !known.has(p),
  );
  const external = [...new Set((legacy.data ?? []).flatMap((r) => r.photo_urls))].filter((p) => p.startsWith("https://"));

  const urls = await signPaths(db, [
    ...media.flatMap((r) => [r.storage_path, ...(r.thumb_path ? [r.thumb_path] : [])]),
    ...legacyPaths,
  ]);
  const photos: ViewPhoto[] = media.flatMap((r) => toView(r, urls) ?? []);
  for (const p of legacyPaths) {
    const url = urls.get(p);
    if (url) photos.push({ id: p, kind: "photo", thumb: url, full: url });
  }
  for (const url of external) photos.push({ id: url, kind: "photo", thumb: url, full: url });
  return photos;
}
