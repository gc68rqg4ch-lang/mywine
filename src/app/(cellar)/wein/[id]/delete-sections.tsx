"use client";

import { useActionState, useState, useTransition } from "react";
import { lastListUrl, markRestore } from "@/components/cellar/list-memory";
import { IRREVERSIBLE, deleteBottlesQuestion, nameConfirmed, type DeletableBottle } from "@/lib/edit/delete-text";
import { deleteWineAction, saveEdit } from "../../edit-actions";

/**
 * „🗑 Flaschen löschen“ bei einer Charge bzw. offenen/getrunkenen Flasche (falsch erfasst –
 * nicht getrunken). Anzahl wählbar (Standard 1), Warnung, dann „Abbrechen“ / „Löschen“.
 * Danach bleibt man auf der Weinseite.
 */
export function DeleteBottles({ itemId, bottle }: { itemId: string; bottle: DeletableBottle }) {
  const [asking, setAsking] = useState(false);
  const [count, setCount] = useState(1);
  const [state, action, pending] = useActionState(saveEdit, undefined);

  if (!asking) {
    return (
      <div className="delete-row">
        <button type="button" className="btn btn-ghost btn-sm delete-trigger" onClick={() => setAsking(true)}>
          🗑 Flaschen löschen
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="stack-sm delete-confirm" role="alertdialog" aria-label="Flaschen löschen?">
      <input type="hidden" name="kind" value="deleteBottles" />
      <input type="hidden" name="itemId" value={itemId} />
      {bottle.quantity > 1 && (
        <label className="field delete-count">
          <span>Wie viele Flaschen löschen?</span>
          <select name="count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {Array.from({ length: bottle.quantity }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === bottle.quantity ? `${n} (alle)` : n}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        <strong>{deleteBottlesQuestion(bottle, count)}</strong>
      </p>
      {state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)} disabled={pending}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-danger btn-sm" disabled={pending}>
          {pending ? "Wird gelöscht …" : "Löschen"}
        </button>
      </div>
    </form>
  );
}

/**
 * Gefahrenzone ganz unten: „🗑 Ganzen Wein löschen“. Zeigt, was alles verschwindet; erst wenn
 * der Weinname eingetippt ist, wird „Endgültig löschen“ aktiv. Danach zurück zur Liste
 * (gleicher Zustand wie vorher).
 */
export function DangerZone({ wineId, name, summary, back }: { wineId: string; name: string; summary: string; back: string }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ok = nameConfirmed(typed, name);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // Zurück zur Liste im gemerkten Zustand; die Server Action leitet direkt dorthin um.
    data.set("back", lastListUrl(back) ?? back);
    setError(null);
    markRestore();
    startTransition(async () => {
      const result = await deleteWineAction(data);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <section className="card stack danger-zone" aria-labelledby="gefahrenzone">
      <h2 className="section-title" id="gefahrenzone">
        Gefahrenzone
      </h2>
      {!asking ? (
        <div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setAsking(true)}>
            🗑 Ganzen Wein löschen
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="stack-sm" role="alertdialog" aria-label="Ganzen Wein löschen?">
          <input type="hidden" name="kind" value="deleteWine" />
          <input type="hidden" name="wineId" value={wineId} />
          <p>
            <strong>„{name}“ mit allem löschen?</strong> Es verschwindet: {summary}.
          </p>
          <p className="danger-text">{IRREVERSIBLE}</p>
          <label className="field">
            <span>Zur Bestätigung den Namen „{name}“ eintippen</span>
            <input type="text" name="confirmName" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAsking(false); setTyped(""); }} disabled={pending}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-danger btn-sm" disabled={!ok || pending}>
              {pending ? "Wird gelöscht …" : "Endgültig löschen"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
