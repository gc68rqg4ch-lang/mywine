import "server-only";

// „Verkostet“ im Bot: einen Wein irgendwo probiert (Restaurant, Bar, bei Freunden) – nicht
// im Bestand. Schneller Ablauf: Etikett bzw. Text lesen → Wein abgleichen (ohne Produzent nur
// über den Namen, bei mehreren Treffern wählen) → Jahrgang bestätigen → ⭐ der Person, die
// schreibt → gespeichert (alles oder nichts über das gemeinsame Modul). Danach freiwillig Ort,
// Preis, Anlass, Begleitung, Kaufen?, ⭐ der anderen Person, Notiz. Die Websuche ergänzt erst
// nach dem Speichern leere Angaben. Zustand in ingest_jobs (source telegram_tasted).

import { later } from "@/lib/later";
import { applyEdit } from "@/lib/edit/edit";
import { AMBIGUOUS_WINE, encounterPrice, matchWine, type WineCandidate } from "@/lib/edit/encounters";
import type { Edit } from "@/lib/edit/types";
import { formatDate, formatStarNumber, todayIso, wineName, wineTypeLabel } from "@/lib/format";
import { isValidRating } from "@/lib/ratings";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { answerCallback, clearKeyboard, editMessage, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { resolveActor } from "@/lib/telegram/actor";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgInlineButton, TgInlineKeyboard } from "@/lib/telegram/types";
import { wineHref } from "@/lib/cellar/wine-page";
import type { Json } from "@/lib/database.types";
import { parseVintageAnswer, type IngestState, type TastedText, type WineProposal } from "@/lib/ingest/schema";
import { parseTastedText, type RecognitionResult, enrichFromWeb } from "@/lib/ingest/recognize";
import { jobState, toJson, type IngestJob } from "@/lib/ingest/jobs";
import {
  continuePhotoPurchase,
  fillWineGaps,
  resolveGrapes,
  startTextIngest,
  storeDrinkWindow,
  storeGrapes,
  storeJobMedia,
} from "@/lib/ingest/flow";
import { RATING_STEPS } from "./menu-view";
import { TASTED_WINDOW_MS, announcesTasting, parseEncounterPrice } from "./tasted-text";
import { looksLikeNewConcern, strongNewConcern, supersede } from "./pending";

export const TASTED_SOURCE = "telegram_tasted";

export type TastedStep =
  /** „Wir verkosten einen Wein“: das nächste Foto bzw. die nächste Nachricht gilt als verkostet. */
  | "t_armed"
  /** Text ohne klaren Hinweis: gekauft oder nur verkostet? */
  | "t_intent"
  /** Text wird gelesen. */
  | "t_reading"
  /** Mehrere Weine heissen so: wählen oder neu anlegen. */
  | "t_match"
  | "t_vintage"
  | "t_rate"
  /** Text: Zusammenfassung mit Ja/Nein. */
  | "t_confirm"
  | "t_saving"
  /** Gespeichert; freiwillige Angaben per Knopf. */
  | "t_extras"
  /** Wartet auf Text für eine freiwillige Angabe (awaiting). */
  | "t_input"
  /** ⭐ für eine andere Person wählen. */
  | "t_other"
  | "t_done";

export type ExtraField = "place" | "price" | "occasion" | "companions" | "note";

export type TastedSet = {
  tastedOn?: string;
  place?: string | null;
  price?: number | null;
  priceUnit?: "bottle" | "glass" | null;
  currency?: "CHF" | "AED" | "EUR";
  occasion?: string | null;
  companions?: string | null;
  note?: string | null;
};

export type TastedState = {
  flow: "tasted";
  step: TastedStep;
  origin: "photo" | "text";
  proposal: WineProposal;
  /** Bestehender Wein (gewählt bzw. eindeutig gefunden); null = neu anlegen; undefined = noch offen. */
  wineId?: string | null;
  forceNew?: boolean;
  candidates?: WineCandidate[];
  vintageConfirmed?: boolean;
  personId: string | null;
  personName: string;
  /** Sterne der Person, die schreibt; null = ohne; undefined = noch nicht gefragt. */
  rating?: number | null;
  set: TastedSet;
  wantToBuy?: boolean;
  /** Text vor der Frage „gekauft oder verkostet?“. */
  pendingText?: string;
  /** Nach dem Speichern */
  encounterId?: string;
  savedWineId?: string;
  awaiting?: ExtraField;
  /** Letzte Orte als Knöpfe beim 📍 Ort. */
  placeOptions?: string[];
  otherPersonId?: string;
  imageSides?: ("front" | "back" | "other")[] | null;
};

const e = escapeHtml;
const stateOf = (job: Pick<IngestJob, "extracted">) => job.extracted as unknown as TastedState | null;
const asJson = (state: TastedState) => state as unknown as Json;

// ---------------------------------------------------------------------------
// Ablauf (rein, exportiert für Tests)

/** Nächster Schritt des Schnellablaufs: Wein klären → Jahrgang → ⭐ → speichern (Text: erst Zusammenfassung). */
export function nextTastedStep(s: Pick<TastedState, "wineId" | "forceNew" | "vintageConfirmed" | "rating" | "origin">): TastedStep {
  if (s.wineId === undefined && !s.forceNew) return "t_match";
  if (!s.vintageConfirmed) return "t_vintage";
  if (s.rating === undefined) return "t_rate";
  return s.origin === "text" ? "t_confirm" : "t_saving";
}

/** Die Bearbeitung „Verkostet erfassen“ für das gemeinsame Modul. */
export function tastedEdit(s: TastedState): Extract<Edit, { kind: "addEncounter" }> {
  const p = s.proposal;
  return {
    kind: "addEncounter",
    wine: s.wineId
      ? { wineId: s.wineId }
      : { new: { name: p.name ?? "", producer: p.producer, type: p.type, country: p.country, region: p.region, ...(s.forceNew ? { forceNew: true } : {}) } },
    year: p.vintage_year,
    set: {
      ...(s.set.tastedOn ? { tastedOn: s.set.tastedOn } : {}),
      ...(s.set.place ? { place: { name: s.set.place, kind: null, city: null } } : {}),
      ...(s.set.price != null ? { price: s.set.price, priceUnit: s.set.priceUnit ?? "bottle", currency: s.set.currency ?? "CHF" } : {}),
      ...(s.set.occasion ? { occasion: s.set.occasion } : {}),
      ...(s.set.companions ? { companions: s.set.companions } : {}),
      ...(s.set.note ? { note: s.set.note } : {}),
    },
    personId: s.personId,
    source: "bot",
    wantToBuy: s.wantToBuy ?? false,
    ratings: s.rating != null && s.personId ? [{ personId: s.personId, rating: s.rating }] : [],
  };
}

const wineLabel = (s: Pick<TastedState, "proposal">) =>
  e([s.proposal.producer, s.proposal.name].filter(Boolean).join(" – ") || "Unbekannter Wein");
const yearLabel = (year: number | null) => (year == null ? "ohne Jahrgang (NV)" : String(year));

/** Zeile mit den Angaben des Eintrags: „📍 Kronenhalle · 💰 CHF 120.00 / Flasche · 👥 Sara“. */
export function tastedDetailLine(s: Pick<TastedState, "set" | "wantToBuy">) {
  const price = s.set.price != null ? encounterPrice({ price: s.set.price, price_unit: s.set.priceUnit ?? "bottle", currency: s.set.currency ?? "CHF" }) : null;
  return [
    s.set.place && `📍 ${s.set.place}`,
    price && `💰 ${price}`,
    s.set.occasion && `🎉 ${s.set.occasion}`,
    s.set.companions && `👥 ${s.set.companions}`,
    s.set.note && `📝 ${s.set.note}`,
    s.wantToBuy && "🛒 Kaufen? vorgemerkt",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Zusammenfassung vor dem Speichern (Text). */
export function tastedSummary(s: TastedState, wineNote: string | null) {
  return [
    "📝 <b>Verkostet – Zusammenfassung</b>",
    `🍷 <b>${wineLabel(s)}</b> ${yearLabel(s.proposal.vintage_year)}${s.proposal.type ? ` · ${e(wineTypeLabel(s.proposal.type))}` : ""}`,
    wineNote ? `<i>${e(wineNote)}</i>` : null,
    `📅 ${formatDate(s.set.tastedOn ?? todayIso())}`,
    `⭐ ${e(s.personName)}: ${s.rating != null ? `${formatStarNumber(s.rating)} ★` : "ohne Bewertung"}`,
    e(tastedDetailLine(s)) || null,
    "",
    "Soll ich das so speichern?",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Knöpfe: „vk:<jobId>:<aktion>[:<wert>]“ (unter 64 Bytes)

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CALLBACK_RE = new RegExp(`^vk:(${UUID}):([a-z]+)(?::([0-9a-z.-]+))?(?::([0-9a-z.-]+))?$`);

export function tastedData(jobId: string, action: string, ...values: (string | number)[]) {
  return ["vk", jobId, action, ...values.map(String)].join(":");
}

export function isTastedCallback(data: string | undefined) {
  return /^vk:/.test(data ?? "");
}

export function parseTastedData(data: string | undefined) {
  const m = (data ?? "").match(CALLBACK_RE);
  return m ? { jobId: m[1], action: m[2], value: m[3] ?? null, value2: m[4] ?? null } : null;
}

const button = (text: string, jobId: string, action: string, ...values: (string | number)[]): TgInlineButton => ({
  text,
  callback_data: tastedData(jobId, action, ...values),
});

/** Nur „✖️ Abbrechen“ (drop = verwerfen; back = nach dem Speichern zurück zu den Knöpfen). */
const cancelKeyboard = (jobId: string, action: "drop" | "back"): TgInlineKeyboard => ({
  inline_keyboard: [[button("✖️ Abbrechen", jobId, action)]],
});

export function intentKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [[button("🛒 Gekauft", jobId, "buy"), button("🍷 Nur verkostet", jobId, "tas")], [button("✖️ Abbrechen", jobId, "drop")]],
  };
}

function ratingButtons(jobId: string, action: string, extra: (string | number)[] = []) {
  const stars = RATING_STEPS.map((r) => button(`${formatStarNumber(r)} ★`, jobId, action, ...extra, Math.round(r * 2)));
  return [stars.slice(0, 5), stars.slice(5)];
}

export function extrasKeyboard(jobId: string, s: TastedState, others: { id: string; name: string }[]): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [button("📍 Ort", jobId, "x", "place"), button("💰 Preis", jobId, "x", "price")],
      [button("🎉 Anlass", jobId, "x", "occasion"), button("👥 Begleitung", jobId, "x", "companions")],
      [button(s.wantToBuy ? "🛒 Kaufen? ✓" : "🛒 Kaufen?", jobId, "buyflag"), button("📝 Notiz", jobId, "x", "note")],
      ...(others.length ? [others.map((p) => button(`⭐ für ${p.name}`, jobId, "other", p.id.slice(0, 8)))] : []),
      [button("✅ Fertig", jobId, "done")],
    ],
  };
}

const EXTRA_QUESTIONS: Record<ExtraField, string> = {
  place: "📍 Wo war das? (Restaurant, Bar, Weingut oder bei wem)",
  price: "💰 Was hat er gekostet? Z. B. <i>120</i>, <i>14 Glas</i>, <i>90 EUR</i> oder <i>65 AED Glas</i>.",
  occasion: "🎉 Welcher Anlass?",
  companions: "👥 Mit wem?",
  note: "📝 Deine Notiz zum Wein?",
};

// ---------------------------------------------------------------------------
// Laden und Weiterschalten

async function createTastedJob(db: AdminClient, chatId: number, state: TastedState, photoPaths: string[] = [], status: "needs_review" | "processing" = "needs_review") {
  const { data, error } = await db
    .from("ingest_jobs")
    .insert({ source: TASTED_SOURCE, telegram_chat_id: chatId, status, extracted: asJson(state), photo_paths: photoPaths })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Atomar weiterschalten: nur wenn der Eintrag noch im erwarteten Schritt ist (Doppelklicks). */
async function advance(db: AdminClient, job: IngestJob, from: TastedStep | TastedStep[], patch: Partial<TastedState>, status?: "confirmed" | "failed" | "discarded") {
  const current = stateOf(job);
  if (!current) return null;
  const allowed = Array.isArray(from) ? from : [from];
  if (!allowed.includes(current.step)) return null;
  const next: TastedState = { ...current, ...patch };
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ extracted: asJson(next), ...(status ? { status } : {}) })
    .eq("id", job.id)
    .eq("status", "needs_review")
    .eq("extracted->>step", current.step)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function personFor(db: AdminClient, chatId: number) {
  const actor = await resolveActor(db, chatId).catch(() => null);
  return { personId: actor?.personId ?? null, personName: actor?.name ?? "du" };
}

async function otherPersons(db: AdminClient, personId: string | null) {
  const { data } = await db.from("persons").select("id, name").order("sort_order");
  return (data ?? []).filter((p) => p.id !== personId);
}

/** Wein abgleichen (wie in der App): mit Produzent Name + Produzent, sonst nur der Name. */
async function matchPatch(db: AdminClient, p: WineProposal): Promise<Partial<TastedState>> {
  if (!p.name) return { wineId: null };
  const match = await matchWine(db, p.name, p.producer);
  if ("ambiguous" in match) return { candidates: match.candidates };
  if (!match.known) return { wineId: null };
  return {
    wineId: match.known.id,
    // Bekannter Wein: dessen Angaben gelten (z. B. Produzent für die Anzeige).
    proposal: { ...p, producer: p.producer ?? match.known.producer, type: p.type ?? (match.known.type as WineProposal["type"]) },
  };
}

/** Den Schritt fragen, in dem der Eintrag steht (bzw. speichern). */
async function ask(db: AdminClient, job: IngestJob, chatId: number) {
  const s = stateOf(job)!;
  switch (s.step) {
    case "t_match": {
      const rows = (s.candidates ?? []).slice(0, 8).map((c, i) => [
        button(`${wineName(c)}${c.country ? ` · ${c.country}` : ""}`, job.id, "pick", i),
      ]);
      await sendMessage(chatId, `🍷 Es gibt mehrere Weine „${e(s.proposal.name ?? "")}“. Welcher ist es?`, {
        inline_keyboard: [...rows, [button(`➕ Neuer Wein „${s.proposal.name ?? ""}“`, job.id, "new")], [button("✖️ Abbrechen", job.id, "drop")]],
      });
      return;
    }
    case "t_vintage": {
      const year = s.proposal.vintage_year;
      await sendMessage(
        chatId,
        year != null
          ? `🍷 <b>${wineLabel(s)}</b>\n📅 Jahrgang <b>${year}</b> – stimmt das? Sonst schreib mir die Jahreszahl.`
          : `🍷 <b>${wineLabel(s)}</b>\n📅 Welcher Jahrgang? Schreib mir die Jahreszahl – oder tippe „Ohne Jahrgang (NV)“.`,
        {
          inline_keyboard: [
            [...(year != null ? [button(`✅ ${year} stimmt`, job.id, "vint", year)] : []), button("Ohne Jahrgang (NV)", job.id, "vint", "nv")],
            [button("✖️ Abbrechen", job.id, "drop")],
          ],
        },
      );
      return;
    }
    case "t_rate":
      await sendMessage(chatId, `⭐ Wie viele Sterne gibst du dem ${wineLabel(s)} ${yearLabel(s.proposal.vintage_year)}, ${e(s.personName)}?`, {
        inline_keyboard: [...ratingButtons(job.id, "rate"), [button("Ohne Bewertung", job.id, "rate", "n"), button("✖️ Abbrechen", job.id, "drop")]],
      });
      return;
    case "t_confirm":
      await sendMessage(chatId, tastedSummary(s, s.wineId ? "Diesen Wein kenne ich schon – ich hänge den Eintrag dort an." : "Neuer Wein – ich lege ihn an."), {
        inline_keyboard: [[button("✅ Ja, speichern", job.id, "ok"), button("✖️ Nein", job.id, "drop")]],
      });
      return;
    case "t_saving":
      await saveTasted(db, job, chatId);
      return;
  }
}

/** Patch übernehmen, nächsten Schritt bestimmen und fragen. */
async function step(db: AdminClient, job: IngestJob, chatId: number, from: TastedStep | TastedStep[], patch: Partial<TastedState>) {
  const merged = { ...stateOf(job)!, ...patch };
  const next = await advance(db, job, from, { ...patch, step: nextTastedStep(merged) });
  if (next) await ask(db, next, chatId);
  return next;
}

// ---------------------------------------------------------------------------
// Start

/** Angaben aus Text bzw. Bildtext: Was dort steht, wird nicht nochmals gefragt (z. B. die Sterne). */
export function fromTasting(t: TastedText["tasting"]): Pick<TastedState, "set" | "wantToBuy"> & { rating?: number } {
  return {
    set: {
      ...(/^\d{4}-\d{2}-\d{2}$/.test(t.tasted_on) && t.tasted_on <= todayIso() ? { tastedOn: t.tasted_on } : {}),
      ...(t.place.trim() ? { place: t.place.trim().slice(0, 120) } : {}),
      ...(t.price > 0 ? { price: Math.round(t.price * 100) / 100, priceUnit: t.price_unit || "bottle", currency: t.currency || "CHF" } : {}),
      ...(t.occasion.trim() ? { occasion: t.occasion.trim() } : {}),
      ...(t.companions.trim() ? { companions: t.companions.trim() } : {}),
      ...(t.note.trim() ? { note: t.note.trim() } : {}),
    },
    ...(t.rating >= 0 && isValidRating(t.rating) ? { rating: t.rating } : {}),
    wantToBuy: t.want_to_buy,
  };
}

/** Foto(s) als „verkostet“: Erkennung übernehmen, abgleichen, dann der Schnellablauf. */
export async function startTastedFromPhoto(
  db: AdminClient,
  photoJobId: string,
  chatId: number,
  recognition: RecognitionResult,
  caption?: string | null,
) {
  const { data: photoJob } = await db.from("ingest_jobs").select("photo_paths").eq("id", photoJobId).maybeSingle();
  // Der Foto-Eintrag ist damit erledigt; weiter geht es als „verkostet“ (eigener Eintrag).
  await db.from("ingest_jobs").update({ status: "confirmed", extracted: toJson({ step: "done", intent: "tasted" } as unknown as IngestState) }).eq("id", photoJobId);

  // Bildtext lesen („Vier von fünf Sternen“, „im Kronenhalle“ …): was dort steht, frage ich nicht.
  const fromCaption = caption?.trim() ? await parseTastedText(caption.trim().slice(0, 1000), todayIso()).catch((error) => {
    console.error("caption parse failed", error);
    return null;
  }) : null;
  const proposal: WineProposal = {
    ...recognition.proposal,
    name: recognition.proposal.name ?? fromCaption?.proposal.name ?? null,
    producer: recognition.proposal.producer ?? fromCaption?.proposal.producer ?? null,
    // Jahrgang im Bildtext genannt: gilt; sonst der vom Etikett – der wird bestätigt.
    vintage_year: fromCaption?.proposal.vintage_year ?? recognition.proposal.vintage_year,
  };
  if (!proposal.name) {
    await sendMessage(chatId, "Ich konnte den Namen auf dem Etikett nicht lesen. Schreib mir den Wein bitte, z. B. <i>Pintia 2019 probiert, 4 Sterne</i>.");
    return;
  }
  const person = await personFor(db, chatId);
  const base: TastedState = {
    flow: "tasted",
    step: "t_reading",
    origin: "photo",
    proposal,
    ...person,
    set: {},
    imageSides: recognition.imageSides,
    ...(fromCaption ? fromTasting(fromCaption.tasting) : {}),
    ...(fromCaption?.proposal.vintage_year != null ? { vintageConfirmed: true } : {}),
  };
  const matched = { ...base, ...(await matchPatch(db, proposal)) };
  const job = await createTastedJob(db, chatId, { ...matched, step: nextTastedStep(matched) }, photoJob?.photo_paths ?? []);
  await ask(db, job, chatId);
}

/** Foto ohne klaren Hinweis: erst fragen – gekauft oder nur verkostet? */
export async function askPhotoIntent(db: AdminClient, jobId: string, chatId: number, recognition: RecognitionResult, caption?: string | null) {
  const state = {
    step: "intent",
    ...(caption ? { caption } : {}),
    proposal: recognition.proposal,
    pending_recognition: recognition,
    recognition: { model: recognition.model, confidence: recognition.confidence, notes: recognition.notes, enriched_fields: [], sources: [] },
  } as IngestState;
  const { error } = await db.from("ingest_jobs").update({ status: "needs_review", extracted: toJson(state) }).eq("id", jobId);
  if (error) throw error;
  const p = recognition.proposal;
  const name = [p.producer, p.name].filter(Boolean).join(" – ") || "diesen Wein";
  await sendMessage(
    chatId,
    `🍷 <b>${e(name)}</b>${p.vintage_year != null ? ` ${p.vintage_year}` : ""}\nHast du ihn gekauft (Bestand) oder nur verkostet?`,
    intentKeyboard(jobId),
  );
}

/** Text ohne klaren Hinweis: erst fragen – gekauft oder nur verkostet? */
export async function askTextIntent(db: AdminClient, chatId: number, text: string) {
  const person = await personFor(db, chatId);
  const job = await createTastedJob(db, chatId, {
    flow: "tasted",
    step: "t_intent",
    origin: "text",
    proposal: emptyProposal(),
    ...person,
    set: {},
    pendingText: text.slice(0, 2000),
  });
  await sendMessage(chatId, "Hast du den Wein gekauft (Bestand) oder nur verkostet?", intentKeyboard(job.id));
}

const emptyProposal = (): WineProposal => ({
  name: null,
  producer: null,
  vintage_year: null,
  country: null,
  region: null,
  appellation: null,
  type: null,
  grape_shares: [],
  alcohol_content: null,
  bottle_size_ml: null,
});

/** Freitext als „verkostet“ (Erkennung läuft nach der Antwort). jobId: wartender Eintrag (Frage/Ankündigung). */
export async function startTastedText(chatId: number, text: string, jobId?: string) {
  const db = createAdminClient();
  const person = await personFor(db, chatId);
  const state: TastedState = { flow: "tasted", step: "t_reading", origin: "text", proposal: emptyProposal(), ...person, set: {} };
  let id = jobId;
  if (id) {
    const { data } = await db
      .from("ingest_jobs")
      .update({ status: "processing", extracted: asJson(state) })
      .eq("id", id)
      .eq("status", "needs_review")
      .select("id");
    if (!data?.length) return;
  } else {
    id = (await createTastedJob(db, chatId, state, [], "processing")).id;
  }
  await sendMessage(chatId, "🍷 Ich erfasse den Wein als verkostet …");
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
  const final = id;
  later(() => processTastedText(final, chatId, text.slice(0, 2000)));
}

/** Text lesen, abgleichen und nur Fehlendes fragen (läuft per after(); exportiert für Tests). */
export async function processTastedText(jobId: string, chatId: number, text: string) {
  const db = createAdminClient();
  try {
    const { proposal, tasting: t } = await parseTastedText(text, todayIso());
    if (!proposal.name) {
      await db.from("ingest_jobs").update({ status: "discarded", error: "kein Wein erkannt" }).eq("id", jobId);
      await sendMessage(chatId, "Ich konnte darin keinen Wein erkennen. Schreib z. B. <i>„Heute im Kronenhalle den Pintia 2019 probiert, 4,5 Sterne“</i>.");
      return;
    }
    const { data: job } = await db.from("ingest_jobs").select("*").eq("id", jobId).single();
    const current = stateOf(job!)!;
    const base: TastedState = {
      ...current,
      proposal,
      // Im Text genannter Jahrgang gilt als bestätigt; sonst nachfragen.
      vintageConfirmed: proposal.vintage_year != null,
      ...fromTasting(t),
    };
    const matched = { ...base, ...(await matchPatch(db, proposal)) };
    const next: TastedState = { ...matched, step: nextTastedStep(matched) };
    const { data: updated, error } = await db
      .from("ingest_jobs")
      .update({ status: "needs_review", extracted: asJson(next) })
      .eq("id", jobId)
      .select("*")
      .single();
    if (error) throw error;
    await ask(db, updated, chatId);
  } catch (error) {
    console.error("tasted text failed", error);
    await db.from("ingest_jobs").update({ status: "failed", error: String(error).slice(0, 500) }).eq("id", jobId);
    await sendMessage(chatId, "❌ Das konnte ich nicht erfassen – ich habe nichts gespeichert. Schreib es mir bitte nochmals.").catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// „Wir verkosten einen Wein“

/** Ankündigung erkannt → für 30 Min. gilt das nächste Foto bzw. die nächste Nachricht als verkostet. */
export async function maybeArmTasting(db: AdminClient, chatId: number, text: string) {
  if (!announcesTasting(text)) return false;
  // Neues Anliegen: angefangene Rückfragen verwerfen.
  await supersede(db, chatId, "text");
  await disarm(db, chatId);
  const person = await personFor(db, chatId);
  await createTastedJob(db, chatId, { flow: "tasted", step: "t_armed", origin: "text", proposal: emptyProposal(), ...person, set: {} });
  await sendMessage(chatId, "🍷 Gerne! Schick mir ein Foto vom Etikett oder schreib mir den Wein – ich erfasse ihn als verkostet (nicht im Bestand).");
  return true;
}

async function disarm(db: AdminClient, chatId: number) {
  await db
    .from("ingest_jobs")
    .update({ status: "discarded" })
    .eq("source", TASTED_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "t_armed");
}

/** Wartet eine Ankündigung (innert 30 Min.)? Dann wird sie für dieses Foto verbraucht. */
export async function armedForTasting(db: AdminClient, chatId: number) {
  const since = new Date(Date.now() - TASTED_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("ingest_jobs")
    .update({ status: "confirmed" })
    .eq("source", TASTED_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .eq("extracted->>step", "t_armed")
    .gte("updated_at", since)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Jüngster Verkostet-Eintrag, der auf eine Textantwort wartet (älter als 30 Min. verfällt). */
export async function findTastedAwaitingText(db: AdminClient, chatId: number) {
  const { data, error } = await db
    .from("ingest_jobs")
    .select("*")
    .eq("source", TASTED_SOURCE)
    .eq("telegram_chat_id", chatId)
    .eq("status", "needs_review")
    .in("extracted->>step", ["t_armed", "t_vintage", "t_rate", "t_input"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (Date.parse(data.updated_at) < Date.now() - TASTED_WINDOW_MS) {
    await db.from("ingest_jobs").update({ status: "discarded" }).eq("id", data.id);
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Textantworten

/** Sterne als Antwort: „4“, „4,5“, „4.5 Sterne“. */
export function parseRatingAnswer(text: string) {
  const rating = Number(text.trim().replace(",", ".").replace(/\s*(sterne?|★)$/i, ""));
  return text.trim() !== "" && isValidRating(rating) ? rating : null;
}

/**
 * Passt der Text als Antwort auf die offene Rückfrage? „new“ = sieht nach einem neuen Anliegen
 * aus (der Ablauf wird verworfen), sonst Antwort bzw. erneute Rückfrage.
 */
export function tastedAnswerFit(job: Pick<IngestJob, "extracted">, text: string): "answer" | "new" {
  const s = stateOf(job);
  switch (s?.step) {
    case "t_vintage":
      return parseVintageAnswer(text) !== undefined ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
    case "t_rate":
      return parseRatingAnswer(text) != null ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
    case "t_input":
      if (s.awaiting === "note") return "answer";
      if (s.awaiting === "price") return !strongNewConcern(text) && parseEncounterPrice(text) ? "answer" : looksLikeNewConcern(text) ? "new" : "answer";
      return strongNewConcern(text) ? "new" : "answer";
    default:
      return "answer";
  }
}

export async function handleTastedText(db: AdminClient, job: IngestJob, chatId: number, text: string) {
  const s = stateOf(job)!;
  switch (s.step) {
    case "t_armed":
      await startTastedText(chatId, text, job.id);
      return;
    case "t_vintage": {
      const year = parseVintageAnswer(text);
      if (year === undefined) {
        await sendMessage(chatId, "Schreib mir bitte nur die Jahreszahl (z. B. <i>2019</i>) – oder tippe „Ohne Jahrgang (NV)“.", cancelKeyboard(job.id, "drop"));
        return;
      }
      await step(db, job, chatId, "t_vintage", { proposal: { ...s.proposal, vintage_year: year }, vintageConfirmed: true });
      return;
    }
    case "t_rate": {
      const rating = parseRatingAnswer(text);
      if (rating == null) {
        await sendMessage(chatId, "Tippe bitte die Sterne an oder schreib eine Zahl von 0 bis 5 (halbe Schritte, z. B. <i>4,5</i>).", cancelKeyboard(job.id, "drop"));
        return;
      }
      await step(db, job, chatId, "t_rate", { rating });
      return;
    }
    case "t_input": {
      const field = s.awaiting!;
      const value = text.replace(/\s+/g, " ").trim();
      let set: TastedSet;
      if (field === "price") {
        const price = parseEncounterPrice(value);
        if (!price) {
          await sendMessage(chatId, EXTRA_QUESTIONS.price, cancelKeyboard(job.id, "back"));
          return;
        }
        set = { price: price.price, priceUnit: price.unit, currency: price.currency };
      } else {
        if (!value || value.length > (field === "place" ? 120 : 500)) {
          await sendMessage(chatId, EXTRA_QUESTIONS[field], cancelKeyboard(job.id, "back"));
          return;
        }
        set = { [field]: value };
      }
      await saveExtra(db, job, chatId, "t_input", set);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Speichern und freiwillige Angaben

async function saveTasted(db: AdminClient, job: IngestJob, chatId: number) {
  const s = stateOf(job)!;
  const result = await applyEdit(db, tastedEdit(s));
  if (!result.ok) {
    // Inzwischen gibt es mehrere Weine mit dem Namen: wählen lassen.
    if (result.error === AMBIGUOUS_WINE && s.proposal.name) {
      const match = await matchWine(db, s.proposal.name, s.proposal.producer);
      if ("ambiguous" in match) {
        const next = await advance(db, job, "t_saving", { step: "t_match", wineId: undefined, candidates: match.candidates });
        if (next) await ask(db, next, chatId);
        return;
      }
    }
    await advance(db, job, "t_saving", { step: "t_done" }, "failed");
    await sendMessage(chatId, `⚠️ ${e(result.error)} Ich habe nichts gespeichert.`);
    return;
  }
  const wineId = result.wineId!;
  const { data: encounter } = await db
    .from("wine_encounters")
    .select("id")
    .eq("wine_id", wineId)
    .eq("source", "bot")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = await advance(db, job, "t_saving", { step: "t_extras", savedWineId: wineId, encounterId: encounter?.id }, undefined);
  await db.from("ingest_jobs").update({ matched_wine_id: wineId }).eq("id", job.id);
  const state = next ? stateOf(next)! : { ...s, savedWineId: wineId };
  const others = await otherPersons(db, s.personId);
  await sendMessage(chatId, savedText(state, true), extrasKeyboard(job.id, state, others));

  // Erst gespeichert, dann ergänzt: Websuche füllt leere Angaben des Weins (blockiert nichts).
  const isNew = !s.wineId;
  later(() => completeAfterSave(job.id, wineId, s, isNew, job.photo_paths));
}

function savedText(s: TastedState, first: boolean) {
  const stars = s.rating != null ? ` mit ⭐ ${formatStarNumber(s.rating)}` : "";
  const detail = tastedDetailLine(s);
  return [
    first
      ? `✅ Ich habe <b>${wineLabel(s)}</b> ${yearLabel(s.proposal.vintage_year)} als verkostet gespeichert${stars}.`
      : `🍷 <b>${wineLabel(s)}</b> ${yearLabel(s.proposal.vintage_year)}${stars}`,
    detail && e(detail),
    first ? "Möchtest du noch etwas ergänzen?" : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Websuche (leere Felder, Rebsorten, Trinkfenster) und Etikett-Fotos – nach dem Speichern. */
async function completeAfterSave(jobId: string, wineId: string, s: TastedState, isNew: boolean, photoPaths: string[]) {
  const db = createAdminClient();
  try {
    if (photoPaths.length && isNew) {
      await storeJobMedia(db, photoPaths, { proposal: s.proposal, recognition: { model: "", confidence: 1, notes: null, enriched_fields: [], sources: [], ...(s.imageSides ? { image_sides: s.imageSides } : {}) } }, { wineId, itemId: null });
    }
    const web = await enrichFromWeb(s.proposal).catch((error) => {
      console.error("tasted enrichment failed", error);
      return null;
    });
    if (!web) return;
    await fillWineGaps(db, wineId, web.proposal);
    const grapes = await resolveGrapes(db, web.proposal, wineId, web.grapes);
    const state = { proposal: { ...web.proposal, grape_shares: grapes.shares }, grape_source: grapes.source, drink_from_year: web.drink.from, drink_until_year: web.drink.until } as IngestState;
    await storeGrapes(db, wineId, state);
    await storeDrinkWindow(db, wineId, state);
  } catch (error) {
    console.error("tasted completion failed", jobId, error);
  }
}

const RECENT_PLACES = 6;

/** Die zuletzt verwendeten Orte (aus Verkostet-Einträgen), ohne Doppelte. */
async function recentPlaces(db: AdminClient) {
  const { data } = await db
    .from("wine_encounters")
    .select("tasted_on, place:places(name)")
    .order("tasted_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const names = (data ?? []).map((e) => e.place?.name).filter((n): n is string => Boolean(n));
  return [...new Set(names)].slice(0, RECENT_PLACES);
}

/** Freiwillige Angabe speichern (bestehender Eintrag über das gemeinsame Modul), zurück zu den Knöpfen. */
async function saveExtra(db: AdminClient, job: IngestJob, chatId: number, from: TastedStep, set: TastedSet) {
  const s = stateOf(job)!;
  if (!s.encounterId) return;
  const edit: Edit = {
    kind: "encounter",
    encounterId: s.encounterId,
    set: {
      ...(set.place !== undefined ? { place: set.place ? { name: set.place, kind: null, city: null } : null } : {}),
      ...(set.price !== undefined ? { price: set.price, priceUnit: set.priceUnit ?? "bottle", currency: set.currency ?? "CHF" } : {}),
      ...(set.occasion !== undefined ? { occasion: set.occasion } : {}),
      ...(set.companions !== undefined ? { companions: set.companions } : {}),
      ...(set.note !== undefined ? { note: set.note } : {}),
    },
  };
  const result = await applyEdit(db, edit);
  if (!result.ok) {
    await sendMessage(chatId, `⚠️ ${e(result.error)}`);
    return;
  }
  const next = await advance(db, job, from, { step: "t_extras", awaiting: undefined, placeOptions: undefined, set: { ...s.set, ...set } });
  if (!next) return;
  const state = stateOf(next)!;
  await sendMessage(chatId, savedText(state, false), extrasKeyboard(job.id, state, await otherPersons(db, s.personId)));
}

// ---------------------------------------------------------------------------
// Knöpfe

export async function handleTastedCallback(cb: TgCallbackQuery) {
  const parsed = parseTastedData(cb.data);
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (!parsed || chatId == null || messageId == null) {
    await answerCallback(cb.id);
    return;
  }
  const db = createAdminClient();
  const { data: job } = await db.from("ingest_jobs").select("*").eq("id", parsed.jobId).eq("telegram_chat_id", chatId).maybeSingle();
  if (!job || job.status !== "needs_review") {
    await answerCallback(cb.id, "Diesen Eintrag habe ich schon abgeschlossen.");
    await clearKeyboard(chatId, messageId).catch(() => undefined);
    return;
  }

  // Foto ohne Hinweis (Kauf-Eintrag im Schritt „intent“): gekauft oder verkostet?
  const purchase = jobState(job);
  if (job.source !== TASTED_SOURCE) {
    if (purchase?.step !== "intent" || !purchase.pending_recognition || !["buy", "tas", "drop"].includes(parsed.action)) {
      await answerCallback(cb.id);
      return;
    }
    if (parsed.action === "drop") {
      const { data: dropped } = await db
        .from("ingest_jobs")
        .update({ status: "discarded", extracted: toJson({ ...purchase, step: "done" }) })
        .eq("id", job.id)
        .eq("extracted->>step", "intent")
        .select("id");
      await answerCallback(cb.id, dropped?.length ? "Abgebrochen" : undefined);
      await clearKeyboard(chatId, messageId).catch(() => undefined);
      if (dropped?.length) await sendMessage(chatId, "✖️ Abgebrochen – ich habe nichts gespeichert.");
      return;
    }
    const { data: claimed } = await db
      .from("ingest_jobs")
      .update({ extracted: toJson({ ...purchase, step: "researching", intent: parsed.action === "buy" ? "bought" : "tasted" }) })
      .eq("id", job.id)
      .eq("extracted->>step", "intent")
      .select("id");
    await answerCallback(cb.id);
    if (!claimed?.length) return;
    await clearKeyboard(chatId, messageId).catch(() => undefined);
    const recognition = { ...purchase.pending_recognition, imageSides: purchase.pending_recognition.imageSides ?? null };
    if (parsed.action === "buy") {
      await sendMessage(chatId, "🛒 Gekauft – ich ergänze die Angaben …");
      later(() => continuePhotoPurchase(createAdminClient(), job.id, chatId, recognition));
    } else {
      await startTastedFromPhoto(db, job.id, chatId, recognition, purchase.caption);
    }
    return;
  }

  const s = stateOf(job)!;
  const done = async (toast?: string) => {
    await answerCallback(cb.id, toast);
    await clearKeyboard(chatId, messageId).catch(() => undefined);
  };
  switch (parsed.action) {
    case "buy":
    case "tas": {
      if (s.step !== "t_intent" || !s.pendingText) return answerCallback(cb.id);
      await done();
      if (parsed.action === "tas") {
        await startTastedText(chatId, s.pendingText, job.id);
      } else {
        await advance(db, job, "t_intent", { step: "t_done" }, "discarded");
        await startTextIngest(chatId, s.pendingText);
      }
      return;
    }
    case "drop": {
      const next = await advance(db, job, ["t_match", "t_vintage", "t_rate", "t_confirm", "t_intent"], { step: "t_done" }, "discarded");
      await done(next ? "Abgebrochen" : undefined);
      if (next) await sendMessage(chatId, "✖️ Abgebrochen – ich habe nichts gespeichert.");
      return;
    }
    case "pick": {
      const c = s.candidates?.[Number(parsed.value)];
      if (!c) return answerCallback(cb.id);
      await done();
      await step(db, job, chatId, "t_match", {
        wineId: c.id,
        candidates: undefined,
        proposal: { ...s.proposal, producer: c.producer, type: s.proposal.type ?? (c.type as WineProposal["type"]) },
      });
      return;
    }
    case "new":
      await done();
      await step(db, job, chatId, "t_match", { wineId: null, forceNew: true, candidates: undefined });
      return;
    case "vint": {
      const year = parsed.value === "nv" ? null : Number(parsed.value);
      if (year !== null && !(Number.isInteger(year) && year >= 1800 && year <= 2100)) return answerCallback(cb.id);
      await done();
      await step(db, job, chatId, "t_vintage", { proposal: { ...s.proposal, vintage_year: year }, vintageConfirmed: true });
      return;
    }
    case "rate": {
      const rating = parsed.value === "n" ? null : Number(parsed.value) / 2;
      if (rating != null && !isValidRating(rating)) return answerCallback(cb.id);
      await done();
      await step(db, job, chatId, "t_rate", { rating });
      return;
    }
    case "ok": {
      const next = await advance(db, job, "t_confirm", { step: "t_saving" });
      await done(next ? "Ich speichere …" : undefined);
      if (next) await saveTasted(db, next, chatId);
      return;
    }
    case "x": {
      const field = parsed.value as ExtraField;
      if (!(field in EXTRA_QUESTIONS)) return answerCallback(cb.id);
      // Ort: die letzten Orte zur Auswahl („im Restaurant“ ohne Namen).
      const places = field === "place" ? await recentPlaces(db) : [];
      const next = await advance(db, job, ["t_extras", "t_input", "t_other"], { step: "t_input", awaiting: field, placeOptions: places });
      await done();
      if (next) {
        await sendMessage(chatId, places.length ? `${EXTRA_QUESTIONS.place} Tippe einen der letzten Orte an oder schreib den Namen.` : EXTRA_QUESTIONS[field], {
          inline_keyboard: [
            ...places.map((name, i) => [button(`📍 ${name}`, job.id, "plc", i)]),
            [button("✖️ Abbrechen", job.id, "back")],
          ],
        });
      }
      return;
    }
    case "plc": {
      const name = s.placeOptions?.[Number(parsed.value)];
      if (s.step !== "t_input" || s.awaiting !== "place" || !name) return answerCallback(cb.id);
      await done();
      await saveExtra(db, job, chatId, "t_input", { place: name });
      return;
    }
    case "buyflag": {
      if (!s.savedWineId || !["t_extras", "t_input", "t_other"].includes(s.step)) return answerCallback(cb.id);
      const value = !s.wantToBuy;
      const result = await applyEdit(db, { kind: "wantToBuy", wineId: s.savedWineId, value });
      if (!result.ok && result.error) {
        await answerCallback(cb.id, result.error.slice(0, 180));
        return;
      }
      const next = await advance(db, job, ["t_extras", "t_input", "t_other"], { step: "t_extras", awaiting: undefined, wantToBuy: value });
      await answerCallback(cb.id, value ? "🛒 Vorgemerkt" : "Merker entfernt");
      if (next) {
        const state = stateOf(next)!;
        await editMessage(chatId, messageId, savedText(state, false), extrasKeyboard(job.id, state, await otherPersons(db, s.personId))).catch(() => undefined);
      }
      return;
    }
    case "other": {
      const persons = await otherPersons(db, s.personId);
      const person = persons.find((p) => p.id.startsWith(parsed.value ?? "-"));
      if (!person) return answerCallback(cb.id);
      const next = await advance(db, job, ["t_extras", "t_input", "t_other"], { step: "t_other", otherPersonId: person.id });
      await done();
      if (next) {
        await sendMessage(chatId, `⭐ Wie viele Sterne gibt ${e(person.name)}?`, {
          inline_keyboard: [...ratingButtons(job.id, "orate"), [button("‹ Zurück", job.id, "back")]],
        });
      }
      return;
    }
    case "orate": {
      const rating = Number(parsed.value) / 2;
      if (s.step !== "t_other" || !s.otherPersonId || !s.encounterId || !isValidRating(rating)) return answerCallback(cb.id);
      const result = await applyEdit(db, { kind: "encounter", encounterId: s.encounterId, set: {}, ratings: [{ personId: s.otherPersonId, rating }] });
      await done();
      if (!result.ok) {
        await sendMessage(chatId, `⚠️ ${e(result.error)}`);
        return;
      }
      const persons = await otherPersons(db, s.personId);
      const name = persons.find((p) => p.id === s.otherPersonId)?.name ?? "";
      const next = await advance(db, job, "t_other", { step: "t_extras", otherPersonId: undefined });
      if (next) {
        const state = stateOf(next)!;
        await sendMessage(chatId, `⭐ ${e(name)}: ${formatStarNumber(rating)} ★ gespeichert.\n${savedText(state, false)}`, extrasKeyboard(job.id, state, persons));
      }
      return;
    }
    case "back": {
      const next = await advance(db, job, ["t_other", "t_input"], { step: "t_extras", awaiting: undefined, otherPersonId: undefined });
      await done();
      if (next) {
        const state = stateOf(next)!;
        await sendMessage(chatId, savedText(state, false), extrasKeyboard(job.id, state, await otherPersons(db, s.personId)));
      }
      return;
    }
    case "done": {
      const next = await advance(db, job, ["t_extras", "t_input", "t_other"], { step: "t_done", awaiting: undefined }, "confirmed");
      await done(next ? "Fertig" : undefined);
      if (next) {
        const base = appBaseUrl();
        const wineId = s.savedWineId;
        const link = base && wineId ? `\n<a href="${base}${wineHref(wineId, s.proposal.vintage_year, { von: "verkostet" })}">In MyWine öffnen</a>` : "";
        await sendMessage(chatId, `👍 Fertig – ${wineLabel(s)} ist unter „Verkostet“ gespeichert.${link}`);
      }
      return;
    }
    default:
      await answerCallback(cb.id);
  }
}
