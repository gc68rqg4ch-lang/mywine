"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import {
  formatShares,
  normalizeGrapeShares,
  percentSum,
  type GrapeShare,
} from "@/lib/grapes/shares";
import { replaceGrapeShares, researchAndStore, type ResearchOutcome } from "@/lib/grapes/store";
import type { ActionState } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function memberSession() {
  const session = await getSession();
  return session.isMember ? session : null;
}

async function loadItemWine(itemId: string) {
  const session = await memberSession();
  if (!session || !UUID_RE.test(itemId)) return null;
  const { data } = await session.supabase
    .from("inventory_items")
    .select("vintage_year, wine:wines(id, name, producer, country, region, appellation)")
    .eq("id", itemId)
    .maybeSingle();
  if (!data?.wine) return null;
  return { session, vintageYear: data.vintage_year, wine: data.wine };
}

/** "" → null, "85" / "85,5" / "85 %" → Zahl, sonst undefined (ungültig). */
function parsePercent(raw: string): number | null | undefined {
  const text = raw.replace(/[%\s]/g, "").replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
}

/** Speichert die Rebsorten einer Position für ihren Jahrgang (source = manual). */
export async function saveGrapeShares(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await loadItemWine(String(formData.get("itemId") ?? ""));
  if (!ctx) return { error: "Kein Zugriff oder Position nicht gefunden." };

  let raw: { grape: string; percent: string }[];
  try {
    raw = JSON.parse(String(formData.get("shares") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error();
  } catch {
    return { error: "Ungültige Eingabe." };
  }

  const shares: GrapeShare[] = [];
  for (const row of raw) {
    const grape = String(row?.grape ?? "").trim();
    const percent = parsePercent(String(row?.percent ?? ""));
    if (!grape && percent == null) continue;
    if (!grape) return { error: "Bitte bei jedem Anteil auch die Rebsorte angeben." };
    if (percent === undefined) return { error: `Ungültiger Anteil bei ${grape} (1–100 %).` };
    shares.push({ grape, percent });
  }
  if (percentSum(shares) > 100.5) {
    return { error: `Die Anteile ergeben ${percentSum(shares).toLocaleString("de-CH")} % – höchstens 100 %.` };
  }

  try {
    await replaceGrapeShares(ctx.session.supabase, {
      wineId: ctx.wine.id,
      vintageYear: ctx.vintageYear,
      shares: normalizeGrapeShares(shares),
      source: "manual",
      keepManual: false,
    });
  } catch (error) {
    console.error("save grape shares failed", error);
    return { error: "Rebsorten konnten nicht gespeichert werden." };
  }

  revalidatePath("/", "layout");
  return { ok: "Rebsorten gespeichert." };
}

const OUTCOME_TEXT: Record<ResearchOutcome["status"], string> = {
  with_percent: "Rebsorten mit Anteilen gefunden und gespeichert.",
  without_percent: "Rebsorten gefunden, aber keine Anteile für diesen Jahrgang – ohne Prozent gespeichert.",
  nothing_found: "Nichts gefunden – die bisherigen Angaben bleiben.",
  kept_manual: "Manuelle Angaben vorhanden – nicht überschrieben.",
};

/** Nachrecherchieren für eine Position (Button auf der Detailseite). */
export async function researchGrapesForItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await loadItemWine(String(formData.get("itemId") ?? ""));
  if (!ctx) return { error: "Kein Zugriff oder Position nicht gefunden." };

  try {
    // Ausdrücklich angestossen: ersetzt auch manuelle Angaben für diesen Jahrgang.
    const outcome = await researchAndStore(
      ctx.session.supabase,
      { ...ctx.wine, vintage_year: ctx.vintageYear },
      { keepManual: false },
    );
    revalidatePath("/", "layout");
    return outcome.status === "nothing_found"
      ? { error: OUTCOME_TEXT.nothing_found }
      : { ok: OUTCOME_TEXT[outcome.status] };
  } catch (error) {
    console.error("grape research failed", error);
    return { error: "Die Recherche ist fehlgeschlagen. Bitte später nochmals versuchen." };
  }
}

export type BatchResult = { status: ResearchOutcome["status"] | "error"; summary: string };

/** Ein Schritt des Sammellaufs: ein Wein + Jahrgang. Manuelle Angaben bleiben. */
export async function researchGrapesForWine(
  wineId: string,
  vintageYear: number | null,
): Promise<BatchResult> {
  const session = await memberSession();
  if (!session || !UUID_RE.test(wineId)) return { status: "error", summary: "Kein Zugriff." };
  if (vintageYear != null && !(Number.isInteger(vintageYear) && vintageYear >= 1800 && vintageYear <= 2100)) {
    return { status: "error", summary: "Ungültiger Jahrgang." };
  }

  const { data: wine } = await session.supabase
    .from("wines")
    .select("id, name, producer, country, region, appellation")
    .eq("id", wineId)
    .maybeSingle();
  if (!wine) return { status: "error", summary: "Wein nicht gefunden." };

  try {
    const outcome = await researchAndStore(
      session.supabase,
      { ...wine, vintage_year: vintageYear },
      { keepManual: true },
    );
    return {
      status: outcome.status,
      summary: formatShares(outcome.shares) || OUTCOME_TEXT[outcome.status],
    };
  } catch (error) {
    console.error("batch grape research failed", wineId, vintageYear, error);
    return { status: "error", summary: "Recherche fehlgeschlagen." };
  }
}
