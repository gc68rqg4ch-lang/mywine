"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { applyEdit } from "@/lib/edit/edit";
import { AMBIGUOUS_WINE, wineCandidates, type WineCandidate } from "@/lib/edit/encounters";
import { editsFromForm } from "@/lib/edit/form";

export type EncounterActionState = { error?: string; candidates?: WineCandidate[] } | undefined;

/**
 * „Verkostet erfassen“: Formular → gemeinsames Modul (gleiche Prüfungen wie später im Bot).
 * Gespeichert wird alles oder nichts. Gibt es mehrere Weine mit dem Namen (ohne Produzent),
 * kommt eine Auswahl zurück. Danach auf die Weinseite des Jahrgangs.
 */
export async function addEncounter(_prev: EncounterActionState, formData: FormData): Promise<EncounterActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const edits = editsFromForm(formData);
  if ("error" in edits) return { error: edits.error };
  const edit = edits[0];
  if (edits.length !== 1 || edit.kind !== "addEncounter") return { error: "Unbekannte Bearbeitung." };
  const result = await applyEdit(session.supabase, { ...edit, personId: session.person?.id ?? null });
  if (!result.ok) {
    if (result.error === AMBIGUOUS_WINE && "new" in edit.wine) {
      return { error: result.error, candidates: await wineCandidates(session.supabase, edit.wine.new.name) };
    }
    return { error: result.error };
  }
  revalidatePath("/", "layout");
  redirect(wineHref(result.wineId!, result.year ?? null, { von: "verkostet", ok: result.message }));
}
