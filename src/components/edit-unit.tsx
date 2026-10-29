"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NO_UNIT, closeUnit, markDirty, openUnit, type UnitsState } from "@/lib/cellar/wine-units";

type Units = {
  state: UnitsState;
  open: (id: string, label: string) => void;
  close: (id: string, flash?: string) => void;
  dirty: (id: string) => void;
};
const UnitsContext = createContext<Units | null>(null);

/** Klammer um die Weinseite: hält fest, welche Einheit gerade bearbeitet wird (höchstens eine). */
export function EditUnits({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UnitsState>(NO_UNIT);
  // Rückfrage ausserhalb des State-Updaters (der darf keine Nebenwirkungen haben).
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  }, [state]);
  const open = useCallback((id: string, label: string) => {
    const next = openUnit(current.current, { id, label }, (q) => window.confirm(q));
    current.current = next;
    setState(next);
  }, []);
  const close = useCallback((id: string, flash?: string) => {
    // iPad: Fokus (Tastatur) vor dem Entfernen des Formulars lösen. Verschwindet das fokussierte
    // Feld einfach, bleibt Safari teils verschoben – der nächste Tipp (z. B. „← Bestand“) geht ins Leere.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(`[data-unit="${CSS.escape(id)}"]`)) active.blur();
    setState((s) => closeUnit(s, id, flash));
  }, []);
  const dirty = useCallback((id: string) => setState((s) => markDirty(s, id)), []);

  // Ungespeicherte Änderungen: auch beim Verlassen der Seite nachfragen.
  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  const value = useMemo(() => ({ state, open, close, dirty }), [state, open, close, dirty]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

type Unit = {
  id: string;
  close: (flash?: string) => void;
  markDirty: () => void;
};
const UnitContext = createContext<Unit | null>(null);

/** Innerhalb des Formulars einer Einheit: schliessen (Abbrechen/gespeichert) und „geändert“ melden. */
export function useEditUnit() {
  return useContext(UnitContext);
}

/**
 * Eine bearbeitbare Einheit: Anzeige mit kleinem ✏️ oben rechts; Antippen macht nur diese
 * Einheit zum Formular (an Ort und Stelle). Titel bleibt stehen.
 */
export function EditUnit({
  id,
  label,
  title,
  form,
  children,
  as: Tag = "div",
  className = "",
}: {
  id: string;
  /** Für ✏️ („… bearbeiten“) und die Rückfrage beim Wechsel. */
  label: string;
  title?: ReactNode;
  /** Ohne Formular: kein ✏️ (z. B. Rebsorten ohne Flasche, an der sie hängen). */
  form?: ReactNode;
  children?: ReactNode;
  as?: "div" | "section" | "li";
  className?: string;
}) {
  const units = useContext(UnitsContext);
  const close = units?.close;
  const dirty = units?.dirty;
  const unit = useMemo<Unit>(
    () => ({
      id,
      close: (text) => close?.(id, text),
      markDirty: () => dirty?.(id),
    }),
    [id, close, dirty],
  );
  if (!units) throw new Error("EditUnit braucht <EditUnits>.");
  const isOpen = units.state.open?.id === id;
  const flash = units.state.flash?.id === id ? units.state.flash.text : null;

  const pencil = !isOpen && form != null && (
    <button
      type="button"
      className="unit-pencil"
      aria-label={`${label} bearbeiten`}
      title={`${label} bearbeiten`}
      onClick={() => units.open(id, label)}
    >
      ✏️
    </button>
  );

  return (
    <Tag className={`edit-unit ${isOpen ? "is-editing" : ""} ${className}`.trim()} data-unit={id}>
      {title != null ? (
        <div className="unit-head">
          <div className="unit-title">{title}</div>
          {pencil}
        </div>
      ) : (
        pencil
      )}
      {isOpen ? (
        <UnitContext.Provider value={unit}>
          <div className="unit-form stack" onInput={unit.markDirty} onChange={unit.markDirty}>
            {form}
          </div>
        </UnitContext.Provider>
      ) : (
        <>
          {flash && (
            <p className="notice notice-ok" role="status">
              {flash}
            </p>
          )}
          {children}
        </>
      )}
    </Tag>
  );
}

/** Unten im Formular genau ein Paar „Speichern“ / „Abbrechen“. */
export function UnitButtons({
  pending,
  onCancel,
  submitLabel = "Speichern",
}: {
  pending: boolean;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const unit = useEditUnit();
  return (
    <div className="row unit-buttons">
      <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
        {pending ? "Wird gespeichert …" : submitLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={onCancel ?? (() => unit?.close())}
      >
        Abbrechen
      </button>
    </div>
  );
}
