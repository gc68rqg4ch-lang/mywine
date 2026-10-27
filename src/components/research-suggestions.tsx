"use client";

import { useState, useTransition } from "react";
import { acceptAllSuggestions, decideSuggestionAction } from "@/app/(cellar)/research-actions";

export type SuggestionRow = {
  id: string;
  label: string;
  current: string;
  suggested: string;
  sourceNote: string | null;
};

/**
 * „Ich habe Abweichungen gefunden“: pro Zeile Feld, „Deins → Recherche“, kurze Quelle,
 * [Übernehmen] [Behalten]; dazu „Alle übernehmen“. Übernehmen schreibt über das
 * gemeinsame Bearbeiten-Modul.
 */
export function ResearchSuggestions({ suggestions, title = "Ich habe Abweichungen gefunden" }: { suggestions: SuggestionRow[]; title?: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string } | undefined>();
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = (id: string, accept: boolean) => {
    setBusyId(id);
    startTransition(async () => {
      setMessage(await decideSuggestionAction(id, accept));
      setBusyId(null);
    });
  };
  const acceptAll = () => {
    setBusyId("all");
    startTransition(async () => {
      setMessage(await acceptAllSuggestions(suggestions.map((s) => s.id)));
      setBusyId(null);
    });
  };

  if (!suggestions.length) {
    return message?.ok ? <p className="muted small" role="status">{message.ok}</p> : null;
  }
  return (
    <div className="suggestions stack-sm">
      <div className="row row-between">
        <strong>🔎 {title}</strong>
        {suggestions.length > 1 && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={acceptAll}>
            {busyId === "all" ? "Übernehme …" : "Alle übernehmen"}
          </button>
        )}
      </div>
      <ul className="suggestion-list">
        {suggestions.map((s) => (
          <li key={s.id}>
            <div className="stack-sm">
              <span className="suggestion-field">{s.label}</span>
              <span>
                <span className="muted">Deins:</span> {s.current} <span aria-hidden>→</span>{" "}
                <span className="muted">Recherche:</span> <strong>{s.suggested}</strong>
              </span>
              {s.sourceNote && <span className="muted small">Quelle: {s.sourceNote}</span>}
            </div>
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide(s.id, true)}>
                {busyId === s.id ? "…" : "Übernehmen"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide(s.id, false)}>
                Behalten
              </button>
            </div>
          </li>
        ))}
      </ul>
      {message?.error && (
        <p className="notice notice-error" role="alert">
          {message.error}
        </p>
      )}
      {message?.ok && !pending && (
        <p className="muted small" role="status">
          {message.ok}
        </p>
      )}
    </div>
  );
}
