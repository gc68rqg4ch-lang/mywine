import { EditUnit } from "@/components/edit-unit";
import { satTypeForWine, tanninVisible } from "@/lib/tasting/sat";
import { TASTE_FIELDS, TASTE_KEYS, UNKNOWN, aromaGroups, tasteOptions, type StoredTasteProfile } from "@/lib/taste/profile";
import { EditForm } from "./edit-form";
import { TasteResearchButton } from "./taste-research";
import { TasteView, type Tasting } from "./taste-view";

/**
 * Karte „Geschmacksprofil“ (Spalte 2, unter „Zum Wein“) – kurz und knapp: einspaltig nur
 * bekannte Merkmale mit 5-Stufen-Skala, eine Reihe Aromen, ein Satz zum Stil, „Passt zu“.
 * Eigene WSET-Verkostungen erscheinen als zweite Markierung auf derselben Skala. Nur das
 * Profil des gewählten Jahrgangs; Belege und Herkunft bleiben in der DB (nicht angezeigt).
 */
export function TasteCard({
  wineId,
  wineType,
  year,
  profile,
  tastings,
}: {
  wineId: string;
  wineType: string | null;
  year: number | null;
  profile: StoredTasteProfile | null;
  tastings: Tasting[];
}) {
  const type = satTypeForWine(wineType);
  const keys = TASTE_KEYS.filter((k) => k !== "tannin" || tanninVisible(type));
  const fields = TASTE_FIELDS.filter((f) => keys.includes(f.key));

  return (
    <section className="card stack">
      <EditUnit
        id="taste"
        label="Geschmacksprofil"
        title={<h2 className="section-title">Geschmacksprofil</h2>}
        form={<TasteForm wineId={wineId} type={type} year={year} profile={profile} fields={fields} />}
      >
        {!profile ? (
          <div className="stack-sm">
            <p className="muted">Noch kein Geschmacksprofil{year != null ? ` für ${year}` : ""}.</p>
            <TasteResearchButton wineId={wineId} year={year} />
          </div>
        ) : (
          <TasteView profile={profile} keys={keys} tastings={tastings} />
        )}
      </EditUnit>
    </section>
  );
}

/** ✏️ Profil von Hand: danach gilt es als eigenes (manual) und wird von der Recherche nicht überschrieben. */
function TasteForm({
  wineId,
  type,
  year,
  profile,
  fields,
}: {
  wineId: string;
  type: ReturnType<typeof satTypeForWine>;
  year: number | null;
  profile: StoredTasteProfile | null;
  fields: (typeof TASTE_FIELDS)[number][];
}) {
  const chosen = new Set(Object.entries(profile?.aromas ?? {}).flatMap(([g, list]) => list.map((a) => `${g}|${a}`)));
  return (
    <EditForm hidden={{ kind: "tasteProfile", wineId, year: year == null ? "nv" : String(year) }}>
      <div className="edit-grid">
        {fields.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <select name={`taste_${f.key}`} defaultValue={profile?.values[f.key] ?? UNKNOWN}>
              <option value={UNKNOWN}>{UNKNOWN}</option>
              {tasteOptions(f.key).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <details className="taste-aroma-edit">
        <summary className="field-label">Aromen ({chosen.size})</summary>
        <div className="stack-sm">
          {[...aromaGroups(type)].map(([group, list]) => (
            <fieldset key={group} className="stack-sm">
              <legend className="muted small">{group}</legend>
              <div className="chips">
                {list.map((a) => (
                  <label key={a} className="chip chip-check">
                    <input type="checkbox" name="aroma" value={`${group}|${a}`} defaultChecked={chosen.has(`${group}|${a}`)} /> {a}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      <label className="field">
        <span>Beschreibung</span>
        <textarea name="styleSummary" rows={2} defaultValue={profile?.styleSummary ?? ""} />
      </label>
      <label className="field">
        <span>Passt zu (mit Komma getrennt)</span>
        <input type="text" name="foodPairing" defaultValue={profile?.foodPairing.join(", ") ?? ""} autoComplete="off" />
      </label>
      <p className="muted small">
        {year == null ? "Gilt für den Wein ohne Jahrgang. " : `Gilt für Jahrgang ${year}. `}Von Hand Geändertes
        überschreibt die Recherche nicht mehr – neue Funde kommen dann als Vorschlag.
      </p>
    </EditForm>
  );
}
