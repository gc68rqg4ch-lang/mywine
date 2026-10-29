"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { progressText, runActive, type RunCounts } from "@/lib/research/job-text";
import { cancelBatchResearch, resumeBatchResearch } from "../research-actions";

/**
 * Sammellauf im Hintergrund: Fortschritt („7 von 20 erledigt“), Abbrechen bzw. nach dem
 * API-Limit Fortsetzen. Die Seite muss nicht offen bleiben; solange etwas läuft, lädt sie alle
 * 15 s neu.
 */
export function BatchProgress({ runId, counts, holdReason }: { runId: string; counts: RunCounts; holdReason: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const active = runActive(counts);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  const act = (fn: (id: string) => Promise<{ ok?: string; error?: string } | undefined>) =>
    startTransition(async () => {
      const result = await fn(runId);
      setMessage(result?.error ?? result?.ok ?? null);
      router.refresh();
    });

  const total = counts.total - counts.skipped;
  const percent = total ? Math.round(((counts.done + counts.failed) / total) * 100) : 100;
  return (
    <section className="card stack-sm" aria-live="polite">
      <h2 className="section-title">Sammellauf im Hintergrund</h2>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={progressText(counts)}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>
        <strong>{progressText(counts)}</strong>
        {counts.running ? " · 1 läuft gerade" : ""}
        {counts.failed ? ` · ${counts.failed} fehlgeschlagen` : ""}
        {counts.skipped ? ` · ${counts.skipped} abgebrochen` : ""}
      </p>
      {counts.held > 0 ? (
        <p className="notice notice-error">
          Angehalten: {holdReason ?? "API-Limit erreicht"} – {counts.held} {counts.held === 1 ? "Wein ist" : "Weine sind"} noch offen.
        </p>
      ) : active ? (
        <p className="muted small">Du kannst die Seite schliessen – ich arbeite die Weine nacheinander ab und melde mich per Telegram, wenn alles fertig ist.</p>
      ) : (
        <p className="muted small">Fertig. Die Ergebnisse und Vorschläge siehst du oben bzw. auf den Weinseiten.</p>
      )}
      <div className="row">
        {counts.held > 0 && (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(resumeBatchResearch)}>
            Fortsetzen
          </button>
        )}
        {(active || counts.held > 0) && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(cancelBatchResearch)}>
            Abbrechen
          </button>
        )}
      </div>
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
