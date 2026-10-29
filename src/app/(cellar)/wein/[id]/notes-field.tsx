"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createAutosave, type AutosaveStatus } from "@/lib/edit/autosave";
import { MAX_WINE_NOTES, cleanNotes } from "@/lib/edit/notes";
import { saveWineNotes } from "../../actions";

/**
 * Notizen zum Wein: immer ein Freitextfeld (kein ✏️, keine „offene Bearbeitung“). Speichert
 * automatisch nach 1 s Pause und beim Verlassen des Felds bzw. der Seite – ohne Neuladen, der
 * Cursor bleibt im Feld. Das Feld wächst mit dem Text. Bei einem Fehler bleibt der Text stehen.
 */
export function NotesField({ wineId, notes }: { wineId: string; notes: string | null }) {
  const [text, setText] = useState(notes ?? "");
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  const [saver] = useState(() =>
    createAutosave({
      initial: notes,
      normalize: cleanNotes,
      onStatus: setStatus,
      save: async (value) => {
        const result = await saveWineNotes(wineId, value);
        if (!result.ok) throw new Error(result.error);
        return result.notes;
      },
    }),
  );

  // Mitwachsen statt Scrollbox: Höhe nach dem Inhalt.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Seite verlassen: sofort speichern; ist noch etwas offen, fragt der Browser beim Schliessen nach.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (!saver.dirty()) return;
      void saver.flush();
      e.preventDefault();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", unload);
      // Wegnavigieren innerhalb der App (Link): noch Offenes speichern.
      void saver.flush();
    };
  }, [saver]);

  return (
    <div className="notes-field">
      <label className="sr-only" htmlFor={`notes-${wineId}`}>
        Notizen
      </label>
      <textarea
        id={`notes-${wineId}`}
        ref={area}
        rows={2}
        value={text}
        maxLength={MAX_WINE_NOTES}
        placeholder="Notiz zum Wein …"
        onChange={(e) => {
          setText(e.target.value);
          saver.change(e.target.value);
        }}
        onBlur={() => void saver.flush()}
      />
      <p className={status === "error" ? "notes-status notes-status-error" : "notes-status"} role="status" aria-live="polite">
        {status === "saving" && "Speichert …"}
        {status === "saved" && "Gespeichert"}
        {status === "error" && (
          <>
            Nicht gespeichert –{" "}
            <button type="button" className="link-button" onClick={() => void saver.flush()}>
              nochmals versuchen
            </button>
          </>
        )}
      </p>
    </div>
  );
}
