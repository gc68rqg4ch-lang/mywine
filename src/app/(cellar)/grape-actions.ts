"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { applyEdit } from "@/lib/edit/edit";
import type { GrapeShare } from "@/lib/grapes/shares";
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

/** Speichert die Rebsorten einer Position für ihren Jahrgang (source = manual, gemeinsames Modul). */
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
  const result = await applyEdit(ctx.session.supabase, {
    kind: "grapes",
    wineId: ctx.wine.id,
    year: ctx.vintageYear,
    shares,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return { ok: result.message };
}
