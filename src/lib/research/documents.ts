import "server-only";

// Angehängte Datenblätter (wine_media, kind document, Bucket wine-documents) als zusätzliche
// Quelle für Recherche und Geschmacksprofil – neben der Websuche. Nur für genau den gesuchten
// Jahrgang: PDFs mit diesem vintage_year; PDFs ohne vintage_year nur, wenn der Jahrgang im Text
// eindeutig steht und passt; andere Jahrgänge nie. Zu grosse bzw. zu lange PDFs werden
// übersprungen (Kosten). Fehler: ohne dieses PDF weiter, Log „research document failed“.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DOCUMENT_BUCKET } from "@/lib/media/documents";
import { pdfPageCount, pdfText, vintageInPdfText } from "./pdf-text";

type Db = SupabaseClient<Database>;

export const MAX_RESEARCH_DOC_BYTES = 5 * 1024 * 1024;
export const MAX_RESEARCH_DOC_PAGES = 10;

export type ResearchDocument = {
  id: string;
  /** Originaldateiname – erscheint in den Quellen als „Dokument: <Name>“. */
  name: string;
  /** Jahrgang, für den das PDF gilt (null = Wein ohne Jahrgang). */
  year: number | null;
  base64: string;
};

/** Kennung eines Dokuments in den Quellen und Belegen (keine URL). */
export const documentRef = (name: string) => `dokument:${name}`;
export const documentTitle = (name: string) => `Dokument: ${name}`;


/**
 * PDFs des Weins für die gesuchten Jahrgänge laden. years: Jahrgänge der Recherche
 * (null = ohne Jahrgang). Gibt nur PDFs zurück, die sicher zu einem dieser Jahrgänge gehören.
 */
export async function loadResearchDocuments(
  db: Db,
  wine: { id: string; name: string },
  years: (number | null)[],
): Promise<ResearchDocument[]> {
  if (!years.length) return [];
  const { data, error } = await db
    .from("wine_media")
    .select("id, file_name, storage_path, vintage_year, created_at")
    .eq("wine_id", wine.id)
    .eq("kind", "document")
    .eq("storage_bucket", DOCUMENT_BUCKET);
  if (error) {
    console.error("research document failed", wine.id, error.message);
    return [];
  }
  const out: ResearchDocument[] = [];
  for (const row of data ?? []) {
    // Anderer Jahrgang: nie verwenden.
    if (row.vintage_year != null && !years.includes(row.vintage_year)) continue;
    const name = row.file_name || row.storage_path.split("/").pop() || "Dokument.pdf";
    try {
      const { data: blob, error: dlError } = await db.storage.from(DOCUMENT_BUCKET).download(row.storage_path);
      if (dlError || !blob) throw dlError ?? new Error("leer");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > MAX_RESEARCH_DOC_BYTES) {
        console.warn("research document skipped (zu gross)", name, bytes.length);
        continue;
      }
      if (pdfPageCount(bytes) > MAX_RESEARCH_DOC_PAGES) {
        console.warn("research document skipped (zu viele Seiten)", name);
        continue;
      }
      let year = row.vintage_year;
      if (year == null && !years.includes(null)) {
        // Ohne Jahrgang am Dokument: nur, wenn er im Text eindeutig steht und passt.
        const found = vintageInPdfText(pdfText(bytes), wine.name);
        if (found == null || !years.includes(found)) continue;
        year = found;
      }
      out.push({ id: row.id, name, year, base64: Buffer.from(bytes).toString("base64") });
    } catch (e) {
      console.error("research document failed", name, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** Hinweis im Prompt: welche Dokumente beiliegen, für welchen Jahrgang, wie zitieren. */
export function documentsNote(docs: ResearchDocument[]) {
  if (!docs.length) return "";
  return `\nBeigelegte Datenblätter (zusätzlich zur Websuche, gelten nur für den genannten Jahrgang):\n${docs
    .map((d) => `- „${d.name}“ – Jahrgang ${d.year ?? "ohne (NV)"}; als Quelle mit url "${documentRef(d.name)}" und kind "document" angeben`)
    .join("\n")}\nAngaben aus einem Datenblatt gelten nur für dessen Jahrgang.`;
}
