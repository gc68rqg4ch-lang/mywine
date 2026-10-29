"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createAutosave, type AutosaveStatus } from "@/lib/edit/autosave";
import { emptySpiritAction, saveSpiritFill } from "../../actions";

/**
 * Spirituose: Karte „Aktuelle Flasche“ – Füllstand in 10-%-Schritten (speichert selbst, wie die
 * Notizen) und „Flasche leer“ mit Bestätigung (getrunken; die nächste volle wird aktuell mit
 * 100 %). 0 % auf dem Regler fragt ebenfalls „leer?“.
 */
export function SpiritBottle({ wineId, fill, bottles }: { wineId: string; fill: number | null; bottles: number }) {
  const router = useRouter();
  const start = Math.max(10, Math.round((fill ?? 100) / 10) * 10);
  const [value, setValue] = useState(start);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saver] = useState(() =>
    createAutosave({
      initial: String(start),
      normalize: (t) => t,
      delayMs: 600,
      onStatus: setStatus,
      save: async (text) => {
        const result = await saveSpiritFill(wineId, Number(text));
        if (!result.ok) throw new Error(result.error);
        return String(result.fill);
      },
    }),
  );
  useEffect(() => () => void saver.flush(), [saver]);

  const change = (next: number) => {
    setMessage(null);
    setError(null);
    if (next <= 0) {
      setAsking(true);
      return;
    }
    setValue(next);
    saver.change(String(next));
  };

  const empty = () =>
    startTransition(async () => {
      const result = await emptySpiritAction(wineId);
      setAsking(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      setValue(100);
      router.refresh();
    });

  return (
    <section className="card stack" aria-labelledby="aktuelle-flasche">
      <div className="row row-between">
        <h2 className="section-title" id="aktuelle-flasche">
          Aktuelle Flasche
        </h2>
        <span className="muted small">{bottles === 1 ? "1 Flasche im Bestand" : `${bottles} Flaschen im Bestand`}</span>
      </div>
      <label className="field">
        <span>
          Füllstand: <strong>{value} %</strong>
          <span className="muted small" role="status" aria-live="polite">
            {status === "saving" ? " · speichert …" : status === "saved" ? " · gespeichert" : status === "error" ? " · nicht gespeichert" : ""}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={value}
          onChange={(e) => change(Number(e.target.value))}
          aria-label="Füllstand der aktuellen Flasche"
        />
      </label>
      {asking ? (
        <div className="stack-sm">
          <p>Ist die aktuelle Flasche leer? Ich buche sie als getrunken{bottles > 1 ? " – die nächste wird aktuell (100 %)." : " – das ist die letzte."}</p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={empty}>
              {pending ? "Buche …" : "Ja, leer"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setAsking(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setAsking(true)}>
            Flasche leer
          </button>
        </div>
      )}
      {message && (
        <p className="notice notice-ok" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
