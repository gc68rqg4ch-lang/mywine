"use client";

import { useActionState } from "react";
import { researchTasteFromPage } from "../../research-actions";

/** „🔎 Geschmacksprofil recherchieren“ – nur das Profil; ohne Fund „Keine verlässlichen Angaben gefunden.“ */
export function TasteResearchButton({ wineId, year }: { wineId: string; year: number | null }) {
  const [state, action, pending] = useActionState(researchTasteFromPage, undefined);
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="wineId" value={wineId} />
      <input type="hidden" name="year" value={year == null ? "nv" : String(year)} />
      <div>
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {pending ? "Recherchiere …" : "🔎 Geschmacksprofil recherchieren"}
        </button>
      </div>
      {pending && (
        <p className="muted small" role="status">
          Ich suche Verkostungsnotizen zu genau diesem Wein – nur Belegtes kommt ins Profil. Das dauert etwa eine Minute.
        </p>
      )}
      {!pending && state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {!pending && state?.ok && (
        <p className="notice notice-ok" role="status">
          {state.ok}
        </p>
      )}
    </form>
  );
}
