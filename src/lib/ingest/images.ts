import "server-only";

// Fotos einer Erfassung aus dem Storage laden (für Erkennung und Prüfschritt der Namen).

import type { AdminClient } from "@/lib/supabase/admin";
import { PHOTO_BUCKET } from "./jobs";
import type { LabelImage } from "./recognize";

export const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export function extensionOf(path: string): keyof typeof IMAGE_TYPES | null {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext && ext in IMAGE_TYPES ? (ext as keyof typeof IMAGE_TYPES) : null;
}

export async function loadLabelImages(db: AdminClient, paths: string[]): Promise<LabelImage[]> {
  return Promise.all(
    paths.map(async (path) => {
      const { data, error } = await db.storage.from(PHOTO_BUCKET).download(path);
      if (error) throw error;
      const ext = extensionOf(path) ?? "jpg";
      return {
        mediaType: IMAGE_TYPES[ext],
        base64: Buffer.from(await data.arrayBuffer()).toString("base64"),
      };
    }),
  );
}
