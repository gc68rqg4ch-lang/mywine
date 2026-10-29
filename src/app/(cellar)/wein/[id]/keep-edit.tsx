"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveOpenKeepAction } from "../../actions";

/** Likörwein: Haltbarkeit offen („offen ca. 4 Wochen, Quelle: …“) – mit „ändern“ von Hand in Tagen. */
export function KeepEdit({ wineId, days, text }: { wineId: string; days: number | null; text: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(days ? String(days) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: number | null) =>
    startTransition(async () => {
      const result = await saveOpenKeepAction(wineId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    return (
      <span>
        {text ?? <span className="muted">noch unbekannt</span>}{" "}
        <button type="button" className="link-button small muted" onClick={() => setEditing(true)}>
          ändern
        </button>
      </span>
    );
  }
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650;
  return (
    <form
      className="row keep-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save(parsed);
      }}
    >
      <label className="row">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Haltbarkeit offen in Tagen"
          className="keep-days"
          autoFocus
        />
        <span>Tage</span>
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || pending}>
        Speichern
      </button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setEditing(false)}>
        Abbrechen
      </button>
      {error && (
        <span className="notice notice-error small" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
