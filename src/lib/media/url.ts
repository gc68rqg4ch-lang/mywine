// Stabile Bild-URLs: statt bei jedem Seitenaufruf neu signierter Links (andere URL → der Browser
// lädt jedes Mal neu) zeigt die App Fotos über die eigene Route /media/<bucket>/<pfad>. Die Route
// prüft die Anmeldung (Storage-RLS: nur Mitglieder) und liefert mit langem privatem Cache aus –
// Pfade sind eindeutig (UUID bzw. Telegram-Nachricht), ein neues Foto bekommt einen neuen Pfad.

export const MEDIA_BUCKETS = ["wine-photos"] as const;
export type MediaBucket = (typeof MEDIA_BUCKETS)[number];

/** Ein Jahr, privat (nur im Browser der Person), unveränderlich. */
export const MEDIA_CACHE_CONTROL = "private, max-age=31536000, immutable";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** URL für ein Foto im Bucket (ohne Netz, immer gleich für denselben Pfad). */
export function mediaUrl(path: string, bucket: MediaBucket = "wine-photos") {
  return `/media/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Bucket und Pfad aus der Route prüfen; null = ungültig (anderer Bucket, „..“, leere Teile). */
export function parseMediaPath(bucket: string, segments: string[]): { bucket: MediaBucket; path: string } | null {
  if (!(MEDIA_BUCKETS as readonly string[]).includes(bucket)) return null;
  if (!segments.length || segments.length > 8) return null;
  if (!segments.every((s) => SEGMENT.test(s) && !s.includes(".."))) return null;
  return { bucket: bucket as MediaBucket, path: segments.join("/") };
}
