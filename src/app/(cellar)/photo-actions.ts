"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { getSession } from "@/lib/auth";
import type { MediaKind } from "@/lib/media/pick";
import { PHOTO_BUCKET, removeWineMedia, saveWineMedia } from "@/lib/media/store";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: MediaKind[] = ["label_front", "label_back", "photo"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Der Browser verkleinert vorher; mehr lässt die Server Action ohnehin nicht durch. */
const MAX_BYTES = 4 * 1024 * 1024;

const MEDIA_COLUMNS = "id, storage_path, thumb_path, inventory_item_id" as const;

/**
 * Foto zum Wein hochladen (Vorder-/Rückseite/weiteres) – mit Vorschaubild für die Listen.
 * `replaceIds`: diese Fotos desselben Weins danach löschen (Ersetzen, nach Rückfrage im Browser).
 */
export async function uploadWinePhoto(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const { supabase } = session;

  const wineId = String(formData.get("wineId") ?? "");
  const itemRaw = String(formData.get("itemId") ?? "");
  const yearRaw = String(formData.get("vintageYear") ?? "");
  const kind = String(formData.get("kind") ?? "") as MediaKind;
  const file = formData.get("photo");
  if (!UUID_RE.test(wineId)) return { error: "Ungültiger Wein." };
  if (!KINDS.includes(kind)) return { error: "Bitte Vorderseite, Rückseite oder Foto wählen." };
  const vintageYear = yearRaw === "" ? null : Number(yearRaw);
  if (vintageYear !== null && !(Number.isInteger(vintageYear) && vintageYear >= 1800 && vintageYear <= 2100)) {
    return { error: "Ungültiger Jahrgang." };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "Bitte ein Foto auswählen." };
  const ext = EXT[file.type];
  if (!ext) return { error: "Nur JPEG, PNG oder WebP." };
  if (file.size > MAX_BYTES) return { error: "Das Foto ist zu gross (max. 4 MB)." };

  // Charge nur übernehmen, wenn sie zu diesem Wein gehört.
  let itemId: string | null = null;
  if (UUID_RE.test(itemRaw)) {
    const { data } = await supabase.from("inventory_items").select("id").eq("id", itemRaw).eq("wine_id", wineId).maybeSingle();
    itemId = data?.id ?? null;
  }

  const replaceIds = String(formData.get("replaceIds") ?? "")
    .split(",")
    .filter((id) => UUID_RE.test(id));

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Nur echte Bilder ablegen (der Typ kommt vom Browser und ist nicht verlässlich).
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta?.width) return { error: "Die Datei ist kein lesbares Bild." };
  const path = `app/${wineId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("photo upload failed", uploadError);
    return { error: "Hochladen ist fehlgeschlagen." };
  }

  try {
    await saveWineMedia(supabase, { wineId, vintageYear, itemId }, [
      { path, bytes, mimeType: file.type, kind, sortOrder: 0, fileName: file.name || null },
    ]);
  } catch (error) {
    console.error("saving wine media failed", error);
    return { error: "Das Foto ist hochgeladen, konnte aber nicht zugeordnet werden." };
  }

  if (replaceIds.length) {
    try {
      const { data: old, error } = await supabase
        .from("wine_media")
        .select(MEDIA_COLUMNS)
        .in("id", replaceIds)
        .eq("wine_id", wineId)
        .eq("storage_bucket", PHOTO_BUCKET);
      if (error) throw error;
      await removeWineMedia(supabase, createAdminClient(), old);
    } catch (error) {
      console.error("removing replaced photo failed", error);
      revalidatePath("/", "layout");
      return { error: "Das neue Foto ist gespeichert, das alte konnte aber nicht gelöscht werden." };
    }
  }

  revalidatePath("/", "layout");
  return { ok: replaceIds.length ? "Foto ersetzt." : "Foto gespeichert." };
}

/** Foto löschen (Rückfrage im Browser): Zeile, Original und Vorschaubild. */
export async function deleteWinePhoto(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const { supabase } = session;

  const mediaId = String(formData.get("mediaId") ?? "");
  if (!UUID_RE.test(mediaId)) return { error: "Ungültiges Foto." };
  // Über den Client der Session lesen: RLS stellt sicher, dass nur Mitglieder das Foto sehen.
  const { data: row, error } = await supabase
    .from("wine_media")
    .select(MEDIA_COLUMNS)
    .eq("id", mediaId)
    .eq("storage_bucket", PHOTO_BUCKET)
    .maybeSingle();
  if (error || !row) return { error: "Dieses Foto gibt es nicht mehr." };

  try {
    // Mitglieder dürfen im Bucket nicht löschen – die Dateien entfernt der Admin-Client (nur serverseitig).
    await removeWineMedia(supabase, createAdminClient(), [row]);
  } catch (err) {
    console.error("deleting photo failed", err);
    return { error: "Löschen ist fehlgeschlagen." };
  }
  revalidatePath("/", "layout");
  return { ok: "Foto gelöscht." };
}
