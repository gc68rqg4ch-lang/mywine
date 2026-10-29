import "server-only";

// Monatsbudget für die Claude-API: Grundbetrag API_MONTHLY_BUDGET_USD (Standard 20 USD) plus
// einmalige Erhöhungen des laufenden Monats (api_budget.extra_usd). Ist es erreicht, pausieren die
// Hintergrund-Recherchen (Warteschlange mit hold „budget“, automatische Recherchen nach dem
// Einbuchen fallen aus); Erkennung, Chat und Tagestext laufen weiter. Vor der Migration (Tabelle
// fehlt) gilt kein Budget – dann wird auch nichts protokolliert.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { BUDGET_STEP_USD, baseBudget, zurichMonth, type Purpose } from "./cost";

type Db = SupabaseClient<Database>;

export type PurposeCost = { purpose: Purpose; calls: number; cost: number; webSearches: number };
export type MonthCost = { month: string; total: number; byPurpose: PurposeCost[] };

const missing = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code ?? "") || /api_(usage|budget|cost_by_purpose)/.test(error.message ?? ""));

/** Kosten eines Monats je Zweck (offset 0 = laufender, -1 = Vormonat). Ohne Migration: null. */
export async function monthCost(db: Db, offset = 0, now = new Date()): Promise<MonthCost | null> {
  const m = zurichMonth(now, offset);
  const { data, error } = await db.rpc("api_cost_by_purpose", { p_from: m.from, p_to: m.to });
  if (missing(error)) return null;
  if (error) throw error;
  const byPurpose = (data ?? []).map((r) => ({ purpose: r.purpose as Purpose, calls: Number(r.calls), cost: Number(r.cost_usd), webSearches: Number(r.web_searches) }));
  return { month: m.month, total: Math.round(byPurpose.reduce((s, r) => s + r.cost, 0) * 1e6) / 1e6, byPurpose };
}

export type BudgetState = { month: string; spent: number; base: number; extra: number; budget: number; exceeded: boolean; notifiedOn: string | null };

/** Stand des laufenden Monats. Ohne Migration: null (kein Budget). */
export async function budgetState(db: Db, now = new Date()): Promise<BudgetState | null> {
  const cost = await monthCost(db, 0, now);
  if (!cost) return null;
  const { data, error } = await db.from("api_budget").select("extra_usd, notified_on").eq("month", cost.month).maybeSingle();
  if (missing(error)) return null;
  if (error) throw error;
  return budgetFrom(cost.month, cost.total, Number(data?.extra_usd ?? 0), data?.notified_on ?? null);
}

/** Rein: Budget erreicht, wenn die Kosten das Budget erreichen bzw. übersteigen. */
export function budgetFrom(month: string, spent: number, extra: number, notifiedOn: string | null = null, base = baseBudget()): BudgetState {
  const budget = Math.round((base + extra) * 100) / 100;
  return { month, spent, base, extra, budget, exceeded: spent >= budget, notifiedOn };
}

/** Budget erreicht? Fehler beim Prüfen: nein (lieber weiterarbeiten als alles anhalten). */
export async function budgetExceeded(db: Db, now = new Date()) {
  try {
    return (await budgetState(db, now))?.exceeded ?? false;
  } catch (error) {
    console.error("api budget check failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Budget des laufenden Monats einmalig um 10 USD erhöhen. Gibt das neue Budget zurück. */
export async function raiseBudget(db: Db, now = new Date(), step = BUDGET_STEP_USD) {
  const { month } = zurichMonth(now);
  const { data, error } = await db.from("api_budget").select("extra_usd").eq("month", month).maybeSingle();
  if (error) throw error;
  const extra = Number(data?.extra_usd ?? 0) + step;
  const { error: upsertError } = await db.from("api_budget").upsert({ month, extra_usd: extra, updated_at: new Date().toISOString() }, { onConflict: "month" });
  if (upsertError) throw upsertError;
  return budgetFrom(month, 0, extra).budget;
}

/** Heute schon gemeldet? Sonst als gemeldet vermerken und true zurückgeben (höchstens einmal pro Tag). */
export async function claimBudgetNotice(db: Db, today: string, now = new Date()) {
  const { month } = zurichMonth(now);
  const { data } = await db.from("api_budget").select("notified_on").eq("month", month).maybeSingle();
  if (data?.notified_on === today) return false;
  const { error } = await db.from("api_budget").upsert({ month, notified_on: today, updated_at: new Date().toISOString() }, { onConflict: "month" });
  if (error) throw error;
  return true;
}
