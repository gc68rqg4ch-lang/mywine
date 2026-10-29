"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { FillGauge } from "@/components/fill-gauge";
import { markDrunk, openBottle, updateFillLevel, type ActionState } from "../../actions";
import { PriceLine, type PriceInfo } from "./price-card";

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
  /** z. B. „Weinkeller · 6 Fl.“ */
  label: string;
  price: PriceInfo;
};

/**
 * Flasche öffnen: Charge (Lagerort, Anzahl, Preise) wählen; open_bottle bekommt deren
 * inventory_item-ID. Die Preis-Bearbeitung ist ein eigenes Formular je Charge, darum
 * hängen die Auswahlknöpfe per form-Attribut am Öffnen-Formular.
 */
export function OpenBottleForm({ charges, today }: { charges: Charge[]; today: string }) {
  const [state, action, pending] = useActionState(openBottle, undefined);
  const [fill, setFill] = useState(100);
  const [chargeId, setChargeId] = useState(charges[0]?.itemId ?? "");
  const formId = useId();
  if (!charges.length) return null;

  return (
    <div className="stack">
      <fieldset className="charge-list">
        <legend>{charges.length > 1 ? "Aus welcher Charge?" : "Charge"}</legend>
        {charges.map((c) => (
          <div key={c.itemId} className={c.itemId === chargeId ? "charge active" : "charge"}>
            <label className="charge-pick">
              <input
                type="radio"
                form={formId}
                name="itemId"
                value={c.itemId}
                checked={c.itemId === chargeId}
                onChange={() => setChargeId(c.itemId)}
              />
              <span>{c.label}</span>
            </label>
            <PriceLine {...c.price} />
          </div>
        ))}
      </fieldset>
      <form id={formId} action={action} className="stack">
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
    </div>
  );
}

export type OpenBottleInfo = {
  itemId: string;
  fillLevel: number | null;
  /** z. B. „Offen seit 12. Okt. 2026 (seit 15 Tagen) · Wohnzimmer“ */
  label: string;
};

/** Eine offene Flasche: Füllstand ändern oder als ausgetrunken markieren. */
export function OpenBottleControls({ bottle, price }: { bottle: OpenBottleInfo; /** Preis, Händler, Geschenk (vom Server). */ price?: ReactNode }) {
  const [fillState, fillAction, fillPending] = useActionState(updateFillLevel, undefined);
  const [drunkState, drunkAction, drunkPending] = useActionState(markDrunk, undefined);
  const [fill, setFill] = useState(bottle.fillLevel ?? 100);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="open-bottle">
      <div className="open-bottle-head">
        <FillGauge percent={bottle.fillLevel} />
        <div className="stack-sm">
          <span className="muted small">{bottle.label}</span>
          {price}
        </div>
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
