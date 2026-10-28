"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { wineHref } from "@/lib/cellar/wine-page";
import { afterWine } from "@/lib/research/batch";
import type { ResearchScope } from "@/lib/research/gaps";
import type { ResearchOutcome, TasteMode } from "@/lib/research/wine";
import { NO_RELIABLE_PROFILE } from "@/lib/taste/profile";
import { researchWine } from "../research-actions";

export type BatchCandidate = {
  wineId: string;
  producer: string | null;
  name: string;
  years: (number | null)[];
  gaps: string[];
  /** Ohne Lücken – nur zur Kontrolle (Abweichungen werden Vorschläge). */
  complete: boolean;
};

/** Schätzung pro Wein, bis eigene Messwerte da sind (Websuche mit mehreren Abfragen). */
const ESTIMATE_SECONDS = 60;

type Row = { state: "waiting" | "running" } | ({ state: "done" } & ResearchOutcome);

const ICON: Record<ResearchOutcome["status"] | "waiting" | "running", string> = {
  waiting: "·",
  running: "⏳",
  filled: "✅",
  nothing: "❔",
  complete: "✔️",
  error: "⚠️",
};

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));

/**
 * Sammellauf: erst nach Bestätigung, Wein für Wein (jeder Schritt eine Server Action).
 * Abbrechen hält nach dem laufenden Wein an; Gefundenes ist da schon gespeichert.
 */
export function BatchResearch({
  candidates: initial,
  scope,
  taste = "missing",
  skipped = 0,
}: {
  candidates: BatchCandidate[];
  scope: ResearchScope;
  /** „only“: nur das Geschmacksprofil (Option „Geschmacksprofil fehlt“). */
  taste?: TasteMode;
  /** In den letzten 7 Tagen recherchiert – nicht in candidates. */
  skipped?: number;
}) {
  const router = useRouter();
  // Liste beim Laden festhalten: nach dem Lauf lädt die Seite neu, frisch geprüfte Weine
  // würden sonst (7-Tage-Regel) aus Liste und Zusammenfassung verschwinden.
  const [candidates] = useState(initial);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [phase, setPhase] = useState<"idle" | "confirm" | "running" | "stopping" | "done">("idle");
  const stop = useRef(false);
  // Grund für einen automatischen Stopp (API-Limit oder 3 Fehler in Folge).
  const [halt, setHalt] = useState<string | null>(null);

  const done = candidates.filter((c) => rows[c.wineId]?.state === "done");
  const results = done.map((c) => rows[c.wineId] as Extract<Row, { state: "done" }>);
  const measured = results.filter((r) => r.status !== "error" && r.seconds > 0);
  const average = measured.length ? measured.reduce((s, r) => s + r.seconds, 0) / measured.length : null;
  const todo = candidates.filter((c) => rows[c.wineId]?.state !== "done");
  const estimate = todo.length * (average ?? ESTIMATE_SECONDS);
  const checks = todo.filter((c) => c.complete).length;
  const withGaps = todo.length - checks;

  async function run() {
    stop.current = false;
    setHalt(null);
    setPhase("running");
    let failures = 0;
    for (const c of todo) {
      if (stop.current) break;
      setRows((r) => ({ ...r, [c.wineId]: { state: "running" } }));
      let outcome: ResearchOutcome;
      try {
        outcome = await researchWine(c.wineId, scope, taste);
      } catch {
        outcome = { status: "error", filled: [], suggested: 0, seconds: 0 };
      }
      setRows((r) => ({ ...r, [c.wineId]: { state: "done", ...outcome } }));
      // API-Limit: sofort aufhören; andere Fehler: nach 3 in Folge.
      const step = afterWine(outcome, failures);
      failures = step.failures;
      if (step.halt) {
        setHalt(step.halt);
        break;
      }
    }
    setPhase("done");
    router.refresh();
  }

  if (candidates.length === 0) {
    return (
      <p className="empty">
        {skipped
          ? `Nichts zu tun – ${skipped === 1 ? "1 Wein wurde" : `${skipped} Weine wurden`} in den letzten 7 Tagen schon geprüft.`
          : taste === "only"
            ? "Alle Weine haben ein Geschmacksprofil. 🎉"
            : "Keine Lücken – hier gibt es nichts zu recherchieren. 🎉"}
      </p>
    );
  }

  const filledCount = results.reduce((s, r) => s + r.filled.length, 0);
  const suggestedCount = results.reduce((s, r) => s + (r.suggested ?? 0), 0);
  const tally = (status: ResearchOutcome["status"]) => results.filter((r) => r.status === status).length;
  const running = phase === "running" || phase === "stopping";

  return (
    <div className="stack">
      <section className="card stack">
        {phase === "idle" && (
          <div className="row row-between">
            <span>
              {todo.length === candidates.length
                ? [
                    withGaps ? `${withGaps} ${withGaps === 1 ? "Wein" : "Weine"} mit Lücken` : null,
                    checks ? `${checks} ${checks === 1 ? "vollständiger" : "vollständige"} zur Kontrolle` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : `${todo.length} von ${candidates.length} Weinen noch offen`}
            </span>
            {todo.length > 0 && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setPhase("confirm")}>
                🔎 Recherche starten …
              </button>
            )}
          </div>
        )}

        {phase === "confirm" && (
          <div className="stack-sm" role="alertdialog" aria-label="Recherche starten?">
            <p>
              <strong>
                Ich recherchiere jetzt {todo.length} {todo.length === 1 ? "Wein" : "Weine"}: {withGaps}{" "}
                {withGaps === 1 ? "Wein" : "Weine"} mit Lücken, {checks} {checks === 1 ? "vollständiger" : "vollständige"} zur
                Kontrolle. Das dauert etwa {minutes(estimate)} {minutes(estimate) === 1 ? "Minute" : "Minuten"}. Starten?
              </strong>
            </p>
            {skipped > 0 && (
              <p className="small">
                {skipped === 1 ? "1 Wein überspringe ich" : `${skipped} Weine überspringe ich`} – in den letzten 7 Tagen
                schon geprüft.
              </p>
            )}
            <p className="muted small">Abweichungen lege ich als Vorschläge ab – ich überschreibe nichts.</p>
            <p className="muted small">Die Seite muss dabei offen bleiben. Gefundenes wird sofort gespeichert.</p>
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" onClick={run}>
                Starten
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase("idle")}>
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {running && (
          <div className="stack-sm">
            <div className="row row-between">
              <strong role="status">
                {done.length} von {candidates.length}
              </strong>
              <button
                type="button"
                className="btn btn-sm"
                disabled={phase === "stopping"}
                onClick={() => {
                  stop.current = true;
                  setPhase("stopping");
                }}
              >
                Abbrechen
              </button>
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={candidates.length} aria-valuenow={done.length} aria-label="Fortschritt">
              <span style={{ width: `${Math.round((done.length / candidates.length) * 100)}%` }} />
            </div>
            <p className="muted small">
              {phase === "stopping"
                ? "Ich halte nach dem laufenden Wein an – Gefundenes bleibt gespeichert."
                : `Noch etwa ${minutes(estimate)} Min.${average ? ` (Ø ${Math.round(average)} s pro Wein)` : ""}`}
            </p>
          </div>
        )}

        {phase === "done" && halt && (
          <p className="notice notice-error" role="alert">
            ⛔ {halt} Bereits Gefundenes ist gespeichert.
          </p>
        )}
        {phase === "done" && (
          <div className="stack-sm" role="status">
            <strong>
              Fertig: {done.length} von {candidates.length} Weinen recherchiert
              {done.length < candidates.length ? " (abgebrochen)" : ""}.
            </strong>
            <p>
              {filledCount} Angaben ergänzt · {suggestedCount} Abweichungen als Vorschlag (oben) · ✅ {tally("filled")} mit
              Ergebnis · ❔ {tally("nothing")} nichts Neues
              {tally("error") ? ` · ⚠️ ${tally("error")} Fehler` : ""}
              {average ? ` · Ø ${Math.round(average)} s pro Wein` : ""}
            </p>
            {todo.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setPhase("confirm")}>
                Restliche {todo.length} recherchieren …
              </button>
            )}
          </div>
        )}
      </section>

      <ul className="batch-list">
        {candidates.map((c) => {
          const row = rows[c.wineId] ?? { state: "waiting" as const };
          const icon = row.state === "done" ? ICON[row.status] : ICON[row.state];
          const years = c.years.map((y) => y ?? "NV").join(", ");
          return (
            <li key={c.wineId} className="batch-item">
              <span aria-hidden>{icon}</span>
              <div className="item-main">
                {c.producer && <span className="item-producer">{c.producer}</span>}
                <Link href={wineHref(c.wineId)} className="item-title link">
                  {c.name} <span className="muted small">{years}</span>
                </Link>
                <span className="item-meta">
                  {row.state === "done"
                    ? row.status === "filled"
                      ? [row.filled.length ? `Ergänzt: ${row.filled.join(" · ")}` : null, row.suggested ? `${row.suggested} Abweichung(en) als Vorschlag` : null]
                          .filter(Boolean)
                          .join(" · ")
                      : row.status === "nothing"
                        ? taste === "only" || row.taste === "none"
                          ? NO_RELIABLE_PROFILE
                          : "Nichts Neues gefunden"
                        : row.status === "complete"
                          ? "Schon vollständig"
                          : (row.error?.message ?? "Fehler – später nochmals versuchen")
                    : c.complete
                      ? "Vollständig – Kontrolle auf Abweichungen"
                      : `Fehlt: ${c.gaps.join(", ")}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
