"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import type { ResearchScope } from "@/lib/research/gaps";
import { researchAndFillWine, type ResearchOutcome } from "@/lib/research/wine";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ein Wein, vollständig (Sammellauf): alle leeren Angaben in einem Durchgang ergänzen. */
export async function researchWine(wineId: string, scope: ResearchScope): Promise<ResearchOutcome> {
  const session = await getSession();
  if (!session.isMember || !UUID_RE.test(wineId)) return { status: "error", filled: [], seconds: 0 };
  try {
    const outcome = await researchAndFillWine(session.supabase, wineId, scope === "all" ? "all" : "cellar");
    if (outcome.filled.length) revalidatePath("/", "layout");
    return outcome;
  } catch (error) {
    console.error("wine research failed", wineId, error);
    return { status: "error", filled: [], seconds: 0 };
  }
}

/** „🔎 Nachrecherchieren“ auf der Weinseite – ohne Rückfrage, alle Jahrgänge mit Flaschen. */
export async function researchWineFromPage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const outcome = await researchWine(String(formData.get("wineId") ?? ""), "all");
  switch (outcome.status) {
    case "filled":
      return { ok: `Ergänzt: ${outcome.filled.join(" · ")}` };
    case "complete":
      return { ok: "Es fehlt nichts mehr – alle Angaben sind vorhanden." };
    case "nothing":
      return { error: "Im Web habe ich nichts Neues gefunden – die bisherigen Angaben bleiben." };
    default:
      return { error: "Die Recherche ist fehlgeschlagen. Bitte später nochmals versuchen." };
  }
}
