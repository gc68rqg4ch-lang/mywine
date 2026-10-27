"use client";

import { useActionState, useState } from "react";
import { FillGauge } from "@/components/fill-gauge";
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

export type Charge = {
  itemId: string;
  /** z. B. „Weinkeller · 6 Fl. · CHF 24.50“ */
  label: string;
};

/** Flasche öffnen: Lagerort bzw. Charge wählen; open_bottle bekommt deren inventory_item-ID. */
export function OpenBottleForm({ charges, today }: { charges: Charge[]; today: string }) {
  const [state, action, pending] = useActionState(openBottle, undefined);
  const [fill, setFill] = useState(100);
  const [chargeId, setChargeId] = useState(charges[0]?.itemId ?? "");
  if (!charges.length) return null;

  return (
    <form action={action} className="stack">
      <h3 className="subsection-title">Flasche öffnen</h3>
      {charges.length > 1 ? (
        <fieldset className="choice-list">
          <legend>Aus welchem Lagerort?</legend>
          {charges.map((c) => (
            <label key={c.itemId} className={c.itemId === chargeId ? "choice active" : "choice"}>
              <input
                type="radio"
                name="itemId"
                value={c.itemId}
                checked={c.itemId === chargeId}
                onChange={() => setChargeId(c.itemId)}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="itemId" value={charges[0].itemId} />
          <p className="muted">Aus: {charges[0].label}</p>
        </>
      )}
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

export type OpenBottleInfo = {
  itemId: string;
  fillLevel: number | null;
  /** z. B. „Offen seit 12. Okt. 2026 (seit 15 Tagen) · Wohnzimmer“ */
  label: string;
};

/** Eine offene Flasche: Füllstand ändern oder als ausgetrunken markieren. */
export function OpenBottleControls({ bottle }: { bottle: OpenBottleInfo }) {
  const [fillState, fillAction, fillPending] = useActionState(updateFillLevel, undefined);
  const [drunkState, drunkAction, drunkPending] = useActionState(markDrunk, undefined);
  const [fill, setFill] = useState(bottle.fillLevel ?? 100);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="open-bottle">
      <div className="open-bottle-head">
        <FillGauge percent={bottle.fillLevel} />
        <span className="muted small">{bottle.label}</span>
      </div>
      <form action={fillAction} className="stack-sm">
        <input type="hidden" name="itemId" value={bottle.itemId} />
        <FillSlider value={fill} onChange={setFill} />
        <Feedback state={fillState} />
        <button type="submit" className="btn btn-primary" disabled={fillPending || fill === bottle.fillLevel}>
          {fillPending ? "Wird gespeichert …" : "Füllstand speichern"}
        </button>
      </form>
      <form action={drunkAction} className="stack-sm">
        <input type="hidden" name="itemId" value={bottle.itemId} />
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
