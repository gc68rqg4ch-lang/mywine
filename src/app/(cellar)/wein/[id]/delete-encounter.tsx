"use client";

import { useState, useTransition } from "react";
import { lastListUrl, markRestore } from "@/components/cellar/list-memory";
import { deleteWineAction } from "../../edit-actions";
import { EditForm } from "./edit-form";

/**
 * Eintrag „Verkostet“ löschen in zwei Schritten direkt in der Karte (statt Browser-Dialog):
 * erst „Eintrag löschen …“, dann ausdrücklich bestätigen. Bliebe der Wein danach leer zurück
 * (keine Flaschen, keine weiteren Bewertungen/Verkostungen), kommt die Frage, ob auch der Wein
 * weg soll: „Nur Eintrag“ / „Eintrag und Wein“ / „Abbrechen“.
 */
export function DeleteEncounter({
  encounterId,
  label,
  emptyWine = null,
}: {
  encounterId: string;
  label: string;
  /** Gesetzt, wenn der Wein nach dem Löschen leer zurückbliebe. */
  emptyWine?: { wineId: string; name: string; question: string } | null;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>
        Eintrag löschen …
      </button>
    );
  }

  const deleteWine = () => {
    if (!emptyWine) return;
    const data = new FormData();
    data.set("kind", "deleteWine");
    data.set("wineId", emptyWine.wineId);
    // Die Auswahl „Eintrag und Wein“ ist die Bestätigung – der Name wird nicht nochmals getippt.
    data.set("confirmName", emptyWine.name);
    data.set("back", lastListUrl("/verkostet") ?? "/verkostet");
    markRestore();
    setError(null);
    startTransition(async () => {
      const result = await deleteWineAction(data);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="stack-sm delete-confirm" role="alertdialog" aria-label="Eintrag löschen?">
      <p className="small">
        <strong>{label} wirklich löschen?</strong> Die Bewertungen dieses Eintrags werden mitgelöscht.
        {emptyWine ? <> <strong>{emptyWine.question}</strong></> : " Der Wein bleibt."}
      </p>
      <EditForm
        hidden={{ kind: "deleteEncounter", encounterId }}
        submitLabel={emptyWine ? "Nur Eintrag" : "Ja, endgültig löschen"}
        danger
        cancel={false}
      />
      {emptyWine && (
        <button type="button" className="btn btn-danger btn-sm" onClick={deleteWine} disabled={pending}>
          {pending ? "Wird gelöscht …" : "Eintrag und Wein"}
        </button>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} disabled={pending}>
        {emptyWine ? "Abbrechen" : "Nein, behalten"}
      </button>
    </div>
  );
}
