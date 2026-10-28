// Weinseite, Spalte 3: „Verkostet“ – alle Einträge des Weins (alle Jahrgänge), neuester
// zuerst, je eine kompakte Zeile („2022 · 28.10.2026 · Kronenhalle · ★ 4“, dahinter „🛒 kaufen“
// beim Merker); ✏️ je Eintrag öffnet das Formular samt Merker „Kaufen?“ und Löschen.

import Link from "next/link";
import { EncounterFields, RatingField, VintageField, type PlaceOption } from "@/components/encounter-fields";
import { EditUnit } from "@/components/edit-unit";
import { encounterRows } from "@/lib/cellar/wine-units";
import type { EncounterView } from "@/lib/edit/encounters";
import { formatDate } from "@/lib/format";
import { DeleteEncounter } from "./delete-encounter";
import { EditForm } from "./edit-form";

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
      {encounters.length > 0 && (
        <ul className="encounter-list">
          {encounterRows(encounters, wantToBuy).map(({ entry: e, line, buy }) => (
            <EditUnit
              key={e.id}
              as="li"
              id={`encounter:${e.id}`}
              label={`Eintrag vom ${formatDate(e.tastedOn)}`}
              className="encounter-item"
              title={
                <span className="encounter-line">
                  {line}
                  {buy && <span className="want-chip"> {buy}</span>}
                </span>
              }
              form={
                <>
                  <EditForm hidden={{ kind: "encounter", encounterId: e.id, wineId, wantToBuyField: "1" }}>
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
                    <label className="field field-check">
                      <input type="checkbox" name="wantToBuy" defaultChecked={wantToBuy} />
                      <span>🛒 Kaufen? – vormerken</span>
                    </label>
                  </EditForm>
                  <Link href={`/verkostet/${e.id}/wset`} className="btn btn-ghost btn-sm">
                    📝 WSET-Verkostung
                  </Link>
                  <DeleteEncounter
                    encounterId={e.id}
                    label={`Eintrag vom ${formatDate(e.tastedOn)}`}
                    emptyWine={emptyWine?.encounterId === e.id ? emptyWine : null}
                  />
                </>
              }
            >
              {e.tastings.length > 0 && (
                <span className="row small encounter-extra">
                  {e.tastings.map((t) => (
                    <Link key={t.id} href={`/verkostet/${e.id}/wset?t=${t.id}`} className="link">
                      📝 {[t.quality ?? "WSET", t.points != null ? `${t.points.toLocaleString("de-CH")} / 4` : null, t.person].filter(Boolean).join(" · ")}
                    </Link>
                  ))}
                </span>
              )}
            </EditUnit>
          ))}
        </ul>
      )}
    </section>
  );
}
