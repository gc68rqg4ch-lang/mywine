import "server-only";

import { PENDING_TTL_MS } from "@/lib/chat/ttl";
import { createHash } from "node:crypto";
import type { Json, Tables } from "@/lib/database.types";
import type { AdminClient } from "@/lib/supabase/admin";
import type { IngestState, IngestStep } from "./schema";

export const PHOTO_BUCKET = "wine-photos";

/**
 * Ruhezeit, nach der ein Album als vollständig gilt. Telegram schickt jedes Foto
 * eines Albums als eigenes Update (meist innerhalb einer Sekunde).
 */
export const ALBUM_QUIET_MS = 3000;

export type IngestJob = Tables<"ingest_jobs">;

/**
 * Deterministische Job-ID pro Album (bzw. Einzelfoto). Alle Updates eines Albums
 * landen dadurch ohne zusätzliche Spalte im selben ingest_jobs-Datensatz.
 */
export function jobIdFor(chatId: number, groupKey: string) {
  const hex = createHash("sha256").update(`telegram:${chatId}:${groupKey}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function photoFolder(jobId: string) {
  return `telegram/${jobId}`;
}

/**
 * Fotos desselben Chats, die so kurz nacheinander kommen, gehören in denselben Ablauf – auch
 * einzeln geschickt (Vorder- und Rückseite als zwei Nachrichten). 15 s: genug, um das zweite
 * Foto auszuwählen und zu schicken (beim Heida-Fall 1,1 s, von Hand meist 2–8 s); kurz genug,
 * dass die nächste Flasche in der Regel einen eigenen Ablauf bekommt.
 */
export const PHOTO_JOIN_MS = 15_000;

/** Ablauf, der noch Fotos annimmt: sammelt, wird erkannt oder steht vor der ersten Antwort. */
export type OpenPhotoJob = { job: IngestJob; phase: "received" | "processing" | "asked" };

/**
 * Offener Foto-Ablauf dieses Chats mit Aktivität in den letzten 15 s. „asked“ nur vor der
 * ersten Antwort: Frage „gekauft oder verkostet?“ bzw. der erste Vorschlag (photo_join).
 */
export async function findOpenPhotoJob(db: AdminClient, chatId: number, now = Date.now()): Promise<OpenPhotoJob | null> {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("source", "telegram")
    .in("status", ["received", "processing", "needs_review"])
    .gte("updated_at", new Date(now - PHOTO_JOIN_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.status === "received") return { job: data, phase: "received" };
  if (data.status === "processing") return { job: data, phase: "processing" };
  const state = jobState(data);
  if (state?.step === "intent" || (state?.step === "review" && state.photo_join)) return { job: data, phase: "asked" };
  return null;
}

/**
 * Legt den Job an, falls es ihn noch nicht gibt (erstes Foto eines Albums bzw. Einzelfoto).
 * false = ein anderer Foto-Ablauf dieses Chats sammelt schon (Unique-Index, gleichzeitige Aufrufe).
 */
export async function ensureJob(db: AdminClient, jobId: string, chatId: number) {
  const { error } = await db
    .from("ingest_jobs")
    .upsert(
      { id: jobId, source: "telegram", telegram_chat_id: chatId, status: "received" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}

/**
 * Foto an einen laufenden Ablauf hängen (photo_paths), ohne Änderungen anderer zu überschreiben:
 * nur wenn sich der Eintrag seit dem Lesen nicht geändert hat (sonst neu lesen, höchstens 5×).
 */
export async function appendJobPhoto(db: AdminClient, jobId: string, path: string, messageId: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: job, error } = await db.from("ingest_jobs").select("photo_paths, telegram_message_ids, updated_at, status").eq("id", jobId).maybeSingle();
    if (error) throw error;
    if (!job || !["processing", "needs_review"].includes(job.status)) return false;
    if (job.photo_paths.includes(path)) return true;
    const { data: updated, error: updateError } = await db
      .from("ingest_jobs")
      .update({ photo_paths: [...job.photo_paths, path], telegram_message_ids: [...job.telegram_message_ids, messageId] })
      .eq("id", jobId)
      .eq("updated_at", job.updated_at)
      .select("id");
    if (updateError) throw updateError;
    if (updated?.length) return true;
  }
  return false;
}

/**
 * Markiert neue Aktivität am Album (setzt updated_at per Trigger neu).
 * false = der Job wird bereits verarbeitet, das Foto kam zu spät.
 */
export async function touchReceivedJob(db: AdminClient, jobId: string) {
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ status: "received" })
    .eq("id", jobId)
    .eq("status", "received")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Beansprucht ein ruhiges Album zur Verarbeitung. Nur genau ein Request gewinnt;
 * kamen in der Ruhezeit noch Fotos dazu, übernimmt der Request des letzten Fotos.
 */
export async function claimJob(db: AdminClient, jobId: string) {
  const cutoff = new Date(Date.now() - ALBUM_QUIET_MS).toISOString();
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ status: "processing" })
    .eq("id", jobId)
    .eq("status", "received")
    .lt("updated_at", cutoff)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Fotos eines Jobs aus dem Storage, sortiert nach Telegram-Message-ID. */
export async function listJobPhotos(db: AdminClient, jobId: string) {
  const folder = photoFolder(jobId);
  const { data, error } = await db.storage.from(PHOTO_BUCKET).list(folder, { limit: 20 });
  if (error) throw error;
  return (data ?? [])
    .map((obj) => ({ path: `${folder}/${obj.name}`, messageId: Number.parseInt(obj.name, 10) }))
    .filter((p) => Number.isSafeInteger(p.messageId))
    .sort((a, b) => a.messageId - b.messageId);
}

export function jobState(job: Pick<IngestJob, "extracted">) {
  return job.extracted as unknown as IngestState | null;
}

export function toJson(state: IngestState) {
  return state as unknown as Json;
}

/**
 * Schaltet den Gesprächszustand atomar weiter: nur wenn der Job noch im
 * erwarteten Schritt ist (schützt vor Doppelklicks und parallelen Updates).
 */
export async function advanceJob(
  db: AdminClient,
  job: IngestJob,
  from: IngestStep | IngestStep[],
  patch: Partial<IngestState>,
  columns: Partial<Pick<IngestJob, "status" | "matched_wine_id" | "inventory_item_id" | "confidence" | "error">> = {},
) {
  const current = jobState(job);
  if (!current) return null;
  const allowed = Array.isArray(from) ? from : [from];
  if (!allowed.includes(current.step)) return null;

  // Jede Antwort beendet „weitere Fotos gehören noch dazu“ (photo_join).
  const next: IngestState = { ...current, ...patch, photo_join: undefined };
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ extracted: toJson(next), ...columns })
    .eq("id", job.id)
    .eq("status", "needs_review")
    .eq("extracted->>step", current.step)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadJob(db: AdminClient, jobId: string, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** So lange wartet „Neuer Wein“ auf eine Beschreibung; danach geht Text wieder an den Chat. */
export const DESCRIBE_WINDOW_MS = PENDING_TTL_MS;

/** Jüngster Job, der gerade auf eine Textantwort wartet. */
export async function findJobAwaitingText(db: AdminClient, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .in("extracted->>step", [
      "describe",
      "producer",
      "vintage",
      "correcting",
      "quantity",
      "price",
      "gift_from",
      "regular_price",
      "vendor",
      "vendor_new",
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data && jobState(data)?.step === "describe" && Date.parse(data.updated_at) < Date.now() - DESCRIBE_WINDOW_MS) {
    await db.from("ingest_jobs").update({ status: "discarded" }).eq("id", data.id);
    return null;
  }
  return data;
}

export async function deleteJobPhotos(db: AdminClient, paths: string[]) {
  if (paths.length) await db.storage.from(PHOTO_BUCKET).remove(paths);
}
