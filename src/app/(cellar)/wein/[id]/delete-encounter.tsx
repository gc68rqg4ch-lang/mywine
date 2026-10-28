"use client";

import { useState } from "react";
import { EditForm } from "./edit-form";

/**
 * Eintrag „Verkostet“ löschen in zwei Schritten direkt in der Karte (statt Browser-Dialog):
 * erst „Eintrag löschen …“, dann ausdrücklich „Ja, endgültig löschen“.
 */
export function DeleteEncounter({ encounterId, label }: { encounterId: string; label: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>
        Eintrag löschen …
      </button>
    );
  }
  return (
    <div className="stack-sm delete-confirm" role="alertdialog" aria-label="Eintrag löschen?">
      <p className="small">
        <strong>{label} wirklich löschen?</strong> Die Bewertungen dieses Eintrags werden mitgelöscht. Der Wein bleibt.
      </p>
      <EditForm hidden={{ kind: "deleteEncounter", encounterId }} submitLabel="Ja, endgültig löschen" danger cancel={false} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
        Nein, behalten
      </button>
    </div>
  );
}
