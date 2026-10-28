import "server-only";

// Unwiderruflich löschen – Flaschen (falsch erfasst) bzw. den ganzen Wein. Gleiches Muster wie
// edit.ts (prepare → Vorschau → run). Ausgeführt über die DB-Funktionen delete_bottles
// (genau ein Journal-Eintrag „deleted“) und delete_wine (alles, ohne Journal). Danach werden
// die Fotos/Dokumente des Weins aus den Buckets entfernt (Original und Vorschaubild).

import { DOCUMENT_BUCKET } from "@/lib/media/documents";
import { fail, ready, wineTitle, type Db, type PreparedEdit } from "./helpers";
import { IRREVERSIBLE, deleteBottlesQuestion, deleteCount, nameConfirmed, wineDeleteSummaryText, type WineDeleteSummary } from "./delete-text";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

async function loadPosition(db: Db, itemId: string) {
  const { data, error } = await db
    .from("inventory_items")
    .select("id, wine_id, vintage_year, status, quantity, storage_room, drunk_at, wine:wines(name, producer)")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Flaschen einer Charge bzw. offene/getrunkene Position löschen; ohne count die ganze Position. */
export async function prepareDeleteBottles(db: Db, itemId: string, count?: number): Promise<PreparedEdit> {
  const item = await loadPosition(db, itemId);
  if (!item?.wine) return fail("Diese Flaschen gibt es nicht mehr.");
  if (count != null && !(Number.isInteger(count) && count >= 1)) return fail("Anzahl: mindestens 1 Flasche.");
  if (count != null && count > item.quantity) return fail(`Anzahl: höchstens ${item.quantity} (so viele hat diese Charge).`);
  const n = deleteCount(item, count);
  const rest = item.quantity - n;
  return ready(
    {
      title: wineTitle(item.wine, item.vintage_year),
      action: "Flaschen löschen",
      changes: [],
      notes: [
        deleteBottlesQuestion(item, n),
        ...(rest === 0 && item.status === "sealed" ? ["Die Charge verschwindet ganz; Bewertungen und Verkostungen bleiben beim Wein."] : []),
      ],
    },
    item.wine_id,
    async () => {
      const { data: left, error } = await db.rpc("delete_bottles", { p_item_id: item.id, p_quantity: count == null ? undefined : n });
      if (error) throw error;
      const what = item.status === "open" ? "die offene Flasche" : item.status === "drunk" ? plural(n, "getrunkene Flasche", "getrunkene Flaschen") : plural(n, "Flasche", "Flaschen");
      return left ? `${what} gelöscht (noch ${plural(left, "Flasche", "Flaschen")} in der Charge)` : `${what} gelöscht`;
    },
    item.vintage_year,
  );
}

/** Was beim Löschen des ganzen Weins verschwindet (für App-Dialog und Bot-Übersicht). */
export async function loadWineDeleteSummary(
  db: Db,
  wineId: string,
  /** Weinseite: der Wein ist schon geladen – die Prüfung „gibt es ihn?“ entfällt (eine Abfrage-Runde weniger). */
  options: { exists?: boolean } = {},
): Promise<WineDeleteSummary | null> {
  if (!options.exists) {
    const { data: wine, error } = await db.from("wines").select("id").eq("id", wineId).maybeSingle();
    if (error) throw error;
    if (!wine) return null;
  }
  const count = async (table: "wine_ratings" | "wine_tastings" | "wine_encounters") => {
    const { count: n, error: e } = await db.from(table).select("id", { count: "exact", head: true }).eq("wine_id", wineId);
    if (e) throw e;
    return n ?? 0;
  };
  const [items, media, ratings, tastings, encounters] = await Promise.all([
    db.from("inventory_items").select("status, quantity").eq("wine_id", wineId),
    db.from("wine_media").select("kind").eq("wine_id", wineId),
    count("wine_ratings"),
    count("wine_tastings"),
    count("wine_encounters"),
  ]);
  if (items.error) throw items.error;
  if (media.error) throw media.error;
  const sum = (status: string) => (items.data ?? []).filter((i) => i.status === status).reduce((s, i) => s + i.quantity, 0);
  const documents = (media.data ?? []).filter((m) => m.kind === "document").length;
  return {
    bottles: { sealed: sum("sealed"), open: sum("open"), drunk: sum("drunk") },
    ratings,
    tastings,
    encounters,
    photos: (media.data ?? []).length - documents,
    documents,
  };
}

/**
 * Ganzen Wein löschen. confirmName (App): der eingetippte Weinname muss passen; der Bot
 * bestätigt stattdessen zweistufig (Übersicht, dann „Ja, endgültig löschen“).
 */
export async function prepareDeleteWine(db: Db, wineId: string, confirmName?: string): Promise<PreparedEdit> {
  const { data: wine, error } = await db.from("wines").select("id, name, producer").eq("id", wineId).maybeSingle();
  if (error) throw error;
  if (!wine) return fail("Diesen Wein gibt es nicht mehr.");
  if (confirmName !== undefined && !nameConfirmed(confirmName, wine.name)) {
    return fail(`Zur Bestätigung bitte den Namen „${wine.name}“ genau eintippen.`);
  }
  const summary = (await loadWineDeleteSummary(db, wineId))!;
  return ready(
    {
      title: wineTitle(wine),
      action: "Ganzen Wein löschen",
      changes: [],
      notes: [`Es verschwindet alles: ${wineDeleteSummaryText(summary)}.`, IRREVERSIBLE],
    },
    null,
    async () => {
      const { data: files, error: rpcError } = await db.rpc("delete_wine", { p_wine_id: wine.id });
      if (rpcError) throw rpcError;
      await removeStoredFiles(files ?? []);
      return `den Wein ${wineTitle(wine)} mit allem gelöscht`;
    },
  );
}

/**
 * Fotos/Dokumente nach dem Löschen aus den Buckets entfernen (Original und Vorschaubild).
 * delete_wine hat die Mitgliedschaft schon geprüft; Storage über den Admin-Client. Fehler
 * werden geloggt – der Wein ist dann trotzdem gelöscht.
 */
async function removeStoredFiles(files: { storage_bucket: string; storage_path: string; thumb_path: string | null }[]) {
  if (!files.length) return;
  const byBucket = new Map<string, string[]>();
  for (const f of files) {
    const bucket = f.storage_bucket || DOCUMENT_BUCKET;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), f.storage_path, ...(f.thumb_path ? [f.thumb_path] : [])]);
  }
  // Erst hier laden: das Modul hängt am Bot-Werkzeug-Import, der Admin-Client nur am Löschen.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const storage = createAdminClient().storage;
  for (const [bucket, paths] of byBucket) {
    const { error } = await storage.from(bucket).remove(paths);
    if (error) console.error("delete wine: removing files failed", bucket, error);
  }
}
