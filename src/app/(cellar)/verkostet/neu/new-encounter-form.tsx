"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { EncounterFields, RatingField, VintageField, type PlaceOption } from "@/components/encounter-fields";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { WINE_TYPE_LABELS, type WineType } from "@/lib/format";
import { addEncounter } from "../../encounter-actions";

export type WineOption = { id: string; name: string; producer: string; type: WineType | null; country: string | null };

const MAX_HITS = 8;
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("de-CH");

/**
 * Erfassen „Verkostet“: Wein suchen oder neu anlegen, Jahrgang (Pflicht, NV möglich), Datum,
 * Ort, Preis, Anlass, Begleitung, Notiz, Merker und Bewertungen – gespeichert über das
 * gemeinsame Modul.
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
  const [state, action, pending] = useActionState(addEncounter, undefined);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [wineId, setWineId] = useState<string | null>(preselected);
  const [search, setSearch] = useState("");
  const [others, setOthers] = useState(false);

  const hits = useMemo(() => {
    const terms = norm(search).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return wines.filter((w) => terms.every((t) => norm(`${w.producer} ${w.name} ${w.country ?? ""}`).includes(t))).slice(0, MAX_HITS);
  }, [search, wines]);
  const chosen = wines.find((w) => w.id === wineId) ?? null;
  const own = persons.find((p) => p.id === ownPersonId) ?? null;
  const rest = persons.filter((p) => p.id !== ownPersonId);

  return (
    <form action={action} className="stack-lg encounter-form">
      <input type="hidden" name="kind" value="addEncounter" />
      <input type="hidden" name="wineMode" value={mode} />

      <section className="card stack">
        <h2 className="section-title">Wein</h2>
        {mode === "existing" ? (
          <>
            {chosen ? (
              <div className="row row-between encounter-chosen">
                <span className="row">
                  <WineTypeIcon type={chosen.type} size={20} />
                  <span>
                    <strong>{chosen.name}</strong> <span className="muted">· {chosen.producer}</span>
                  </span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWineId(null)}>
                  Ändern
                </button>
                <input type="hidden" name="wineId" value={chosen.id} />
              </div>
            ) : (
              <div className="stack-sm">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Wein oder Produzent suchen …"
                  aria-label="Wein suchen"
                  autoFocus
                />
                {hits.length > 0 && (
                  <ul className="pick-list">
                    {hits.map((w) => (
                      <li key={w.id}>
                        <button type="button" className="pick" onClick={() => setWineId(w.id)}>
                          <WineTypeIcon type={w.type} size={18} />
                          <span>
                            {w.name} <span className="muted">· {w.producer}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {search && hits.length === 0 && <p className="muted small">Kein Wein gefunden.</p>}
              </div>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setMode("new")}>
              ➕ Neuen Wein anlegen
            </button>
          </>
        ) : (
          <>
            <div className="edit-grid">
              <label className="field">
                <span>Name</span>
                <input type="text" name="newName" required autoComplete="off" defaultValue={search} />
              </label>
              <label className="field">
                <span>Produzent</span>
                <input type="text" name="newProducer" required autoComplete="off" />
              </label>
              <label className="field">
                <span>Typ</span>
                <select name="newType" defaultValue="">
                  <option value="">Unbekannt</option>
                  {(Object.keys(WINE_TYPE_LABELS) as WineType[]).map((t) => (
                    <option key={t} value={t}>
                      {WINE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Land</span>
                <input type="text" name="newCountry" autoComplete="off" />
              </label>
              <label className="field">
                <span>Region</span>
                <input type="text" name="newRegion" autoComplete="off" />
              </label>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("existing")}>
              ← Bestehenden Wein suchen
            </button>
          </>
        )}
        <VintageField initial={preselectedYear} />
      </section>

      <section className="card stack">
        <h2 className="section-title">Wann, wo, wie viel</h2>
        <EncounterFields
          values={{ year: null, tastedOn: today, placeId: null, price: null, priceUnit: "bottle", currency: "CHF", occasion: null, companions: null, note: null }}
          places={places}
          today={today}
        />
        <label className="field field-check">
          <input type="checkbox" name="wantToBuy" />
          <span>🛒 Kaufen? – als Merker vormerken</span>
        </label>
      </section>

      <section className="card stack">
        <h2 className="section-title">Bewertung</h2>
        {own ? <RatingField personId={own.id} name={`${own.name} (du)`} /> : <p className="muted small">Du bist keiner Person zugeordnet.</p>}
        {rest.length > 0 &&
          (others ? (
            rest.map((p) => <RatingField key={p.id} personId={p.id} name={p.name} />)
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOthers(true)}>
              Auch für {rest.map((p) => p.name).join(" & ")} bewerten
            </button>
          ))}
      </section>

      {state?.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending || (mode === "existing" && !chosen)}>
          {pending ? "Wird gespeichert …" : "Verkostet speichern"}
        </button>
        <Link href="/verkostet" className="btn btn-ghost">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}
