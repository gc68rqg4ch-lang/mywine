// Zustand der Such-Anbieter (Serper, SerpApi) aus den letzten Preissuchen (research_jobs.result) –
// rein. Ein Fehler, der jede Abfrage trifft (Konto, Schlüssel, Kontingent, gesperrtes Muster),
// soll auf /recherche auffallen statt tagelang nur in den Diagnosen zu stehen.

export type ProviderPart = "shopping" | "search";
export type ProviderIssue = {
  provider: string;
  part: ProviderPart;
  /** Preissuchen mit diesem Fehler bzw. insgesamt (im Zeitraum) */
  failed: number;
  total: number;
  lastError: string;
  lastAt: string | null;
  /** Trifft (fast) jede Preissuche: als Fehler hervorheben */
  serious: boolean;
};

type JobRow = { finished_at: string | null; result: unknown };
type Diag = {
  provider_errors?: { provider?: string; part?: ProviderPart; error?: string }[];
  shopping?: { failed?: { provider?: string; error?: string }[]; search?: { error?: string } };
};

/** Fehler einer Preissuche (neue Diagnose provider_errors, sonst aus den älteren Feldern). */
function jobErrors(result: unknown): { provider: string; part: ProviderPart; error: string }[] {
  const d = ((result ?? {}) as { diagnostics?: Diag }).diagnostics;
  if (!d) return [];
  if (Array.isArray(d.provider_errors)) {
    return d.provider_errors.filter((e) => e.provider && e.error).map((e) => ({ provider: e.provider!, part: e.part === "search" ? "search" : "shopping", error: e.error! }));
  }
  const out: { provider: string; part: ProviderPart; error: string }[] = [];
  for (const f of d.shopping?.failed ?? []) if (f.provider && f.error) out.push({ provider: f.provider, part: "shopping", error: f.error });
  // Ältere Aufträge: „serper: serper search 400: …“ (mehrere mit „; “ getrennt)
  for (const part of (d.shopping?.search?.error ?? "").split("; ").filter(Boolean)) {
    const m = part.match(/^(\w+):\s*(.+)$/);
    if (m) out.push({ provider: m[1], part: "search", error: m[2] });
  }
  return out;
}

/** Anbieter-Probleme der Preissuchen (neueste zuerst übergeben). */
export function providerIssues(rows: JobRow[]): ProviderIssue[] {
  const total = rows.length;
  const map = new Map<string, ProviderIssue>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const e of jobErrors(row.result)) {
      const key = `${e.provider}|${e.part}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const issue = map.get(key) ?? { provider: e.provider, part: e.part, failed: 0, total, lastError: e.error, lastAt: row.finished_at, serious: false };
      issue.failed++;
      map.set(key, issue);
    }
  }
  return [...map.values()]
    .map((i) => ({ ...i, serious: i.failed >= 2 && i.failed * 2 >= i.total }))
    .sort((a, b) => b.failed - a.failed);
}

const PROVIDER_LABELS: Record<string, string> = { serper: "Serper", serpapi: "SerpApi" };
const PART_LABELS: Record<ProviderPart, string> = { shopping: "Google Shopping", search: "Google-Suche" };

/** „Serper (Google-Suche): Fehler in 34 von 34 Preissuchen – «…»“ */
export function issueText(i: ProviderIssue) {
  return `${PROVIDER_LABELS[i.provider] ?? i.provider} (${PART_LABELS[i.part]}): Fehler in ${i.failed} von ${i.total} Preissuchen – «${i.lastError.slice(0, 160)}»`;
}
