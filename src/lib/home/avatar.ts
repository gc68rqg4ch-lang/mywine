import "server-only";

// Antoines Foto auf der Startseite: sein Telegram-Profilbild (Bot API getMe →
// getUserProfilePhotos → getFile). Einmal geholt und im Bucket wine-photos unter app-assets/
// abgelegt (nicht bei jedem Aufruf); wöchentlich (Route /api/home/daily) bzw. per Knopf auf
// /recherche neu. Jede Version bekommt einen neuen Pfad (antoine-<Zeit>.jpg) – die Bild-URLs
// werden lange zwischengespeichert. app-assets/ ist vom Aufräumen verwaister Dateien ausgenommen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { PHOTO_BUCKET } from "@/lib/media/store";
import { mediaUrl } from "@/lib/media/url";
import { APP_ASSETS_PREFIX } from "@/lib/media/orphans";
import { downloadFile, tg } from "@/lib/telegram/api";

type Db = SupabaseClient<Database>;

export const APP_ASSETS = APP_ASSETS_PREFIX;
export const AVATAR_MAX_AGE_MS = 7 * 86_400_000;
const AVATAR_FILE = /^antoine-(\d+)\.jpg$/;

export type Avatar = { url: string; savedAt: number } | null;

/** Neustes gespeichertes Foto (null = noch keins). */
export async function loadAvatar(db: Db): Promise<Avatar> {
  const { data, error } = await db.storage.from(PHOTO_BUCKET).list(APP_ASSETS, { limit: 100 });
  if (error || !data) return null;
  const newest = data
    .map((f) => ({ name: f.name, at: Number(f.name.match(AVATAR_FILE)?.[1] ?? NaN) }))
    .filter((f) => Number.isFinite(f.at))
    .sort((a, b) => b.at - a.at)[0];
  return newest ? { url: mediaUrl(`${APP_ASSETS}/${newest.name}`), savedAt: newest.at } : null;
}

export const avatarStale = (avatar: Avatar, now = Date.now()) => !avatar || now - avatar.savedAt >= AVATAR_MAX_AGE_MS;

type PhotoSize = { file_id: string; width: number; height: number };

/** Profilbild von Telegram holen und speichern; ältere Versionen löschen. */
export async function refreshAvatar(db: Db, now = Date.now()): Promise<"saved" | "none"> {
  const me = await tg<{ id: number }>("getMe");
  const photos = await tg<{ total_count: number; photos: PhotoSize[][] }>("getUserProfilePhotos", { user_id: me.id, limit: 1 });
  const sizes = photos.photos?.[0] ?? [];
  if (!sizes.length) return "none";
  // Für 96–120 px (Retina): die kleinste Grösse ab 320 px, sonst die grösste.
  const size = [...sizes].sort((a, b) => a.width - b.width).find((s) => s.width >= 320) ?? sizes.at(-1)!;
  const { bytes } = await downloadFile(size.file_id);
  const name = `antoine-${now}.jpg`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(`${APP_ASSETS}/${name}`, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = await db.storage.from(PHOTO_BUCKET).list(APP_ASSETS, { limit: 100 });
  const old = (data ?? []).map((f) => f.name).filter((n) => AVATAR_FILE.test(n) && n !== name);
  if (old.length) await db.storage.from(PHOTO_BUCKET).remove(old.map((n) => `${APP_ASSETS}/${n}`));
  return "saved";
}

/** Wöchentlich: nur holen, wenn keins da ist oder es älter als 7 Tage ist. Fehler nur loggen. */
export async function refreshAvatarIfStale(db: Db, now = Date.now()) {
  try {
    if (!avatarStale(await loadAvatar(db), now)) return "fresh";
    return await refreshAvatar(db, now);
  } catch (error) {
    console.warn("avatar: refresh failed", error instanceof Error ? error.message : error);
    return "error";
  }
}
