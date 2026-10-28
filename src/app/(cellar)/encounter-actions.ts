"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { applyEdit } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import type { ActionState } from "./actions";

/**
 * „Verkostet erfassen“: Formular → gemeinsames Modul (gleiche Prüfungen wie später im Bot).
 * Wer erfasst, kommt aus der Anmeldung. Danach auf die Weinseite des Jahrgangs.
 */
export async function addEncounter(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const edits = editsFromForm(formData);
  if ("error" in edits) return { error: edits.error };
  const edit = edits[0];
  if (edits.length !== 1 || edit.kind !== "addEncounter") return { error: "Unbekannte Bearbeitung." };
  const result = await applyEdit(session.supabase, { ...edit, personId: session.person?.id ?? null });
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(wineHref(result.wineId!, result.year ?? null, { von: "verkostet", ok: result.message }));
}
