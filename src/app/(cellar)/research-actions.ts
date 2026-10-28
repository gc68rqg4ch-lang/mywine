"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ResearchScope } from "@/lib/research/gaps";
import { decideSuggestion } from "@/lib/research/suggestions";
import { researchAndFillWine, type ResearchOutcome, type TasteMode } from "@/lib/research/wine";
import { noProfileText } from "@/lib/taste/profile";
import { researchSummary } from "@/lib/research/summary";
import { apiProblem } from "@/lib/ai/api-errors";
import { drinkWindowFilled, findAndStoreDrinkWindow } from "@/lib/research/drink-window";
import type { ActionState } from "./actions";

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
  const started = Date.now();
  const seconds = () => Math.round((Date.now() - started) / 1000);
  if (!session.isMember || !UUID_RE.test(wineId)) return { status: "error", filled: [], suggested: 0, seconds: 0 };
  const filled: string[] = [];
  let suggested = 0;
  try {
    for (const year of years.filter((y) => y === null || Number.isInteger(y)).slice(0, 20)) {
      const { result, window } = await findAndStoreDrinkWindow(session.supabase, wineId, year);
      if (result === "set" && window) filled.push(drinkWindowFilled(year, window));
      if (result === "suggested") suggested++;
    }
  } catch (error) {
    const problem = apiProblem(error);
    if (problem?.kind === "usage_limit") console.error("api limit reached", wineId, problem.message);
    else console.error("drink window research failed", wineId, error);
    if (filled.length || suggested) revalidatePath("/", "layout");
    return { status: "error", filled, suggested, seconds: seconds(), error: problem ?? { kind: "other", message: "Die Suche ist fehlgeschlagen." } };
  }
  if (filled.length || suggested) revalidatePath("/", "layout");
  return { status: filled.length || suggested ? "filled" : "nothing", filled, suggested, seconds: seconds() };
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
  const outcome = await researchWine(wineId, "all", "always", formYear(formData));
  // „Zuletzt recherchiert am …“ auch ohne Fund aktualisieren.
  if (outcome.status !== "error" && UUID_RE.test(wineId)) revalidatePath(`/wein/${wineId}`);
  return researchSummary(outcome);
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
