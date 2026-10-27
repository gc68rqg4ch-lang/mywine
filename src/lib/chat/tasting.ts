import "server-only";

import { after } from "next/server";
import type { Json } from "@/lib/database.types";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import { todayIso } from "@/lib/format";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { answerCallback, clearKeyboard, editMessage, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgInlineButton, TgInlineKeyboard } from "@/lib/telegram/types";
import { applyExtraction, draftSummary, missingCategories } from "@/lib/tasting/bot-draft";
import { extractTasting } from "@/lib/tasting/extract";
import { newTastingData, normalizeData, type SatData } from "@/lib/tasting/sat";
import { tastingRow } from "@/lib/tasting/store";
import { backRow, btn, type ListRef, type Subject } from "./menu-view";

// Entwürfe liegen in ingest_jobs (source = telegram_tasting, Stand in extracted) –
// derselbe Zwischenspeicher wie bei der Foto-Erfassung, ohne eigene Tabelle.
export const TASTING_SOURCE = "telegram_tasting";

/** So lange wartet ein Entwurf nach „Erzählen“/„Ergänzen“ auf Freitext. */
const TEXT_WINDOW_MS = 60 * 60 * 1000;

type Step = "text" | "review";

export type TastingDraft = {
  kind: "tasting";
  step: Step;
  itemId: string;
  wineId: string;
  vintageYear: number | null;
  title: string;
  personId: string | null;
  sat: SatData;
  cardMessageId: number | null;
  texts: string[];
};

type Screen = { text: string; keyboard: TgInlineKeyboard };

const e = escapeHtml;

// ---------------------------------------------------------------------------
// Callback-Daten: Y:<aktion>:<entwurf>  (s speichern, a speichern + App, f ergänzen/korrigieren,
// p Person wechseln, c verwerfen)

type TastingAction = "s" | "a" | "f" | "p" | "c";
const ACTIONS: TastingAction[] = ["s", "a", "f", "p", "c"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const yBtn = (text: string, action: TastingAction, jobId: string): TgInlineButton => ({
  text,
  callback_data: `Y:${action}:${jobId}`,
});

export function isTastingCallback(data: string | undefined) {
  return /^Y:/.test(data ?? "");
}

function decode(data: string | undefined) {
  const [, action, jobId] = (data ?? "").split(":");
  return ACTIONS.includes(action as TastingAction) && UUID_RE.test(jobId ?? "")
    ? { action: action as TastingAction, jobId }
    : null;
}

// ---------------------------------------------------------------------------
// Flasche zum Wein + Jahrgang (Verkostungen hängen an einer Flasche, wie in der App)

async function resolveItem(db: AdminClient, subject: Subject) {
  if (subject.kind === "item") {
    const { data } = await db
      .from("inventory_items")
      .select("id, wine_id, vintage_year, status, drunk_at")
      .eq("id", subject.itemId)
      .maybeSingle();
    return data;
  }
  let q = db.from("inventory_items").select("id, wine_id, vintage_year, status, drunk_at").eq("wine_id", subject.wineId);
  q = subject.year == null ? q.is("vintage_year", null) : q.eq("vintage_year", subject.year);
  const { data } = await q;
  const order = { open: 0, sealed: 1, drunk: 2 } as const;
  return (
    [...(data ?? [])].sort(
      (a, b) => order[a.status] - order[b.status] || (b.drunk_at ?? "").localeCompare(a.drunk_at ?? ""),
    )[0] ?? null
  );
}

function appUrl(path: string) {
  const base = appBaseUrl();
  return base ? `${base}${path}` : null;
}

/** Erstes Menü nach „📝 Verkostung“: Erzählen oder vollständig in der App. */
export async function tastingStartScreen(db: AdminClient, subject: Subject, back: ListRef, header: string): Promise<Screen> {
  const item = await resolveItem(db, subject);
  const url = item ? appUrl(`/flasche/${item.id}/verkostung`) : null;
  const subjectBack: Parameters<typeof btn>[1] =
    subject.kind === "item"
      ? { op: "item", itemId: subject.itemId, back }
      : { op: "vintage", wineId: subject.wineId, year: subject.year, back };
  return {
    text: `${header}\n📝 Verkostung erfassen:\n• <b>Erzählen</b>: Eindrücke schreiben oder diktieren, ich ordne sie dem WSET-Schema zu.\n• <b>Vollständig</b>: das ganze Formular in der App.`,
    keyboard: {
      inline_keyboard: [
        [btn("💬 Erzählen", { op: "tell", subject, back })],
        ...(url ? [[{ text: "📋 Vollständig in der App", url }]] : []),
        [btn("‹ Zurück", subjectBack)],
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Entwurf anlegen / laden / speichern

async function defaultPerson(db: AdminClient) {
  const { data } = await db.from("persons").select("id, name").order("sort_order");
  return (data ?? []).find((p) => p.name === "Michel") ?? data?.[0] ?? null;
}

/** „💬 Erzählen“: Entwurf anlegen und um Freitext bitten (ersetzt das Menü). */
export async function startTelling(
  db: AdminClient,
  chatId: number,
  subject: Subject,
  back: ListRef,
  /** Wer erzählt – Standard für die Verkostung (sonst Michel). */
  personId: string | null = null,
): Promise<Screen> {
  const item = await resolveItem(db, subject);
  if (!item) return { text: "Zu diesem Wein gibt es keine Flasche mehr.", keyboard: { inline_keyboard: backRow(back) } };
  const { data: wine, error } = await db
    .from("wines")
    .select("id, name, producer, region, country, type, grapes")
    .eq("id", item.wine_id)
    .single();
  if (error) throw error;
  const grapes = await loadGrapeShares(db, wine.id, item.vintage_year);
  const today = todayIso();
  const sat = newTastingData(wine, item.vintage_year, grapes ? formatShares(grapes.shares) : wine.grapes.join(", "), today);
  const person = personId ? { id: personId } : await defaultPerson(db);
  const title = `${wine.name} ${item.vintage_year ?? "o. J."}`;

  // Ältere offene Entwürfe dieses Chats beenden – es gibt immer nur einen.
  await db
    .from("ingest_jobs")
    .update({ status: "discarded" })
    .eq("source", TASTING_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review");

  const draft: TastingDraft = {
    kind: "tasting",
    step: "text",
    itemId: item.id,
    wineId: wine.id,
    vintageYear: item.vintage_year,
    title,
    personId: person?.id ?? null,
    sat,
    cardMessageId: null,
    texts: [],
  };
  const { data: job, error: jobError } = await db
    .from("ingest_jobs")
    .insert({
      source: TASTING_SOURCE,
      telegram_chat_id: chatId,
      status: "needs_review",
      matched_wine_id: wine.id,
      inventory_item_id: item.id,
      extracted: draft as unknown as Json,
    })
    .select("id")
    .single();
  if (jobError) throw jobError;

  return {
    text: `📝 <b>${e(title)}</b>\nErzähl mir deine Eindrücke – Farbe, Nase, Gaumen, Abgang, Trinkreife. Einfach schreiben oder diktieren.`,
    keyboard: { inline_keyboard: [[yBtn("✖️ Abbrechen", "c", job.id)]] },
  };
}

async function loadDraft(db: AdminClient, jobId: string, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("id, status, extracted, updated_at")
    .eq("id", jobId)
    .eq("source", TASTING_SOURCE)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, draft: data.extracted as unknown as TastingDraft } : null;
}

async function saveDraft(db: AdminClient, jobId: string, draft: TastingDraft) {
  const { error } = await db.from("ingest_jobs").update({ extracted: draft as unknown as Json }).eq("id", jobId);
  if (error) throw error;
}

/** Entwurf dieses Chats, der gerade auf Freitext wartet (nach „Erzählen“ / „Ergänzen“). */
export async function findTastingAwaitingText(db: AdminClient, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("id, extracted, updated_at")
    .eq("source", TASTING_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "text")
    .gt("updated_at", new Date(Date.now() - TEXT_WINDOW_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, draft: data.extracted as unknown as TastingDraft } : null;
}

// ---------------------------------------------------------------------------
// Karte mit Vorschlag

async function personName(db: AdminClient, personId: string | null) {
  if (!personId) return null;
  const { data } = await db.from("persons").select("name").eq("id", personId).maybeSingle();
  return data?.name ?? null;
}

async function nextPerson(db: AdminClient, personId: string | null) {
  const { data } = await db.from("persons").select("id, name").order("sort_order");
  const list = data ?? [];
  if (!list.length) return null;
  const i = list.findIndex((p) => p.id === personId);
  return list[(i + 1) % list.length];
}

/** Karte mit Vorschlag und Knöpfen; exportiert für Tests. */
export async function cardScreen(db: AdminClient, jobId: string, draft: TastingDraft): Promise<Screen> {
  const sat = normalizeData(draft.sat, todayIso());
  const summary = draftSummary(sat);
  const missing = missingCategories(sat);
  const [name, other] = await Promise.all([personName(db, draft.personId), nextPerson(db, draft.personId)]);
  const lines = [
    `📝 <b>${e(draft.title)}</b>${name ? ` · ${e(name)}` : ""}`,
    `<b>Resultat: ${e(summary.result)}</b>`,
    `👃 ${e(summary.nose)}`,
    `👅 ${e(summary.palate)}`,
    `⏳ Trinkreife: ${e(summary.readiness ?? "–")}`,
  ];
  if (missing.length) lines.push("", `Noch offen: ${e(missing.join(", "))} – ergänzen?`);
  const main = missing.length
    ? [yBtn("✏️ Ergänzen", "f", jobId), yBtn("💾 Trotzdem speichern", "s", jobId)]
    : [yBtn("💾 Speichern", "s", jobId), yBtn("✏️ Korrigieren", "f", jobId)];
  const second: TgInlineButton[] = [];
  if (other && other.id !== draft.personId) second.push(yBtn(`👤 Für ${other.name}`, "p", jobId));
  if (appBaseUrl()) second.push(yBtn("📱 In der App bearbeiten", "a", jobId));
  return {
    text: lines.join("\n"),
    keyboard: { inline_keyboard: [main, ...(second.length ? [second] : []), [yBtn("✖️ Verwerfen", "c", jobId)]] },
  };
}

/** Freitext zu einem wartenden Entwurf: zuordnen lassen, Vorschlag als neue Karte schicken. */
export async function handleTastingText(jobId: string, draft: TastingDraft, chatId: number, text: string) {
  const db = createAdminClient();
  // Sofort auf „review“, damit weitere Nachrichten nicht doppelt hier landen.
  await saveDraft(db, jobId, { ...draft, step: "review" });
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

  after(async () => {
    try {
      const today = todayIso();
      const current = normalizeData(draft.sat, today);
      const extraction = await extractTasting(current, text.slice(0, 4000));
      const next: TastingDraft = {
        ...draft,
        step: "review",
        sat: applyExtraction(current, extraction),
        texts: [...draft.texts, text.slice(0, 4000)],
      };
      if (draft.cardMessageId) await clearKeyboard(chatId, draft.cardMessageId);
      const screen = await cardScreen(db, jobId, next);
      const message = await sendMessage(chatId, screen.text, screen.keyboard);
      await saveDraft(db, jobId, { ...next, cardMessageId: message.message_id });
    } catch (error) {
      console.error("tasting extraction failed", error);
      await saveDraft(db, jobId, { ...draft, step: "text" }).catch(() => undefined);
      await sendMessage(chatId, "❌ Das konnte ich nicht zuordnen. Schreib es bitte nochmals – oder tippe ✖️ Abbrechen.").catch(
        () => undefined,
      );
    }
  });
}

async function insertTasting(db: AdminClient, jobId: string, draft: TastingDraft) {
  // Nur ein Klick gewinnt: Status atomar von needs_review auf confirmed.
  const { data: claimed, error: claimError } = await db
    .from("ingest_jobs")
    .update({ status: "confirmed" })
    .eq("id", jobId)
    .eq("status", "needs_review")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return null;

  const { data: item, error: itemError } = await db
    .from("inventory_items")
    .select("id, wine_id, vintage_year")
    .eq("id", draft.itemId)
    .single();
  if (itemError) throw itemError;
  const row = tastingRow({ item, personId: draft.personId, sat: draft.sat, today: todayIso(), source: "bot" });
  const { data, error } = await db.from("wine_tastings").insert(row).select("id").single();
  if (error) {
    await db.from("ingest_jobs").update({ status: "needs_review" }).eq("id", jobId);
    throw error;
  }
  return { tastingId: data.id, row };
}

// ---------------------------------------------------------------------------
// Knöpfe unter Karte / Aufforderung

export async function handleTastingCallback(cb: TgCallbackQuery) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const parsed = decode(cb.data);
  if (chatId == null || messageId == null || !parsed) {
    await answerCallback(cb.id, "Dieser Knopf ist nicht mehr gültig.");
    return;
  }
  const db = createAdminClient();
  const job = await loadDraft(db, parsed.jobId, chatId);
  if (!job || job.status !== "needs_review") {
    await answerCallback(cb.id, job?.status === "confirmed" ? "Schon gespeichert." : "Dieser Entwurf ist abgeschlossen.");
    await clearKeyboard(chatId, messageId);
    return;
  }
  const { draft } = job;

  try {
    switch (parsed.action) {
      case "c": {
        await db.from("ingest_jobs").update({ status: "discarded" }).eq("id", job.id);
        await answerCallback(cb.id);
        await editMessage(chatId, messageId, `📝 ${e(draft.title)}: Verkostung verworfen.`);
        return;
      }
      case "f": {
        await saveDraft(db, job.id, { ...draft, step: "text", cardMessageId: messageId });
        await answerCallback(cb.id);
        const screen = await cardScreen(db, job.id, draft);
        await editMessage(
          chatId,
          messageId,
          `${screen.text}\n\n✏️ Schreib mir, was ergänzt oder korrigiert werden soll.`,
          { inline_keyboard: [[yBtn("✖️ Abbrechen", "c", job.id)]] },
        );
        return;
      }
      case "p": {
        const other = await nextPerson(db, draft.personId);
        const next = { ...draft, personId: other?.id ?? draft.personId };
        await saveDraft(db, job.id, next);
        await answerCallback(cb.id, other ? `Für ${other.name}` : undefined);
        const screen = await cardScreen(db, job.id, next);
        await editMessage(chatId, messageId, screen.text, screen.keyboard);
        return;
      }
      case "s":
      case "a": {
        const saved = await insertTasting(db, job.id, draft);
        if (!saved) {
          await answerCallback(cb.id, "Schon gespeichert.");
          return;
        }
        const name = await personName(db, draft.personId);
        const summary = draftSummary(normalizeData(draft.sat, todayIso()));
        const url = appUrl(`/flasche/${draft.itemId}/verkostung?t=${saved.tastingId}`);
        await answerCallback(cb.id, parsed.action === "a" ? "Gespeichert – jetzt in der App bearbeiten." : "Gespeichert.");
        await editMessage(
          chatId,
          messageId,
          `✅ Ich habe die Verkostung gespeichert: <b>${e(draft.title)}</b>${name ? ` · ${e(name)}` : ""}\n${e(summary.result)}`,
          { inline_keyboard: url ? [[{ text: "📱 In der App bearbeiten", url }]] : [] },
        );
        return;
      }
    }
  } catch (error) {
    console.error("tasting callback failed", cb.data, error);
    await answerCallback(cb.id, "Das hat nicht geklappt.");
  }
}
