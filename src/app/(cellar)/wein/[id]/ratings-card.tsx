"use client";

import { useState, useTransition } from "react";
import { HalfStars } from "@/components/half-stars";
import { formatDate } from "@/lib/format";
import { setRating } from "../../tasting-actions";

export type PersonRating = {
  personId: string;
  name: string;
  rating: number | null;
  ratedAt: string | null;
};

export function PersonRatings({
  itemId,
  ratings,
  ownPersonId = null,
  editable = false,
}: {
  itemId: string;
  ratings: PersonRating[];
  /** Angemeldete Person: steht zuerst und ist markiert; die anderen bleiben bewertbar. */
  ownPersonId?: string | null;
  /** Bearbeiten-Modus: Bewertungen löschen (samt Verlauf, mit Rückfrage). */
  editable?: boolean;
}) {
  const ordered = [...ratings].sort((a, b) => Number(b.personId === ownPersonId) - Number(a.personId === ownPersonId));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistische Anzeige, bis die Seite neu geladen ist.
  const [local, setLocal] = useState<Record<string, number | null>>({});

  const update = (personId: string, rating: number | null) => {
    setError(null);
    setLocal((s) => ({ ...s, [personId]: rating }));
    startTransition(async () => {
      const result = await setRating(itemId, personId, rating);
      if (!result.ok) {
        setError(result.error);
        setLocal((s) => {
          const next = { ...s };
          delete next[personId];
          return next;
        });
      }
    });
  };

  return (
    <div className="stack">
      <h3 className="subsection-title">{ratings.map((r) => r.name).join(" & ") || "Personen"}</h3>
      {ratings.length === 0 ? (
        <p className="muted">Noch keine Personen erfasst.</p>
      ) : (
        <ul className="rating-list">
          {ordered.map((r) => {
            const value = r.personId in local ? local[r.personId] : r.rating;
            return (
              <li key={r.personId}>
                <span className="rating-name">
                  {r.name}
                  {r.personId === ownPersonId && <span className="muted small"> (du)</span>}
                </span>
                <HalfStars
                  value={value}
                  onChange={(v) => update(r.personId, v)}
                  disabled={pending}
                  label={`Bewertung ${r.name}`}
                />
                <span className="rating-value">
                  {value != null ? value.toLocaleString("de-CH") : "–"}
                </span>
                {editable && value != null && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (window.confirm(`Bewertung von ${r.name} löschen (auch frühere)?`)) update(r.personId, null);
                    }}
                    disabled={pending}
                    aria-label={`Bewertung von ${r.name} löschen`}
                    title="Bewertung löschen"
                  >
                    ✕
                  </button>
                )}
                {r.ratedAt && !(r.personId in local) && (
                  <span className="muted small rating-date">{formatDate(r.ratedAt)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">Subjektiv, halbe Sterne. Pro Person gilt die neueste Bewertung; ältere bleiben als Verlauf erhalten.</p>
    </div>
  );
}
