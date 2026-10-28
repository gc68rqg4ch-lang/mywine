// Weinseite, Spalte 3: „Verkostet“ – alle Einträge des Weins (alle Jahrgänge), neuester
// zuerst, kompakt (Datum · Ort · Preis · Sterne); ✏️ je Eintrag öffnet das Formular samt
// Löschen. Merker „Kaufen?“ jederzeit umschaltbar.

import Link from "next/link";
import { EncounterFields, RatingField, VintageField, type PlaceOption } from "@/components/encounter-fields";
import { EditUnit } from "@/components/edit-unit";
import { encounterSummary, type EncounterView } from "@/lib/edit/encounters";
import { formatDate } from "@/lib/format";
import { DeleteEncounter } from "./delete-encounter";
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
  wantToBuy,
  persons,
  places,
  today,
  emptyWine = null,
}: {
  wineId: string;
  year: number | null;
  encounters: EncounterView[];
  wantToBuy: boolean;
  persons: { personId: string; name: string }[];
  places: PlaceOption[];
  today: string;
  /** Wein bliebe nach dem Löschen des (einzigen) Eintrags leer zurück. */
  emptyWine?: { encounterId: string; wineId: string; name: string; question: string } | null;
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
          {encounters.map((e) => (
            <EditUnit
              key={e.id}
              as="li"
              id={`encounter:${e.id}`}
              label={`Eintrag vom ${formatDate(e.tastedOn)}`}
              className="encounter-item"
              title={
                <span className="stack-sm">
                  <span>
                    <span className="year-chip">{e.year ?? "NV"}</span> {encounterSummary(e)}
                  </span>
                </span>
              }
              form={
                <>
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
                  <DeleteEncounter
                    encounterId={e.id}
                    label={`Eintrag vom ${formatDate(e.tastedOn)}`}
                    emptyWine={emptyWine?.encounterId === e.id ? emptyWine : null}
                  />
                </>
              }
            >
              <span className="row small encounter-extra">
                  {e.tastings.map((t) => (
                    <Link key={t.id} href={`/verkostet/${e.id}/wset?t=${t.id}`} className="link">
                      📝 {[t.quality ?? "WSET", t.points != null ? `${t.points.toLocaleString("de-CH")} / 4` : null, t.person].filter(Boolean).join(" · ")}
                    </Link>
                  ))}
                  <Link href={`/verkostet/${e.id}/wset`} className="link muted">
                    📝 WSET
                  </Link>
                  {e.note && <span className="muted encounter-note">{e.note}</span>}
                </span>
            </EditUnit>
          ))}
        </ul>
      )}
    </section>
  );
}
