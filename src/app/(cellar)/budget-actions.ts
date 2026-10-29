"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { raiseBudget } from "@/lib/ai/budget";

/** Budget der Claude-API für diesen Monat einmalig um 10 USD erhöhen (nur eingeloggte Mitglieder). */
export async function raiseBudgetAction(): Promise<void> {
  const session = await getSession();
  if (!session.isMember) return;
  try {
    await raiseBudget(session.supabase);
  } catch (error) {
    console.error("raise api budget failed", error instanceof Error ? error.message : error);
  }
  revalidatePath("/recherche");
}
