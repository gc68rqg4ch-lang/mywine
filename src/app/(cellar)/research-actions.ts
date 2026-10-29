"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ResearchScope } from "@/lib/research/gaps";
import { decideSuggestion } from "@/lib/research/suggestions";
import { researchAndFillWine, type ResearchOutcome, type TasteMode } from "@/lib/research/wine";
import { noProfileText } from "@/lib/taste/profile";
import { researchSummary } from "@/lib/research/summary";
import { apiProblem } from "@/lib/ai/api-errors";
import { researchDrinkWindowYears } from "@/lib/research/drink-window";
import type { ActionState } from "./actions";
import { cancelRun, enqueueRun, kickWorker, resumeRun, type NewJob } from "@/lib/research/jobs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TASTE_MODES: TasteMode[] = ["always", "missing", "only"];

/**
 * Ein Wein, vollständig (Sammellauf): alle leeren Angaben in einem Durchgang ergänzen, danach
 * das Geschmacksprofil (Sammellauf: nur wo es fehlt; „only“: nur das Profil).
 */
export async function researchWine(
  wineId: string,
  scope: ResearchScope,
  taste: TasteMode = "missing",
  year?: number | null,
  /** Sammellauf: in den letzten 12 Monaten gesuchte Profil-Jahrgänge überspringen (Option, Standard an). */
  skipRecent = true,
): Promise<ResearchOutcome> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(wineId)) return { status: "error", filled: [], suggested: 0, seconds: 0 };
  try {
    const outcome = await researchAndFillWine(session.supabase, wineId, scope === "all" ? "all" : "cellar", {
      taste: TASTE_MODES.includes(taste) ? taste : "missing",
      ...(year === undefined || year === null || Number.isInteger(year) ? { year } : {}),
      skipRecent: skipRecent !== false,
    });
    if (outcome.filled.length || outcome.suggested) revalidatePath("/", "layout");
    return outcome;
  } catch (error) {
    const problem = apiProblem(error);
    // Limit: ein Eintrag (der Sammellauf hält danach an), ohne den ganzen Fehler je Wein.
    if (problem?.kind === "usage_limit") console.error("api limit reached", wineId, problem.message);
    else console.error("wine research failed", wineId, error);
    return {
      status: "error",
      filled: [],
      suggested: 0,
      seconds: 0,
      error: problem ?? { kind: "other", message: "Die Recherche ist fehlgeschlagen." },
    };
  }
}

/**
 * Sammellauf „Trinkfenster fehlt“: für die angegebenen Jahrgänge eines Weins (nacheinander) das
 * Trinkfenster suchen – Quelle, sonst Schätzung; nur wenn „ab“ und „bis“ noch leer sind.
 * API-Limit: sofort abbrechen (der Lauf hält an), nichts gesetzt.
 */
export async function researchDrinkWindows(wineId: string, years: (number | null)[]): Promise<ResearchOutcome> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(wineId)) return { status: "error", filled: [], suggested: 0, seconds: 0 };
  const outcome = await researchDrinkWindowYears(session.supabase, wineId, years);
  if (outcome.filled.length || outcome.suggested) revalidatePath("/", "layout");
  return outcome;
}

/** Jahrgang aus dem Formular: leer → undefined (Recherche wählt), „nv“ → null. */
function formYear(formData: FormData) {
  const raw = String(formData.get("year") ?? "").trim();
  if (!raw) return undefined;
  if (raw === "nv") return null;
  const year = Number(raw);
  return Number.isInteger(year) ? year : undefined;
}

/** Hinweis zum Profil, wenn nichts Verlässliches kam. */
const tasteNote = (outcome: ResearchOutcome) => (outcome.taste === "none" ? `Geschmacksprofil: ${noProfileText(outcome.tasteYear ?? null)}` : null);

/**
 * 🔎 im Kopf der Weinseite: „Nachrecherchieren“ für den gewählten Jahrgang (inkl. Geschmacksprofil),
 * ohne Rückfrage. Kurze Meldung („3 Angaben ergänzt“, „1 Abweichung zum Prüfen“, „Nichts Neues gefunden“).
 */
export async function researchWineFromHeader(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const wineId = String(formData.get("wineId") ?? "");
  const year = formYear(formData);
  // Im Hintergrund (Warteschlange); die Seite darf geschlossen werden. Ohne Migration wie bisher direkt.
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(wineId)) return { error: "Kein Zugriff." };
  const queued = await enqueueRun(session.supabase, [{ wineId, kind: "page", params: year === undefined ? {} : { year } }], session.person?.id ?? null).catch((error) => {
    console.error("research enqueue failed", wineId, error);
    return { unavailable: true as const };
  });
  if ("runId" in queued) {
    kickWorker();
    revalidatePath(`/wein/${wineId}`);
    return { ok: BACKGROUND_TEXT };
  }
  const outcome = await researchWine(wineId, "all", "always", year);
  // „Zuletzt recherchiert am …“ auch ohne Fund aktualisieren.
  if (outcome.status !== "error" && UUID_RE.test(wineId)) revalidatePath(`/wein/${wineId}`);
  return researchSummary(outcome);
}

const BACKGROUND_TEXT = "Recherche läuft im Hintergrund – du kannst die Seite schliessen. Ist sie fertig, meldet sich Antoine per Telegram; die Ergebnisse stehen dann hier.";

export type BatchStart = { runId: string } | { unavailable: true } | { error: string };

/**
 * Sammellauf starten: die gewählten Weine als Aufträge in die Warteschlange (nacheinander im
 * Hintergrund). unavailable: Migration fehlt – dann läuft der Sammellauf wie bisher in der Seite.
 */
export async function startBatchResearch(input: {
  mode: "research" | "window";
  scope: ResearchScope;
  taste: TasteMode;
  skipRecent: boolean;
  candidates: { wineId: string; tasteYear?: number | null; windowYears?: (number | null)[] }[];
}): Promise<BatchStart> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const scope: ResearchScope = input.scope === "all" ? "all" : "cellar";
  const taste = TASTE_MODES.includes(input.taste) ? input.taste : "missing";
  const validYear = (y: unknown): y is number | null => y === null || Number.isInteger(y);
  const jobs: NewJob[] = input.candidates
    .filter((c) => UUID_RE.test(c.wineId))
    .slice(0, 500)
    .map((c) =>
      input.mode === "window"
        ? { wineId: c.wineId, kind: "window", params: { years: (c.windowYears ?? []).filter(validYear).slice(0, 20) }, vintageYear: (c.windowYears ?? []).find((y) => y != null) ?? null }
        : { wineId: c.wineId, kind: "research", params: { scope, taste, skipRecent: input.skipRecent !== false, ...(validYear(c.tasteYear) ? { year: c.tasteYear } : {}) } },
    );
  try {
    const queued = await enqueueRun(session.supabase, jobs, session.person?.id ?? null);
    if ("empty" in queued) return { error: "Nichts ausgewählt." };
    if ("runId" in queued) {
      kickWorker();
      revalidatePath("/recherche");
    }
    return queued;
  } catch (error) {
    console.error("research batch enqueue failed", error);
    return { error: "Der Sammellauf liess sich nicht starten." };
  }
}

/** Sammellauf abbrechen: offene Aufträge → übersprungen (der laufende Wein wird fertig). */
export async function cancelBatchResearch(runId: string): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(runId)) return { error: "Kein Zugriff." };
  const n = await cancelRun(session.supabase, runId);
  revalidatePath("/recherche");
  return { ok: n ? `Abgebrochen – ${n} ${n === 1 ? "Wein" : "Weine"} übersprungen.` : "Es war nichts mehr offen." };
}

/** Nach dem API-Limit fortsetzen. */
export async function resumeBatchResearch(runId: string): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(runId)) return { error: "Kein Zugriff." };
  const n = await resumeRun(session.supabase, runId);
  if (n) kickWorker();
  revalidatePath("/recherche");
  return { ok: n ? `Fortgesetzt – ${n} ${n === 1 ? "Wein" : "Weine"} wieder in der Warteschlange.` : "Es war nichts angehalten." };
}

/** „🔎 Geschmacksprofil recherchieren“ in der Karte – nur das Profil. */
export async function researchTasteFromPage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Bewusster Einzelauftrag: die 12-Monats-Regel gilt hier nicht.
  const outcome = await researchWine(String(formData.get("wineId") ?? ""), "all", "only", formYear(formData), false);
  if (outcome.status === "nothing") return { ok: noProfileText(outcome.tasteYear ?? null) };
  return pageMessage(outcome);
}

function pageMessage(outcome: ResearchOutcome): ActionState {
  switch (outcome.status) {
    case "filled":
      return {
        ok: [
          outcome.filled.length ? `Ergänzt: ${outcome.filled.join(" · ")}` : null,
          outcome.suggested ? `Ich habe ${outcome.suggested === 1 ? "eine Abweichung" : `${outcome.suggested} Abweichungen`} gefunden – siehe oben.` : null,
          tasteNote(outcome),
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "complete":
      return { ok: "Diesen Wein gibt es nicht mehr." };
    case "nothing":
      return {
        ok: ["Ich habe nichts Neues gefunden – deine Angaben stimmen mit der Recherche überein.", tasteNote(outcome)].filter(Boolean).join(" "),
      };
    default:
      if (outcome.error?.kind === "usage_limit" || outcome.error?.kind === "temporary") return { error: outcome.error.message };
      if (outcome.error?.kind === "api") return { error: `${outcome.error.message} Bitte später nochmals versuchen.` };
      return { error: "Die Recherche ist fehlgeschlagen. Bitte später nochmals versuchen." };
  }
}

/** [Übernehmen] / [Behalten] bei einem Vorschlag aus der Recherche. */
export async function decideSuggestionAction(id: string, accept: boolean): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(id)) return { error: "Kein Zugriff." };
  try {
    const result = await decideSuggestion(session.supabase, id, accept, session.person?.id ?? null);
    if (!result.ok) return { error: result.error };
    revalidatePath("/", "layout");
    return { ok: result.message };
  } catch (error) {
    console.error("deciding suggestion failed", id, error);
    return { error: "Das hat nicht geklappt – nichts geändert." };
  }
}

/** „Alle übernehmen“: der Reihe nach; Fehler bei einem halten die anderen nicht auf. */
export async function acceptAllSuggestions(ids: string[]): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const errors: string[] = [];
  let accepted = 0;
  for (const id of ids.filter((i) => UUID_RE.test(i))) {
    try {
      const result = await decideSuggestion(session.supabase, id, true, session.person?.id ?? null);
      if (result.ok) accepted++;
      else errors.push(result.error);
    } catch (error) {
      console.error("accepting suggestion failed", id, error);
      errors.push("Ein Vorschlag konnte nicht übernommen werden.");
    }
  }
  revalidatePath("/", "layout");
  if (errors.length) return { error: `${accepted} übernommen, ${errors.length} nicht: ${[...new Set(errors)].join(" ")}` };
  return { ok: accepted === 1 ? "1 Vorschlag übernommen." : `${accepted} Vorschläge übernommen.` };
}
