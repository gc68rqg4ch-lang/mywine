"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { getSession } from "@/lib/auth";
import type { MediaKind } from "@/lib/media/pick";
import { PHOTO_BUCKET, saveWineMedia } from "@/lib/media/store";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: MediaKind[] = ["label_front", "label_back", "photo"];
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Der Browser verkleinert vorher; mehr lässt die Server Action ohnehin nicht durch. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Foto zum Wein hochladen (Vorder-/Rückseite/weiteres) – mit Vorschaubild für die Listen. */
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

  revalidatePath("/", "layout");
  return { ok: "Foto gespeichert." };
}
