"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES, documentPrefix } from "@/lib/media/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function member() {
  const session = await getSession();
  return session.isMember ? session : null;
}

/** Zielpfad für ein neues PDF; der Browser lädt direkt in den Bucket hoch. */
export async function prepareDocumentUpload(wineId: string): Promise<{ path: string } | { error: string }> {
  if (!(await member())) return { error: "Kein Zugriff." };
  if (!UUID_RE.test(wineId)) return { error: "Ungültiger Wein." };
  return { path: `${documentPrefix(wineId)}${crypto.randomUUID()}.pdf` };
}

/**
 * Hochgeladenes PDF prüfen (Ort, Typ, Grösse) und als wine_media (kind document) zum
 * Jahrgang eintragen. Passt etwas nicht, wird die Datei wieder gelöscht.
 */
export async function registerDocument(input: {
  wineId: string;
  vintageYear: number | null;
  path: string;
  fileName: string;
}): Promise<ActionState> {
  const session = await member();
  if (!session) return { error: "Kein Zugriff." };
  const { wineId, vintageYear, path } = input;
  const prefix = documentPrefix(wineId);
  if (!UUID_RE.test(wineId) || !path.startsWith(prefix) || !/^[0-9a-f-]{36}\.pdf$/.test(path.slice(prefix.length))) {
    return { error: "Ungültiger Dateipfad." };
  }
  if (vintageYear != null && !(Number.isInteger(vintageYear) && vintageYear >= 1800 && vintageYear <= 2100)) {
    return { error: "Ungültiger Jahrgang." };
  }
  const admin = createAdminClient();
  const discard = async (error: string) => {
    await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    return { error };
  };

  const name = path.slice(prefix.length);
  const { data: listed, error: listError } = await session.supabase.storage
    .from(DOCUMENT_BUCKET)
    .list(prefix.slice(0, -1), { search: name, limit: 1 });
  const object = listed?.find((o) => o.name === name);
  if (listError || !object) return { error: "Die Datei ist nicht angekommen – bitte nochmals hochladen." };
  const size = Number(object.metadata?.size ?? 0);
  const mime = String(object.metadata?.mimetype ?? "");
  if (mime !== "application/pdf") return discard("Nur PDF-Dateien.");
  if (size > MAX_DOCUMENT_BYTES) return discard("Das PDF ist zu gross (max. 10 MB).");

  const fileName = input.fileName.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "Dokument.pdf";
  const { error } = await session.supabase.from("wine_media").insert({
    wine_id: wineId,
    vintage_year: vintageYear,
    kind: "document",
    storage_bucket: DOCUMENT_BUCKET,
    storage_path: path,
    mime_type: mime,
    file_name: fileName,
  });
  if (error) {
    console.error("register document failed", error);
    return discard("Das Dokument konnte nicht gespeichert werden.");
  }
  revalidatePath("/", "layout");
  return { ok: `„${fileName}“ gespeichert.` };
}

/** Dokument löschen (Rückfrage im Browser): Zeile und Datei im Bucket. */
export async function deleteDocument(mediaId: string): Promise<ActionState> {
  const session = await member();
  if (!session) return { error: "Kein Zugriff." };
  if (!UUID_RE.test(mediaId)) return { error: "Ungültiges Dokument." };
  const { data: row } = await session.supabase
    .from("wine_media")
    .select("id, storage_path, file_name")
    .eq("id", mediaId)
    .eq("kind", "document")
    .eq("storage_bucket", DOCUMENT_BUCKET)
    .maybeSingle();
  if (!row) return { error: "Dieses Dokument gibt es nicht mehr." };
  const { error } = await session.supabase.from("wine_media").delete().eq("id", row.id);
  if (error) {
    console.error("delete document failed", error);
    return { error: "Löschen ist fehlgeschlagen." };
  }
  // Mitglieder dürfen im Bucket nicht löschen – die Datei entfernt der Admin-Client (nur serverseitig).
  const { error: storageError } = await createAdminClient().storage.from(DOCUMENT_BUCKET).remove([row.storage_path]);
  if (storageError) console.error("removing document file failed", storageError);
  revalidatePath("/", "layout");
  return { ok: `„${row.file_name ?? "Dokument"}“ gelöscht.` };
}
