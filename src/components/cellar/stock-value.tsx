import { formatMoney } from "@/lib/format";

/**
 * Bestandswert in der Karte „Bestand“: bezahlt und Normalpreis je auf einer eigenen Zeile (nie
 * abgeschnitten). „Normalpreis“ ausgeschrieben, in einer schmalen Karte „normal“.
 */
export function StockValue({ paid, regular }: { paid: number; regular: number }) {
  return (
    <div className="tile-amounts">
      <p className="tile-line tile-amount muted"><span className="amount">{formatMoney(paid, "CHF", { whole: true })}</span> bezahlt</p>
      {regular !== paid && (
        <p className="tile-line tile-amount muted">
          <span className="amount">{formatMoney(regular, "CHF", { whole: true })}</span> <span className="amount-long">Normalpreis</span>
          <span className="amount-short">normal</span>
        </p>
      )}
    </div>
  );
}
