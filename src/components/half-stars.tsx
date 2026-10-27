"use client";

/**
 * Sterne 0–5 in halben Schritten. Jede Sternhälfte ist eine eigene Schaltfläche
 * (links = x,5 / rechts = ganzer Stern). Ohne onChange nur Anzeige.
 */
export function HalfStars({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange?: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const v = value ?? 0;
  return (
    <span className="stars" role={onChange ? "group" : "img"} aria-label={`${label}: ${value ?? "keine"} von 5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = v >= star ? 100 : v >= star - 0.5 ? 50 : 0;
        return (
          <span key={star} className="star">
            <span className="star-base" aria-hidden>
              ★
            </span>
            <span className="star-fill" style={{ width: `${fill}%` }} aria-hidden>
              ★
            </span>
            {onChange && (
              <>
                <button
                  type="button"
                  className="star-hit star-hit-left"
                  disabled={disabled}
                  onClick={() => onChange(star - 0.5)}
                  aria-label={`${(star - 0.5).toLocaleString("de-CH")} Sterne`}
                />
                <button
                  type="button"
                  className="star-hit star-hit-right"
                  disabled={disabled}
                  onClick={() => onChange(star)}
                  aria-label={`${star} ${star === 1 ? "Stern" : "Sterne"}`}
                />
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}
