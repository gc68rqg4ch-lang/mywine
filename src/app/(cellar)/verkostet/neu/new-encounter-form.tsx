"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  DateField,
  NoteField,
  PlaceField,
  PriceFields,
  RatingField,
  TextField,
  VintageField,
  type PlaceOption,
} from "@/components/encounter-fields";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { ENCOUNTER_MORE_FIELDS, ENCOUNTER_QUICK_FIELDS, type EncounterFormField } from "@/lib/edit/encounter-form";
import { WINE_TYPES, WINE_TYPE_LABELS, wineName, type WineType } from "@/lib/format";
import { addEncounter, type EncounterActionState } from "../../encounter-actions";

export type WineOption = { id: string; name: string; producer: string | null; type: WineType | null; country: string | null };

const MAX_HITS = 5;
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH");

/**
 * Verkostet erfassen – schnell: Name und Jahrgang (Pflicht), Bewertung(en), Notiz; alles
 * Weitere unter „Mehr Angaben“. Reihenfolge aus ENCOUNTER_QUICK_FIELDS / ENCOUNTER_MORE_FIELDS.
 * Gespeichert über das gemeinsame Modul, alles oder nichts.
 */
export function NewEncounterForm({
  wines,
  places,
  persons,
  ownPersonId,
  today,
  preselected,
  preselectedYear,
}: {
  wines: WineOption[];
  places: PlaceOption[];
  persons: { id: string; name: string }[];
  ownPersonId: string | null;
  today: string;
  preselected: string | null;
  preselectedYear: number | null | "unset";
}) {
  // Absenden ohne <form action>: React würde das Formular danach zurücksetzen – bei einer
  // Fehlermeldung wären die Eingaben weg.
  const [state, setState] = useState<EncounterActionState>(undefined);
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => setState(await addEncounter(state, data)));
  };
  const [wineId, setWineId] = useState<string | null>(preselected);
  const [name, setName] = useState("");
  const [forceNew, setForceNew] = useState(false);
  const [others, setOthers] = useState(false);

  const chosen = wines.find((w) => w.id === wineId) ?? null;
  const hits = useMemo(() => {
    const terms = norm(name).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return wines.filter((w) => terms.every((t) => norm(`${w.producer ?? ""} ${w.name}`).includes(t))).slice(0, MAX_HITS);
  }, [name, wines]);
  const own = persons.find((p) => p.id === ownPersonId) ?? null;
  const rest = persons.filter((p) => p.id !== ownPersonId);
  const choose = (id: string) => {
    setWineId(id);
    setForceNew(false);
  };

  const sections: Record<EncounterFormField, ReactNode> = {
    wine: chosen ? (
      <div className="row row-between encounter-chosen">
        <span className="row">
          <WineTypeIcon type={chosen.type} size={20} />
          <span>
            <strong>{chosen.name}</strong>
            {chosen.producer && <span className="muted"> · {chosen.producer}</span>}
          </span>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWineId(null)}>
          Ändern
        </button>
        <input type="hidden" name="wineId" value={chosen.id} />
      </div>
    ) : (
      <div className="stack-sm">
        <label className="field">
          <span>Name des Weins</span>
          <input
            type="text"
            name="newName"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setForceNew(false);
            }}
            required
            autoComplete="off"
            placeholder="z. B. Pintia"
            autoFocus
          />
        </label>
        {forceNew && <input type="hidden" name="forceNew" value="1" />}
        {hits.length > 0 && !forceNew && (
          <ul className="pick-list" aria-label="Gibt es den Wein schon?">
            {hits.map((w) => (
              <li key={w.id}>
                <button type="button" className="pick" onClick={() => choose(w.id)}>
                  <WineTypeIcon type={w.type} size={18} />
                  <span>
                    {w.name}
                    {w.producer && <span className="muted"> · {w.producer}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    vintage: <VintageField initial={preselectedYear} />,
    ratings: (
      <div className="stack-sm">
        <span className="field-label">Bewertung</span>
        {own ? <RatingField personId={own.id} name={`${own.name} (du)`} /> : null}
        {rest.length > 0 &&
          (others || !own ? (
            rest.map((p) => <RatingField key={p.id} personId={p.id} name={p.name} />)
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOthers(true)}>
              Auch für {rest.map((p) => p.name).join(" & ")} bewerten
            </button>
          ))}
      </div>
    ),
    note: <NoteField />,
    producer: !chosen && <TextField name="newProducer" label="Produzent" />,
    type: !chosen && (
      <label className="field">
        <span>Weintyp</span>
        <select name="newType" defaultValue="">
          <option value="">–</option>
          {WINE_TYPES.map((t) => (
            <option key={t} value={t}>
              {WINE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
    ),
    origin: !chosen && (
      <>
        <TextField name="newCountry" label="Land" />
        <TextField name="newRegion" label="Region" />
      </>
    ),
    place: <PlaceField placeId={null} places={places} />,
    price: <PriceFields price={null} priceUnit="bottle" currency="CHF" />,
    occasion: <TextField name="occasion" label="Anlass" placeholder="z. B. Geburtstag" />,
    companions: <TextField name="companions" label="Begleitung" placeholder="mit wem?" />,
    wantToBuy: (
      <label className="field field-check">
        <input type="checkbox" name="wantToBuy" />
        <span>🛒 Kaufen? – vormerken</span>
      </label>
    ),
    date: <DateField value={today} today={today} />,
  };

  return (
    <form onSubmit={submit} className="stack-lg encounter-form">
      <input type="hidden" name="kind" value="addEncounter" />
      <input type="hidden" name="wineMode" value={chosen ? "existing" : "new"} />

      <section className="card stack">
        {ENCOUNTER_QUICK_FIELDS.map((f) => (
          <div key={f} data-field={f}>
            {sections[f]}
          </div>
        ))}
      </section>

      {/* Mehrere Weine heissen so: auswählen oder bewusst neu anlegen. */}
      {state?.candidates && !chosen && !forceNew && (
        <section className="card stack" role="alert">
          <strong>Welcher Wein ist es?</strong>
          <ul className="pick-list">
            {state.candidates.map((w) => (
              <li key={w.id}>
                <button type="button" className="pick" onClick={() => choose(w.id)}>
                  <WineTypeIcon type={w.type} size={18} />
                  <span>
                    {wineName(w)}
                    {w.country && <span className="muted"> · {w.country}</span>}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="pick" onClick={() => setForceNew(true)}>
                ➕ Neuen Wein „{name}“ anlegen
              </button>
            </li>
          </ul>
        </section>
      )}

      <details className="card more-fields">
        <summary>Mehr Angaben</summary>
        <div className="edit-grid">
          {ENCOUNTER_MORE_FIELDS.map((f) =>
            sections[f] ? (
              <div key={f} data-field={f} className="field-slot">
                {sections[f]}
              </div>
            ) : null,
          )}
        </div>
      </details>

      {state?.error && !(state.candidates && (chosen || forceNew)) && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Wird gespeichert …" : "Verkostet speichern"}
        </button>
        <Link href="/verkostet" className="btn btn-ghost">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
