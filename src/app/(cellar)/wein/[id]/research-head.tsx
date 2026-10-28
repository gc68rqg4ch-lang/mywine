"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { researchWineFromHeader } from "../../research-actions";

/**
 * 🔎 neben dem Weinnamen: öffnet ein kleines Feld mit „Nachrecherchieren“ (gewählter Jahrgang,
 * inkl. Geschmacksprofil) und „Zuletzt recherchiert am …“. Während der Recherche dreht sich
 * das 🔎; danach eine kurze Meldung. Abweichungen erscheinen wie bisher in „Zum Wein“.
 */
export function ResearchHead({
  wineId,
  year,
  researchedOn,
}: {
  wineId: string;
  year: number | null;
  researchedOn: string | null;
}) {
  const [state, action, pending] = useActionState(
    researchWineFromHeader,
    undefined,
  );
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Antippen ausserhalb oder Escape schliesst das Feld (nicht während der Recherche).
  useEffect(() => {
    if (!open || pending) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, pending]);

  return (
    <div className="research-head" ref={box}>
      <button
        type="button"
        className={
          pending ? "research-head-btn is-spinning" : "research-head-btn"
        }
        aria-expanded={open}
        aria-label={pending ? "Recherche läuft" : "Recherche"}
        title={pending ? "Recherche läuft …" : "Recherche"}
        // Während der Recherche bleibt das Feld offen – danach steht dort die Meldung.
        onClick={() => !pending && setOpen((v) => !v)}
      >
        <span aria-hidden>🔎</span>
      </button>
      {/* Immer im DOM (nur versteckt), damit die laufende Recherche ihr Ergebnis zeigen kann. */}
      <form
        action={action}
        className="research-pop stack-sm"
        role="dialog"
        aria-label="Recherche"
        hidden={!open}
      >
        <input type="hidden" name="wineId" value={wineId} />
        <input
          type="hidden"
          name="year"
          value={year == null ? "nv" : String(year)}
        />
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={pending}
        >
          {pending ? "Recherchiere …" : "Nachrecherchieren"}
        </button>
        {pending ? (
          <p className="muted small" role="status">
            Ich ergänze leere Angaben und suche das Geschmacksprofil – das
            dauert etwa eine Minute.
          </p>
        ) : (
          state && (
            <p
              className={
                state.error ? "notice notice-error" : "research-result small"
              }
              role="status"
            >
              {state.error ?? state.ok}
            </p>
          )
        )}
        <p className="muted small">
          {researchedOn
            ? `Zuletzt recherchiert am ${researchedOn}`
            : "Noch nie recherchiert"}
        </p>
      </form>
    </div>
  );
}
