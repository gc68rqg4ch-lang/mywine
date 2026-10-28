"use client";

import { useState } from "react";

/**
 * „Geschenk“ im Chargen-Formular: Häkchen und Wort als eine Einheit (das Label umschliesst die
 * Checkbox), daneben bzw. darunter „Geschenk von“ – nur sichtbar und aktiv, wenn angehakt.
 * Freiwillig: leer lassen ist erlaubt. Ohne Häkchen wird der Name nicht mitgeschickt.
 */
export function GiftField({ isGift, giftFrom }: { isGift: boolean; giftFrom: string | null }) {
  const [checked, setChecked] = useState(isGift);
  return (
    <div className="gift-field field-wide">
      <label className="gift-check">
        <input name="isGift" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>Geschenk</span>
      </label>
      {checked && (
        <label className="gift-from">
          <span className="muted">von</span>
          <input
            type="text"
            name="giftFrom"
            defaultValue={giftFrom ?? ""}
            placeholder="Name"
            aria-label="Geschenk von"
            maxLength={120}
            autoComplete="off"
          />
        </label>
      )}
    </div>
  );
}
