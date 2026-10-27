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

export function RatingsCard({
  itemId,
  ratings,
  today,
}: {
  itemId: string;
  ratings: PersonRating[];
  today: string;
}) {
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
    <section className="card stack">
      <h2 className="section-title">Bewertung</h2>
      {ratings.length === 0 ? (
        <p className="muted">Noch keine Personen erfasst.</p>
      ) : (
        <ul className="rating-list">
          {ratings.map((r) => {
            const value = r.personId in local ? local[r.personId] : r.rating;
            return (
              <li key={r.personId}>
                <span className="rating-name">{r.name}</span>
                <HalfStars
                  value={value}
                  onChange={(v) => update(r.personId, v)}
                  disabled={pending}
                  label={`Bewertung ${r.name}`}
                />
                <span className="rating-value">
                  {value != null ? value.toLocaleString("de-CH") : "–"}
                </span>
                {value != null && (r.personId in local || r.ratedAt === today) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => update(r.personId, null)}
                    disabled={pending}
                    aria-label={`Heutige Bewertung von ${r.name} entfernen`}
                    title="Heutige Bewertung entfernen"
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
      <p className="muted small">Pro Person gilt die neueste Bewertung; ältere bleiben als Verlauf erhalten.</p>
    </section>
  );
}
