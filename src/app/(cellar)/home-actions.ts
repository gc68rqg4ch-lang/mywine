"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { refreshAvatar } from "@/lib/home/avatar";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "./actions";

/** Knopf auf /recherche: Antoines Foto jetzt neu von Telegram holen. */
export async function refreshAntoinePhoto(): Promise<ActionState> {
  const session = await getSession();
  if (!session.isMember) return { error: "Kein Zugriff." };
  try {
    const result = await refreshAvatar(createAdminClient());
    revalidatePath("/");
    return result === "saved" ? { ok: "Antoines Foto ist aktualisiert." } : { error: "Antoine hat in Telegram gerade kein Profilbild." };
  } catch (error) {
    console.error("avatar refresh failed", error instanceof Error ? error.message : error);
    return { error: "Das Foto konnte ich gerade nicht holen – versuch es später nochmals." };
  }
}
