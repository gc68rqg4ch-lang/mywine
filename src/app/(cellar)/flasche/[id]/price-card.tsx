"use client";

import { useActionState, useState } from "react";
import { formatMoney, priceDiscount } from "@/lib/format";
import { updatePrices, type ActionState } from "../../actions";

function inputValue(price: number | null) {
  return price == null ? "" : price.toFixed(2);
}

export function PriceCard({
  itemId,
  purchasePrice,
  regularPrice,
  currency,
}: {
  itemId: string;
  purchasePrice: number | null;
  regularPrice: number | null;
  currency: string | null;
}) {
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

  return (
    <section className="card stack">
      <div className="row row-between">
        <h2 className="section-title">Preise</h2>
        {!editing && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
        )}
      </div>

      {editing ? (
        <form action={action} className="stack">
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
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Wird gespeichert …" : "Preise speichern"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <dl className="details">
          <dt>Bezahlt</dt>
          <dd>{formatMoney(purchasePrice, currency) ?? "–"}</dd>
          <dt>Normalpreis</dt>
          <dd>{formatMoney(regularPrice, currency) ?? "–"}</dd>
          {discount && (
            <>
              <dt>{discount.amount > 0 ? "Rabatt" : "Aufpreis"}</dt>
              <dd className={discount.amount > 0 ? "discount" : undefined}>
                {formatMoney(Math.abs(discount.amount), currency)} (
                {Math.abs(discount.percent).toLocaleString("de-CH")} %)
              </dd>
            </>
          )}
        </dl>
      )}

      {!editing && state?.ok && (
        <p className="notice notice-ok" role="status">
          {state.ok}
        </p>
      )}
    </section>
  );
}
