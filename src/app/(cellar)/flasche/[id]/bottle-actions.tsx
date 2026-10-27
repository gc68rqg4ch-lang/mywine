"use client";

import { useActionState, useState } from "react";
import { markDrunk, openBottle, updateFillLevel, type ActionState } from "../../actions";

function Feedback({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p className="notice notice-error" role="alert">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p className="notice notice-ok" role="status">
        {state.ok}
      </p>
    );
  return null;
}

function FillSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stack-sm">
      <label className="field">
        <span>
          Füllstand: <strong>{value} %</strong>
        </span>
        <input
          type="range"
          name="fillLevel"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
      <div className="chips" role="group" aria-label="Schnellauswahl Füllstand">
        {[100, 75, 50, 25, 10].map((v) => (
          <button
            key={v}
            type="button"
            className={v === value ? "chip active" : "chip"}
            onClick={() => onChange(v)}
          >
            {v} %
          </button>
        ))}
      </div>
    </div>
  );
}

export function OpenBottleForm({
  itemId,
  quantity,
  today,
}: {
  itemId: string;
  quantity: number;
  today: string;
}) {
  const [state, action, pending] = useActionState(openBottle, undefined);
  const [fill, setFill] = useState(100);

  return (
    <form action={action} className="card stack">
      <h2 className="section-title">Flasche öffnen</h2>
      <p className="muted">
        {quantity > 1
          ? `Eine von ${quantity} Flaschen wird geöffnet und erscheint danach unter „Offen“.`
          : "Das ist die letzte Flasche dieser Position."}
      </p>
      <input type="hidden" name="itemId" value={itemId} />
      <FillSlider value={fill} onChange={setFill} />
      <label className="field">
        <span>Geöffnet am</span>
        <input type="date" name="dateOpened" defaultValue={today} max={today} required />
      </label>
      <Feedback state={state} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Wird geöffnet …" : "Flasche öffnen"}
      </button>
    </form>
  );
}

export function OpenBottleControls({
  itemId,
  fillLevel,
}: {
  itemId: string;
  fillLevel: number | null;
}) {
  const [fillState, fillAction, fillPending] = useActionState(updateFillLevel, undefined);
  const [drunkState, drunkAction, drunkPending] = useActionState(markDrunk, undefined);
  const [fill, setFill] = useState(fillLevel ?? 100);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="stack">
      <form action={fillAction} className="card stack">
        <h2 className="section-title">Füllstand ändern</h2>
        <input type="hidden" name="itemId" value={itemId} />
        <FillSlider value={fill} onChange={setFill} />
        <Feedback state={fillState} />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={fillPending || fill === fillLevel}
        >
          {fillPending ? "Wird gespeichert …" : "Füllstand speichern"}
        </button>
      </form>

      <form action={drunkAction} className="card stack">
        <h2 className="section-title">Ausgetrunken?</h2>
        <input type="hidden" name="itemId" value={itemId} />
        <Feedback state={drunkState} />
        {confirming ? (
          <div className="row">
            <button type="submit" className="btn btn-danger" disabled={drunkPending}>
              {drunkPending ? "Wird gespeichert …" : "Ja, ausgetrunken"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Als ausgetrunken markieren
          </button>
        )}
      </form>
    </div>
  );
}
