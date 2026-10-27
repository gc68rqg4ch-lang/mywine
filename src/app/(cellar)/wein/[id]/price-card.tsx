import { formatMoney, priceDiscount } from "@/lib/format";

export type PriceInfo = {
  itemId: string;
  purchasePrice: number | null;
  regularPrice: number | null;
  currency: string | null;
};

/**
 * Kompakte Preiszeile einer Charge/Flasche: bezahlt, Normalpreis und Rabatt in %.
 * Geändert werden die Preise im Bearbeiten-Modus der Weinseite (je Charge).
 */
export function PriceLine({ purchasePrice, regularPrice, currency }: PriceInfo) {
  const discount = priceDiscount(purchasePrice, regularPrice);
  return (
    <div className="price-line">
      <span>
        {purchasePrice == null && regularPrice == null ? (
          <span className="muted">Preis unbekannt</span>
        ) : (
          <>
            {formatMoney(purchasePrice, currency) ?? "–"}
            {regularPrice != null && <span className="muted"> · normal {formatMoney(regularPrice, currency)}</span>}
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
    </div>
  );
}
