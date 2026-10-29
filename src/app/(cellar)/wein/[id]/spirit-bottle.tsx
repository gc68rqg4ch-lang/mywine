"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createAutosave, type AutosaveStatus } from "@/lib/edit/autosave";
import { emptySpiritAction, openBottle, saveSpiritFill } from "../../actions";

/**
 * Spirituose: Karte „Offene Flasche“ – Öffnungsdatum, Füllstand in 10-%-Schritten (speichert selbst,
 * wie die Notizen) und „Flasche leer“ mit Bestätigung (getrunken; es rückt keine Flasche nach).
 * 0 % auf dem Regler fragt ebenfalls „leer?“. keep: bei Likören „offen gut bis …“.
 */
export function SpiritBottle({
  wineId,
  itemId,
  fill,
  openedOn,
  keep,
}: {
  wineId: string;
  itemId: string;
  fill: number | null;
  /** „Geöffnet am 12. Aug. 2026 · Keller“ */
  openedOn: string | null;
  keep?: ReactNode;
}) {
  const router = useRouter();
  const start = Math.max(10, Math.round((fill ?? 100) / 10) * 10);
  const [value, setValue] = useState(start);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saver] = useState(() =>
    createAutosave({
      initial: String(start),
      normalize: (t) => t,
      delayMs: 600,
      onStatus: setStatus,
      save: async (text) => {
        const result = await saveSpiritFill(wineId, itemId, Number(text));
        if (!result.ok) throw new Error(result.error);
        return String(result.fill);
      },
    }),
  );
  useEffect(() => () => void saver.flush(), [saver]);

  const change = (next: number) => {
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
      const result = await emptySpiritAction(wineId, itemId);
      setAsking(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });

  return (
    <section className="card stack" aria-label="Offene Flasche">
      <div className="row row-between">
        <h2 className="section-title">Offene Flasche</h2>
        {openedOn && <span className="muted small">{openedOn}</span>}
      </div>
      {keep && <p className="small">{keep}</p>}
      <label className="field">
        <span>
          Füllstand: <strong>{value} %</strong>
          <span className="muted small" role="status" aria-live="polite">
            {status === "saving" ? " · speichert …" : status === "saved" ? " · gespeichert" : status === "error" ? " · nicht gespeichert" : ""}
          </span>
        </span>
        <input type="range" min={0} max={100} step={10} value={value} onChange={(e) => change(Number(e.target.value))} aria-label="Füllstand der offenen Flasche" />
      </label>
      {asking ? (
        <div className="stack-sm">
          <p>Ist die Flasche leer? Ich buche sie als getrunken.</p>
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
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Spirituose: „Flasche öffnen“ (heute, 100 %). Ist schon eine offen, erst nachfragen: „Es ist schon
 * eine offen (~40 %). Trotzdem eine weitere öffnen?“. Mehrere Chargen: Auswahl des Lagerorts.
 */
export function SpiritOpen({ charges, openFill }: { charges: { itemId: string; label: string }[]; openFill: number | null | undefined }) {
  const [batch, setBatch] = useState(charges[0]?.itemId ?? "");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const alreadyOpen = openFill !== undefined;

  const open = () =>
    startTransition(async () => {
      const form = new FormData();
      form.set("itemId", batch);
      // Leitet nach dem Öffnen auf die Weinseite weiter; nur ein Fehler kommt zurück.
      const result = await openBottle(undefined, form);
      if (result?.error) setError(result.error);
      setAsking(false);
    });

  return (
    <section className="card stack-sm" aria-label="Flasche öffnen">
      {charges.length > 1 && (
        <label className="field">
          <span>Aus</span>
          <select value={batch} onChange={(e) => setBatch(e.target.value)}>
            {charges.map((c) => (
              <option key={c.itemId} value={c.itemId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {asking ? (
        <div className="stack-sm">
          <p>Es ist schon eine offen{openFill != null ? ` (~${openFill} %)` : ""}. Trotzdem eine weitere öffnen?</p>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={open}>
              {pending ? "Öffne …" : "Ja, öffnen"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setAsking(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className={alreadyOpen ? "btn btn-sm" : "btn btn-sm btn-primary"} disabled={pending || !batch} onClick={() => (alreadyOpen ? setAsking(true) : open())}>
            {pending ? "Öffne …" : alreadyOpen ? "Weitere Flasche öffnen" : "🍾 Flasche öffnen"}
          </button>
        </div>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
