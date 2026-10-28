// Weinseite, Spalte 3: „Verkostet“ – alle Einträge des Weins (alle Jahrgänge), neuester
// zuerst; im ✏️-Modus bearbeiten/löschen. Merker „Kaufen?“ jederzeit umschaltbar.

import Link from "next/link";
import { EncounterFields, RatingField, VintageField, type PlaceOption } from "@/components/encounter-fields";
import { HalfStars } from "@/components/half-stars";
import { encounterPrice, placeLabel, type EncounterView } from "@/lib/edit/encounters";
import { formatDate, formatStarNumber } from "@/lib/format";
import { EditForm } from "./edit-form";

export function WantToBuyToggle({ wineId, value }: { wineId: string; value: boolean }) {
  return (
    <div className="want-to-buy">
      <span className={value ? "want-badge active" : "want-badge"}>{value ? "🛒 Kaufen? – vorgemerkt" : "Kein Merker „Kaufen?“"}</span>
      <EditForm
        hidden={{ kind: "wantToBuy", wineId, value: value ? "0" : "1" }}
        submitLabel={value ? "Merker entfernen" : "🛒 Kaufen? merken"}
        cancel={false}
      />
    </div>
  );
}

export function EncounterSection({
  wineId,
  year,
  encounters,
  editing,
  wantToBuy,
  persons,
  places,
  today,
}: {
  wineId: string;
  year: number | null;
  encounters: EncounterView[];
  editing: boolean;
  wantToBuy: boolean;
  persons: { personId: string; name: string }[];
  places: PlaceOption[];
  today: string;
}) {
  const newHref = `/verkostet/neu?wein=${wineId}&jahrgang=${year ?? "ohne"}`;
  return (
    <section className="card stack" aria-labelledby="verkostet">
      <div className="row row-between">
        <h2 className="section-title" id="verkostet">
          Verkostet
        </h2>
        <Link href={newHref} className="btn btn-sm btn-primary">
          ＋ Erfassen
        </Link>
      </div>
      <WantToBuyToggle wineId={wineId} value={wantToBuy} />
      {encounters.length === 0 ? (
        <p className="muted">Noch nirgends verkostet.</p>
      ) : (
        <ul className="encounter-list">
          {encounters.map((e) =>
            editing ? (
              <li key={e.id} className="stack">
                <h3 className="subsection-title">
                  Eintrag vom {formatDate(e.tastedOn)}
                  {e.place ? ` · ${e.place.name}` : ""}
                </h3>
                <EditForm hidden={{ kind: "encounter", encounterId: e.id }}>
                  <VintageField initial={e.year} />
                  <EncounterFields
                    values={{
                      year: e.year,
                      tastedOn: e.tastedOn,
                      placeId: e.place?.id ?? null,
                      price: e.price,
                      priceUnit: e.priceUnit,
                      currency: e.currency,
                      occasion: e.occasion,
                      companions: e.companions,
                      note: e.note,
                    }}
                    places={places}
                    today={today}
                  />
                  {persons.map((p) => (
                    <RatingField
                      key={p.personId}
                      personId={p.personId}
                      name={p.name}
                      initial={e.ratings.find((r) => r.personId === p.personId)?.rating ?? null}
                    />
                  ))}
                </EditForm>
                <EditForm
                  hidden={{ kind: "deleteEncounter", encounterId: e.id }}
                  submitLabel="Eintrag löschen"
                  confirm={`Eintrag vom ${formatDate(e.tastedOn)} wirklich löschen? Seine Bewertungen werden mitgelöscht.`}
                  danger
                  cancel={false}
                />
              </li>
            ) : (
              <li key={e.id} className="stack-sm">
                <span className="row row-between">
                  <strong>
                    {formatDate(e.tastedOn)} · {e.year ?? "NV"}
                  </strong>
                  {e.price != null && <span className="muted">{encounterPrice({ price: e.price, price_unit: e.priceUnit, currency: e.currency })}</span>}
                </span>
                {e.place && <span>📍 {placeLabel(e.place)}</span>}
                {(e.occasion || e.companions) && (
                  <span className="muted small">{[e.occasion, e.companions ? `mit ${e.companions}` : null].filter(Boolean).join(" · ")}</span>
                )}
                {e.note && <span className="small">{e.note}</span>}
                {e.ratings.map((r) => (
                  <span key={r.personId} className="row small">
                    <span>{r.name}</span>
                    <HalfStars value={r.rating} label={`Bewertung ${r.name}`} />
                    <span className="muted">{formatStarNumber(r.rating)}</span>
                  </span>
                ))}
                <span className="row small">
                  {e.tastings.map((t) => (
                    <Link key={t.id} href={`/verkostet/${e.id}/wset?t=${t.id}`} className="link">
                      📝 {[t.quality ?? "WSET", t.points != null ? `${t.points.toLocaleString("de-CH")} / 4` : null, t.person].filter(Boolean).join(" · ")}
                    </Link>
                  ))}
                  <Link href={`/verkostet/${e.id}/wset`} className="btn btn-ghost btn-sm">
                    📝 WSET-Verkostung
                  </Link>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
