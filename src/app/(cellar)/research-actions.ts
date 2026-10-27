"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ResearchScope } from "@/lib/research/gaps";
import { decideSuggestion } from "@/lib/research/suggestions";
import { researchAndFillWine, type ResearchOutcome } from "@/lib/research/wine";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ein Wein, vollständig (Sammellauf): alle leeren Angaben in einem Durchgang ergänzen. */
export async function researchWine(wineId: string, scope: ResearchScope): Promise<ResearchOutcome> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(wineId)) return { status: "error", filled: [], suggested: 0, seconds: 0 };
  try {
    const outcome = await researchAndFillWine(session.supabase, wineId, scope === "all" ? "all" : "cellar");
    if (outcome.filled.length) revalidatePath("/", "layout");
    return outcome;
  } catch (error) {
    console.error("wine research failed", wineId, error);
    return { status: "error", filled: [], suggested: 0, seconds: 0 };
  }
}

/** „🔎 Nachrecherchieren“ auf der Weinseite – ohne Rückfrage, alle Jahrgänge mit Flaschen. */
export async function researchWineFromPage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const outcome = await researchWine(String(formData.get("wineId") ?? ""), "all");
  switch (outcome.status) {
    case "filled":
      return {
        ok: [
          outcome.filled.length ? `Ergänzt: ${outcome.filled.join(" · ")}` : null,
          outcome.suggested ? `Ich habe ${outcome.suggested === 1 ? "eine Abweichung" : `${outcome.suggested} Abweichungen`} gefunden – siehe oben.` : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "complete":
      return { ok: "Keine Flaschen – nichts zu recherchieren." };
    case "nothing":
      return { ok: "Ich habe nichts Neues gefunden – deine Angaben stimmen mit der Recherche überein." };
    default:
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
