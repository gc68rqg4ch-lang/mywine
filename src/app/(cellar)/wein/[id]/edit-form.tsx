"use client";

import { useActionState, type ReactNode } from "react";
import { saveEdit } from "../../edit-actions";

/**
 * Ein Bearbeiten-Formular der Weinseite: Felder kommen als children (vom Server
 * vorbelegt), gespeichert wird über das gemeinsame Bearbeiten-Modul. „Abbrechen“ setzt
 * die Felder zurück. Optional mit Rückfrage (Löschen, Zusammenführen).
 */
export function EditForm({
  hidden,
  children,
  submitLabel = "Speichern",
  confirm,
  mergeYears,
  danger = false,
  cancel = true,
}: {
  hidden: Record<string, string>;
  children?: ReactNode;
  submitLabel?: string;
  /** Rückfrage vor dem Speichern. */
  confirm?: string;
  /** Jahrgänge, die es schon gibt: Wird das Feld „to“ darauf gesetzt, kommt eine Rückfrage. */
  mergeYears?: string[];
  danger?: boolean;
  cancel?: boolean;
}) {
  const [state, action, pending] = useActionState(saveEdit, undefined);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const to = String(data.get("to") ?? "").trim();
    const merging = mergeYears?.find((y) => y.toLowerCase() === (to.toLowerCase() || "nv"));
    const question = merging
      ? `Jahrgang ${merging} gibt es schon. Beide zusammenführen? Vorhandene Angaben von ${merging} bleiben, leere werden ergänzt.`
      : confirm;
    if (question && !window.confirm(question)) event.preventDefault();
  };

  return (
    <form action={action} onSubmit={onSubmit} className="stack edit-form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && !pending && (
        <p className="notice notice-ok" role="status">
          {state.ok}
        </p>
      )}
      <div className="row">
        <button type="submit" className={danger ? "btn btn-danger btn-sm" : "btn btn-primary btn-sm"} disabled={pending}>
          {pending ? "Wird gespeichert …" : submitLabel}
        </button>
        {cancel && (
          <button type="reset" className="btn btn-ghost btn-sm" disabled={pending}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}
