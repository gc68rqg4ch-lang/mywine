"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { researchGrapesForWine, type BatchResult } from "../grape-actions";

export type BatchCandidate = {
  key: string;
  wineId: string;
  vintageYear: number | null;
  producer: string;
  name: string;
};

type RowState = "waiting" | "running" | BatchResult["status"];

const STATUS_ICON: Record<RowState, string> = {
  waiting: "·",
  running: "⏳",
  with_percent: "✅",
  without_percent: "➖",
  nothing_found: "❔",
  kept_manual: "✋",
  error: "⚠️",
};

const STATUS_LABEL: Record<RowState, string> = {
  waiting: "wartet",
  running: "läuft",
  with_percent: "mit Anteilen",
  without_percent: "ohne Anteile",
  nothing_found: "nichts gefunden",
  kept_manual: "manuell, übersprungen",
  error: "Fehler",
};

export function BatchResearch({ candidates }: { candidates: BatchCandidate[] }) {
  const router = useRouter();
  const [states, setStates] = useState<Record<string, { state: RowState; summary?: string }>>({});
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Ref für die laufende Schleife, State für die Anzeige.
  const stopRequested = useRef(false);

  const finished = candidates.filter((c) => {
    const s = states[c.key]?.state;
    return s && s !== "waiting" && s !== "running";
  });
  const counts = finished.reduce<Partial<Record<RowState, number>>>((acc, c) => {
    const s = states[c.key].state;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const progress = candidates.length ? Math.round((finished.length / candidates.length) * 100) : 0;

  async function start() {
    stopRequested.current = false;
    setStopping(false);
    setRunning(true);
    for (const candidate of candidates) {
      if (stopRequested.current) break;
      const previous = states[candidate.key]?.state;
      if (previous && previous !== "waiting" && previous !== "error") continue; // schon erledigt

      setStates((s) => ({ ...s, [candidate.key]: { state: "running" } }));
      let result: BatchResult;
      try {
        result = await researchGrapesForWine(candidate.wineId, candidate.vintageYear);
      } catch {
        result = { status: "error", summary: "Verbindung unterbrochen." };
      }
      setStates((s) => ({ ...s, [candidate.key]: { state: result.status, summary: result.summary } }));
    }
    setRunning(false);
    setStopping(false);
    router.refresh();
  }

  if (candidates.length === 0) {
    return <p className="empty">Alle Weine haben bereits Prozentangaben oder manuelle Rebsorten. 🎉</p>;
  }

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row row-between">
          <strong>
            {finished.length} / {candidates.length} erledigt
          </strong>
          {running ? (
            <button type="button" className="btn btn-sm" onClick={() => {
                stopRequested.current = true;
                setStopping(true);
              }}>
              Anhalten
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={start}>
              {finished.length ? "Fortsetzen" : `Recherche für ${candidates.length} Weine starten`}
            </button>
          )}
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Fortschritt"
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        {finished.length > 0 && (
          <p className="muted small">
            {(Object.keys(counts) as RowState[])
              .map((s) => `${STATUS_ICON[s]} ${counts[s]} ${STATUS_LABEL[s]}`)
              .join(" · ")}
          </p>
        )}
        {running && stopping && (
          <p className="muted small">Wird nach dem laufenden Wein angehalten …</p>
        )}
        <p className="muted small">Pro Wein dauert die Recherche etwa 20–60 Sekunden. Die Seite muss offen bleiben.</p>
      </section>

      <ul className="batch-list">
        {candidates.map((c) => {
          const row = states[c.key] ?? { state: "waiting" as RowState };
          return (
            <li key={c.key} className="batch-item">
              <span aria-label={STATUS_LABEL[row.state]} title={STATUS_LABEL[row.state]}>
                {STATUS_ICON[row.state]}
              </span>
              <div className="item-main">
                <span className="item-producer">{c.producer}</span>
                <span className="item-title">
                  {c.name} {c.vintageYear ?? "o. J."}
                </span>
                {row.summary && <span className="item-meta">{row.summary}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="small">
        <Link href="/" className="link">
          ← Zum Bestand
        </Link>
      </p>
    </div>
  );
}
