"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { applyEdit, applyEdits } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import type { ActionState } from "./actions";

/**
 * Alle Bearbeiten-Formulare der Weinseite: Formular → Bearbeitung(en) → gemeinsames
 * Modul (gleiche Prüfungen und Meldungen wie im Bot).
 */
export async function saveEdit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const edits = editsFromForm(formData);
  if ("error" in edits) return { error: edits.error };
  const result = await applyEdits(session.supabase, edits);
  if (!result.ok) return { error: result.error, ...(result.link ? { link: result.link } : {}) };
  revalidatePath("/", "layout");
  // Jahrgang umbenannt: die Seite zeigt danach den neuen Jahrgang (der alte gibt es nicht mehr).
  if (edits.some((e) => e.kind === "vintage") && result.wineId) {
    redirect(wineHref(result.wineId, result.year ?? null, { ok: result.message }));
  }
  return { ok: result.message };
}

/**
 * Ganzen Wein löschen (Gefahrenzone): eingetippter Name muss passen; Fotos/Dokumente werden
 * aus den Buckets entfernt. Die Seite navigiert danach selbst zurück zur Liste.
 */
/** Nur Listen als Ziel nach dem Löschen (kein offener Redirect). */
const LIST_PATHS = ["/", "/bestand", "/offen", "/getrunken", "/verkostet"];
function listTarget(value: FormDataEntryValue | null) {
  const v = typeof value === "string" ? value : "";
  const path = v.split("?")[0];
  return v.startsWith("/") && !v.startsWith("//") && LIST_PATHS.includes(path) ? v : "/bestand";
}

export async function deleteWineAction(formData: FormData): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  const edits = editsFromForm(formData);
  if ("error" in edits) return { error: edits.error };
  const [edit] = edits;
  if (edits.length !== 1 || edit.kind !== "deleteWine") return { error: "Unbekannte Bearbeitung." };
  const result = await applyEdit(session.supabase, edit);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(listTarget(formData.get("back")));
}
