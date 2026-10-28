"use client";

import { useState, useTransition } from "react";
import { UnitButtons, useEditUnit } from "@/components/edit-unit";
import { RatingField } from "@/components/encounter-fields";
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
}: {
  itemId: string;
  ratings: PersonRating[];
  /** Angemeldete Person: steht zuerst und ist markiert; die anderen bleiben bewertbar. */
  ownPersonId?: string | null;
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
    </div>
  );
}

/**
 * Bewertungen bearbeiten (nach ✏️): je Person Sterne oder „keine“. Gelöschte Bewertungen
 * (auch frühere) erst nach Rückfrage. Gespeichert wird wie beim Antippen der Sterne.
 */
export function RatingsForm({ itemId, ratings }: { itemId: string; ratings: PersonRating[] }) {
  const unit = useEditUnit();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const changed = ratings.flatMap((r) => {
      const raw = String(data.get(`rating:${r.personId}`) ?? "");
      const next = raw === "" ? null : Number(raw);
      return next === r.rating ? [] : [{ ...r, next }];
    });
    const removed = changed.filter((c) => c.next == null).map((c) => c.name);
    if (removed.length && !window.confirm(`Bewertung von ${removed.join(" und ")} löschen (auch frühere)?`)) return;
    if (!changed.length) return unit?.close();
    setError(null);
    startTransition(async () => {
      for (const c of changed) {
        const result = await setRating(itemId, c.personId, c.next);
        if (!result.ok) return setError(result.error);
      }
      unit?.close("Bewertungen gespeichert.");
    });
  };

  return (
    <form onSubmit={submit} className="stack">
      {ratings.map((r) => (
        <RatingField key={r.personId} personId={r.personId} name={r.name} initial={r.rating} />
      ))}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <UnitButtons pending={pending} />
    </form>
  );
}
