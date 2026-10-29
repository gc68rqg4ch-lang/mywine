import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { budgetFrom, monthCost, type MonthCost } from "@/lib/ai/budget";
import { BUDGET_STEP_USD, PURPOSE_LABELS, usd, type Purpose } from "@/lib/ai/cost";
import { wineName } from "@/lib/format";
import { raiseBudgetAction } from "../budget-actions";

type Db = SupabaseClient<Database>;

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Die teuersten Aufrufe der letzten 7 Tage (Zweck, Wein, Kosten). */
async function topCalls(db: Db, now = Date.now()) {
  const { data, error } = await db
    .from("api_usage")
    .select("id, created_at, purpose, model, cost_usd, web_searches, wine:wines(id, name, producer)")
    .gte("created_at", new Date(now - 7 * 86_400_000).toISOString())
    .order("cost_usd", { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as unknown as { id: string; created_at: string; purpose: Purpose; model: string; cost_usd: number; web_searches: number; wine: { id: string; name: string; producer: string | null } | null }[];
}

function Month({ title, cost }: { title: string; cost: MonthCost }) {
  return (
    <div className="stack-sm">
      <h3 className="small">
        {title} ({monthLabel(cost.month)}): <strong>{usd(cost.total)}</strong>
      </h3>
      {cost.byPurpose.length ? (
        <table className="small">
          <tbody>
            {cost.byPurpose.map((r) => (
              <tr key={r.purpose}>
                <td>{PURPOSE_LABELS[r.purpose] ?? r.purpose}</td>
                <td className="muted">
                  {r.calls} Aufrufe{r.webSearches ? ` · ${r.webSearches} Websuchen` : ""}
                </td>
                <td>{usd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Keine Aufrufe.</p>
      )}
    </div>
  );
}

/**
 * Kasten „API-Kosten“: dieser Monat und Vormonat je Zweck, Budget mit Knopf zum Erhöhen und die
 * zehn teuersten Aufrufe der letzten 7 Tage. Vor der Migration: nichts.
 */
export async function ApiCosts({ db }: { db: Db }) {
  const [current, previous, top, budgetRow] = await Promise.all([
    monthCost(db, 0).catch(() => null),
    monthCost(db, -1).catch(() => null),
    topCalls(db).catch(() => []),
    db.from("api_budget").select("extra_usd, notified_on, month").order("month", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!current) return null;
  const extra = budgetRow.data?.month === current.month ? Number(budgetRow.data.extra_usd ?? 0) : 0;
  const budget = budgetFrom(current.month, current.total, extra);
  return (
    <section className="card stack" aria-label="API-Kosten">
      <h2 className="section-title">API-Kosten</h2>
      <p className={budget.exceeded ? "notice notice-error" : "muted small"}>
        Budget {monthLabel(current.month)}: {usd(budget.spent)} von {usd(budget.budget)}
        {budget.extra ? ` (inkl. ${usd(budget.extra)} Erhöhung)` : ""}
        {budget.exceeded ? " – erreicht: Hintergrund-Recherchen pausieren; Fotos, Chat und Tagestext laufen weiter." : "."}
      </p>
      <form action={raiseBudgetAction}>
        <button type="submit" className="btn btn-sm">
          Budget für diesen Monat einmalig um {BUDGET_STEP_USD} USD erhöhen
        </button>
      </form>
      <Month title="Dieser Monat" cost={current} />
      {previous && <Month title="Vormonat" cost={previous} />}
      {top.length > 0 && (
        <div className="stack-sm">
          <h3 className="small">Die teuersten Aufrufe der letzten 7 Tage</h3>
          <table className="small">
            <tbody>
              {top.map((r) => (
                <tr key={r.id}>
                  <td>{PURPOSE_LABELS[r.purpose] ?? r.purpose}</td>
                  <td>{r.wine ? <Link href={`/wein/${r.wine.id}`}>{wineName(r.wine)}</Link> : <span className="muted">–</span>}</td>
                  <td>{usd(Number(r.cost_usd))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
