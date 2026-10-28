"use client";

// Felder eines Eintrags „Verkostet“ – gemeinsam für Erfassen (/verkostet/neu) und Bearbeiten
// auf der Weinseite. Die Namen passen zu src/lib/edit/form.ts (addEncounter / encounter).

import { useEffect, useRef, useState, type RefObject } from "react";
import { HalfStars } from "@/components/half-stars";
import { CURRENCIES, PLACE_KINDS, PLACE_KIND_LABELS, PRICE_UNITS, PRICE_UNIT_LABELS } from "@/lib/edit/types";

/** „Abbrechen“ (Formular zurücksetzen) setzt auch den Zustand dieser Felder zurück. */
function useFormReset(ref: RefObject<HTMLElement | null>, reset: () => void) {
  const latest = useRef(reset);
  useEffect(() => {
    latest.current = reset;
  });
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    // Erst nach dem Zurücksetzen durch den Browser (sonst überschreibt er z. B. die Ortswahl wieder).
    const onReset = () => setTimeout(() => latest.current(), 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [ref]);
}

export type PlaceOption = { id: string; name: string; kind: string | null; city: string | null };

export type EncounterValues = {
  year: number | null;
  tastedOn: string;
  placeId: string | null;
  price: number | null;
  priceUnit: string | null;
  currency: string;
  occasion: string | null;
  companions: string | null;
  note: string | null;
};

/** Jahrgang (Pflicht) mit „Ohne Jahrgang (NV)“. */
export function VintageField({ initial, required = true }: { initial?: number | null | "unset"; required?: boolean }) {
  const [nv, setNv] = useState(initial === null);
  const ref = useRef<HTMLDivElement>(null);
  useFormReset(ref, () => setNv(initial === null));
  return (
    <div className="edit-grid" ref={ref}>
      <label className="field">
        <span>Jahrgang</span>
        <input
          type="text"
          name="year"
          inputMode="numeric"
          autoComplete="off"
          placeholder="z. B. 2019"
          defaultValue={typeof initial === "number" ? String(initial) : ""}
          disabled={nv}
          required={required && !nv}
        />
      </label>
      <label className="field field-check">
        <input type="checkbox" name="nv" checked={nv} onChange={(e) => setNv(e.target.checked)} />
        <span>Ohne Jahrgang (NV)</span>
      </label>
    </div>
  );
}

/** Datum (Standard heute, nicht in der Zukunft). */
export function DateField({ value, today }: { value: string; today: string }) {
  return (
    <label className="field">
      <span>Verkostet am</span>
      <input type="date" name="tastedOn" defaultValue={value} max={today} required />
    </label>
  );
}

/** Ort: bestehenden wählen oder neu mit Art und Stadt. */
export function PlaceField({ placeId, places }: { placeId: string | null; places: PlaceOption[] }) {
  const [place, setPlace] = useState(placeId ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useFormReset(ref, () => setPlace(placeId ?? ""));
  return (
    <div className="stack-sm field-wide" ref={ref}>
      <label className="field">
        <span>Ort</span>
        <select name="place" value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">– ohne Ort –</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.city ? ` (${p.city})` : ""}
            </option>
          ))}
          <option value="new">➕ Neuer Ort …</option>
        </select>
      </label>
      {place === "new" && (
        <div className="edit-grid encounter-new-place">
          <label className="field">
            <span>Name des Orts</span>
            <input type="text" name="placeName" required autoComplete="off" placeholder="z. B. Kronenhalle" />
          </label>
          <label className="field">
            <span>Art</span>
            <select name="placeKind" defaultValue="restaurant">
              <option value="">–</option>
              {PLACE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PLACE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ort / Stadt</span>
            <input type="text" name="placeCity" autoComplete="off" placeholder="z. B. Zürich" />
          </label>
        </div>
      )}
    </div>
  );
}

/** Preis mit Flasche/Glas und Währung. */
export function PriceFields({ price, priceUnit, currency }: { price: number | null; priceUnit: string | null; currency: string }) {
  return (
    <>
      <label className="field">
        <span>Preis</span>
        <input type="text" name="price" inputMode="decimal" autoComplete="off" defaultValue={price == null ? "" : price.toFixed(2)} />
      </label>
      <label className="field">
        <span>pro</span>
        <select name="priceUnit" defaultValue={priceUnit ?? "bottle"}>
          {PRICE_UNITS.map((u) => (
            <option key={u} value={u}>
              {PRICE_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Währung</span>
        <select name="currency" defaultValue={currency}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function TextField({ name, label, value, placeholder }: { name: string; label: string; value?: string | null; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" name={name} defaultValue={value ?? ""} autoComplete="off" placeholder={placeholder} />
    </label>
  );
}

export function NoteField({ value }: { value?: string | null }) {
  return (
    <label className="field field-wide">
      <span>Notiz</span>
      <textarea name="note" rows={3} defaultValue={value ?? ""} />
    </label>
  );
}

/** Alle Angaben eines Eintrags (Bearbeiten auf der Weinseite). */
export function EncounterFields({
  values,
  places,
  today,
}: {
  values: EncounterValues;
  places: PlaceOption[];
  today: string;
}) {
  return (
    <div className="edit-grid">
      <DateField value={values.tastedOn} today={today} />
      <PlaceField placeId={values.placeId} places={places} />
      <PriceFields price={values.price} priceUnit={values.priceUnit} currency={values.currency} />
      <TextField name="occasion" label="Anlass" value={values.occasion} placeholder="z. B. Geburtstag" />
      <TextField name="companions" label="Begleitung" value={values.companions} placeholder="mit wem?" />
      <NoteField value={values.note} />
    </div>
  );
}

/** Sterne 0–5 in halben Schritten als Formularfeld „rating:<personId>“ (leer = keine). */
export function RatingField({ personId, name, initial = null }: { personId: string; name: string; initial?: number | null }) {
  const [value, setValue] = useState<number | null>(initial);
  const ref = useRef<HTMLDivElement>(null);
  useFormReset(ref, () => setValue(initial));
  return (
    <div className="rating-field" ref={ref}>
      <span className="rating-field-name">{name}</span>
      <HalfStars value={value} onChange={setValue} label={`Bewertung ${name}`} />
      <input type="hidden" name={`rating:${personId}`} value={value == null ? "" : String(value)} />
      {value != null && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValue(null)}>
          keine
        </button>
      )}
    </div>
  );
}
