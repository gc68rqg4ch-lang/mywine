import "server-only";

// Etikettfotos (wine_media) speichern und für die Anzeige vorbereiten. Die Originale
// und die Vorschaubilder liegen im privaten Bucket wine-photos; angezeigt werden sie über die
// eigene Route /media/… (stabile URL, Browser-Cache) – ohne Signier-Aufruf beim Seitenaufbau.

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Database } from "@/lib/database.types";
import { pickLabels, thumbPathFor, vintagePhotos, type MediaKind, type MediaRow } from "./pick";
import { mediaUrl } from "./url";

type Db = SupabaseClient<Database>;

export const PHOTO_BUCKET = "wine-photos";
export const THUMB_WIDTH = 160;

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

/**
 * Löscht wine_media-Zeilen samt Original und Vorschaubild im Bucket und nimmt die
 * Pfade aus inventory_items.photo_urls. `storageDb` darf löschen (Mitglieder haben
 * im Bucket nur Lese- und Schreibrechte – die App gibt dafür den Admin-Client mit).
 */
export async function removeWineMedia(
  db: Db,
  storageDb: Db,
  rows: Pick<MediaRow, "id" | "storage_path" | "thumb_path" | "inventory_item_id">[],
) {
  if (!rows.length) return;
  const { error } = await db
    .from("wine_media")
    .delete()
    .in("id", rows.map((r) => r.id));
  if (error) throw error;

  const paths = rows.flatMap((r) => [r.storage_path, ...(r.thumb_path ? [r.thumb_path] : [])]);
  const { error: storageError } = await storageDb.storage.from(PHOTO_BUCKET).remove(paths);
  // Verwaiste Dateien stören nicht; die Zeile ist weg und wird nirgends mehr angezeigt.
  if (storageError) console.error("removing photo files failed", storageError);

  const itemIds = [...new Set(rows.flatMap((r) => (r.inventory_item_id ? [r.inventory_item_id] : [])))];
  if (!itemIds.length) return;
  const { data: items } = await db.from("inventory_items").select("id, photo_urls").in("id", itemIds);
  const gone = new Set(paths);
  for (const item of items ?? []) {
    const kept = item.photo_urls.filter((p) => !gone.has(p));
    if (kept.length !== item.photo_urls.length) {
      await db.from("inventory_items").update({ photo_urls: kept }).eq("id", item.id);
    }
  }
}

/** wine_media-Zeilen eines Jahrgangs (z. B. vorhandene Vorder-/Rückseite vor dem Ersetzen). */
export async function loadVintageMedia(db: Db, wineId: string, year: number | null, kinds: MediaKind[]) {
  let query = db
    .from("wine_media")
    .select(MEDIA_COLUMNS)
    .eq("wine_id", wineId)
    .in("kind", kinds)
    .eq("storage_bucket", PHOTO_BUCKET);
  query = year == null ? query.is("vintage_year", null) : query.eq("vintage_year", year);
  const { data, error } = await query;
  if (error) throw error;
  return data satisfies MediaRow[];
}

/** Ein Foto, wie es Liste und Overlay brauchen (URLs der Bildroute). `legacy` = nur in photo_urls, ohne wine_media. */
export type ViewPhoto = { id: string; kind: MediaKind; thumb: string; full: string; legacy?: boolean };

/** wineIds null = alle Weine. */
async function loadRows(db: Db, wineIds: string[] | null, kinds: MediaKind[]) {
  if (wineIds && !wineIds.length) return [];
  let query = db.from("wine_media").select(MEDIA_COLUMNS).in("kind", kinds).eq("storage_bucket", PHOTO_BUCKET);
  // Lange Listen nicht in die URL packen: dann alle Etiketten laden und hier filtern.
  if (wineIds && wineIds.length <= 100) query = query.in("wine_id", wineIds);
  const { data, error } = await query;
  if (error) throw error;
  if (!wineIds) return data satisfies MediaRow[];
  const wanted = new Set(wineIds);
  return (data satisfies MediaRow[]).filter((r) => wanted.has(r.wine_id));
}

/** URLs der Bildroute für alle Pfade – ohne Netz (früher: ein Signier-Aufruf je Seite). */
function photoUrls(paths: string[]) {
  return new Map([...new Set(paths)].map((p) => [p, mediaUrl(p)] as const));
}

function toView(row: MediaRow, urls: Map<string, string>): ViewPhoto | null {
  const full = urls.get(row.storage_path);
  if (!full) return null;
  return { id: row.id, kind: row.kind, full, thumb: (row.thumb_path && urls.get(row.thumb_path)) || full };
}

export type LabelPair = { front: ViewPhoto; back: ViewPhoto | null };

/**
 * Etikettfotos für eine Liste: alle Vorder-/Rückseiten der Weine auf der Seite,
 * mit einem einzigen Abfrage-Aufruf (URLs ohne Netz). `pick(wineId, jahrgang)` wählt dann
 * je Karte den gewünschten bzw. neuesten Jahrgang.
 */
export async function loadLabelPhotos(db: Db, wineIds: string[] | null) {
  const rows = await loadRows(db, wineIds && [...new Set(wineIds)], ["label_front", "label_back"]).catch((error) => {
    // Ohne Fotos geht die Liste trotzdem (Trauben-Symbol).
    console.error("loading label photos failed", error);
    return [] as MediaRow[];
  });
  const byWine = new Map<string, MediaRow[]>();
  for (const r of rows) byWine.set(r.wine_id, [...(byWine.get(r.wine_id) ?? []), r]);
  const urls = photoUrls(rows.flatMap((r) => [r.storage_path, ...(r.thumb_path ? [r.thumb_path] : [])]));
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

  const urls = photoUrls([
    ...media.flatMap((r) => [r.storage_path, ...(r.thumb_path ? [r.thumb_path] : [])]),
    ...legacyPaths,
  ]);
  const photos: ViewPhoto[] = media.flatMap((r) => toView(r, urls) ?? []);
  for (const p of legacyPaths) {
    const url = urls.get(p);
    if (url) photos.push({ id: p, kind: "photo", thumb: url, full: url, legacy: true });
  }
  for (const url of external) photos.push({ id: url, kind: "photo", thumb: url, full: url, legacy: true });
  return photos;
}
