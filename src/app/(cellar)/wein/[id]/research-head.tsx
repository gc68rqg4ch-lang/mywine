"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { researchWineFromHeader } from "../../research-actions";

/**
 * 🔎 neben dem Weinnamen: öffnet ein kleines Feld mit „Nachrecherchieren“ (gewählter Jahrgang,
 * inkl. Geschmacksprofil) und „Zuletzt recherchiert am …“. Während der Recherche dreht sich
 * das 🔎; danach eine kurze Meldung. Abweichungen erscheinen wie bisher in „Zum Wein“.
 * Im Hintergrund (Warteschlange): „Recherche läuft …“, solange ein Auftrag offen ist (auch nach
 * dem Schliessen und Wiederöffnen der Seite); die Seite lädt dann alle 20 s neu, bis er fertig ist.
 */
export function ResearchHead({
  wineId,
  year,
  researchedOn,
  running = false,
}: {
  wineId: string;
  year: number | null;
  researchedOn: string | null;
  /** Auftrag im Hintergrund offen (Warteschlange). */
  running?: boolean;
}) {
  const [state, action, submitting] = useActionState(
    researchWineFromHeader,
    undefined,
  );
  const router = useRouter();
  const pending = submitting || running;
  // Hintergrund: Ergebnisse erscheinen, sobald der Auftrag fertig ist.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [running, router]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Antippen ausserhalb oder Escape schliesst das Feld (nicht während der Recherche).
  useEffect(() => {
    if (!open || submitting) return;
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
  }, [open, submitting]);

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
        onClick={() => !submitting && setOpen((v) => !v)}
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
          {pending ? "Recherche läuft …" : "Nachrecherchieren"}
        </button>
        {running ? (
          <p className="muted small" role="status">
            Recherche läuft im Hintergrund – du kannst die Seite schliessen.
            Die Ergebnisse erscheinen hier, sobald sie fertig ist.
          </p>
        ) : submitting ? (
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
