"use client";

import { useActionState, useState } from "react";
import { formatMoney, priceDiscount } from "@/lib/format";
import { updatePrices, type ActionState } from "../../actions";

export type PriceInfo = {
  itemId: string;
  purchasePrice: number | null;
  regularPrice: number | null;
  currency: string | null;
};

function inputValue(price: number | null) {
  return price == null ? "" : price.toFixed(2);
}

/**
 * Kompakte Preiszeile einer Charge/Flasche: bezahlt, Normalpreis und Rabatt in %,
 * mit kleinem „Bearbeiten“ für beide Preise.
 */
export function PriceLine({ itemId, purchasePrice, regularPrice, currency }: PriceInfo) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await updatePrices(prev, formData);
      // Nach erfolgreichem Speichern die Ansicht wieder schliessen.
      if (result?.ok) setEditing(false);
      return result;
    },
    undefined,
  );
  const discount = priceDiscount(purchasePrice, regularPrice);

  if (editing) {
    return (
      <form action={action} className="stack-sm price-edit">
        <input type="hidden" name="itemId" value={itemId} />
        <div className="price-inputs">
          <label className="field">
            <span>Bezahlt (pro Flasche)</span>
            <input
              type="text"
              inputMode="decimal"
              name="purchasePrice"
              defaultValue={inputValue(purchasePrice)}
              placeholder="z. B. 24.50"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Normalpreis (pro Flasche)</span>
            <input
              type="text"
              inputMode="decimal"
              name="regularPrice"
              defaultValue={inputValue(regularPrice)}
              placeholder="leer = unbekannt"
              autoComplete="off"
            />
          </label>
        </div>
        {state?.error && (
          <p className="notice notice-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Wird gespeichert …" : "Speichern"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Abbrechen
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="price-line">
      <span>
        {purchasePrice == null && regularPrice == null ? (
          <span className="muted">Preis unbekannt</span>
        ) : (
          <>
            {formatMoney(purchasePrice, currency) ?? "–"}
            {regularPrice != null && (
              <span className="muted"> · normal {formatMoney(regularPrice, currency)}</span>
            )}
            {discount && (
              <span className={discount.amount > 0 ? "discount" : "muted"}>
                {" "}
                · {discount.amount > 0 ? "−" : "+"}
                {Math.abs(discount.percent).toLocaleString("de-CH")} %
              </span>
            )}
          </>
        )}
      </span>
      <button type="button" className="link-btn" onClick={() => setEditing(true)}>
        Bearbeiten
      </button>
      {state?.ok && (
        <span className="muted small" role="status">
          {state.ok}
        </span>
      )}
    </div>
  );
}
