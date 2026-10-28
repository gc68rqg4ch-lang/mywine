import { EditUnit } from "@/components/edit-unit";
import { satTypeForWine, tanninVisible, normalizeData } from "@/lib/tasting/sat";
import {
  SOURCE_KIND_LABELS,
  TASTE_FIELDS,
  UNKNOWN,
  aromaGroups,
  tasteLevel,
  tasteOptions,
  tasteSourceLine,
  type StoredTasteProfile,
  type TasteKey,
} from "@/lib/taste/profile";
import { EditForm } from "./edit-form";
import { TasteResearchButton } from "./taste-research";

type Tasting = { person: string | null; sat: unknown; tasted_at: string };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Neueste WSET-Verkostung je Person (Liste ist neueste zuerst). */
function latestPerPerson(tastings: Tasting[]) {
  const seen = new Map<string, Record<string, unknown>>();
  for (const t of tastings) {
    if (!t.person || seen.has(t.person)) continue;
    seen.set(t.person, normalizeData(t.sat, t.tasted_at).fields as Record<string, unknown>);
  }
  return [...seen];
}

function Bar({ k, value }: { k: TasteKey; value: string }) {
  const level = tasteLevel(k, value);
  return (
    <span className="taste-bar-wrap">
      <span className="taste-bar" aria-hidden>
        {level != null && <span style={{ width: `${Math.max(8, Math.round(level * 100))}%` }} />}
      </span>
      <span className={level == null ? "muted small" : "small"}>{value}</span>
    </span>
  );
}

/**
 * Karte „Geschmacksprofil“ (Spalte 2, direkt unter „Zum Wein“): Balken je Merkmal, Aromen als
 * Chips nach Gruppe, kurze Beschreibung, Speisen; darunter klein die Herkunft (antippen →
 * Quellen und Belege). Mit eigenen WSET-Verkostungen ein Vergleich „Recherche vs. Person“.
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
  const fields = TASTE_FIELDS.filter((f) => f.key !== "tannin" || tanninVisible(type));
  const people = latestPerPerson(tastings);
  const aromaEntries = Object.entries(profile?.aromas ?? {}).filter(([, list]) => list.length);

  return (
    <section className="card stack">
      <EditUnit
        id="taste"
        label="Geschmacksprofil"
        title={<h2 className="section-title">Geschmacksprofil</h2>}
        form={<TasteForm wineId={wineId} type={type} year={profile ? profile.vintageYear : null} profile={profile} fields={fields} />}
      >
        {!profile ? (
          <div className="stack-sm">
            <p className="muted">Noch kein Geschmacksprofil.</p>
            <TasteResearchButton wineId={wineId} year={year} />
          </div>
        ) : (
          <div className="stack">
            <dl className="details taste-values">
              {fields.map((f) => (
                <div key={f.key} className="taste-row">
                  <dt>{f.label}</dt>
                  <dd>
                    <Bar k={f.key} value={profile.values[f.key]} />
                  </dd>
                </div>
              ))}
            </dl>
            {aromaEntries.length > 0 && (
              <div className="stack-sm">
                {aromaEntries.map(([group, list]) => (
                  <div key={group} className="taste-aromas">
                    <span className="muted small">{group}</span>
                    <span className="chips">
                      {list.map((a) => (
                        <span key={a} className="chip chip-static">
                          {a}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {profile.styleSummary && <p>{profile.styleSummary}</p>}
            {profile.foodPairing.length > 0 && (
              <p>
                <span className="muted">Passt zu:</span> {profile.foodPairing.join(", ")}
              </p>
            )}

            {people.length > 0 && (
              <div className="stack-sm">
                <h3 className="subsection-title">Recherche vs. {people.map(([name]) => name).join("/")}</h3>
                <table className="gap-table taste-compare">
                  <thead>
                    <tr>
                      <th scope="col">Merkmal</th>
                      <th scope="col">{profile.source === "manual" ? "Profil" : "Recherche"}</th>
                      {people.map(([name]) => (
                        <th key={name} scope="col">
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.key}>
                        <th scope="row">{f.label}</th>
                        <td className={profile.values[f.key] === UNKNOWN ? "muted" : undefined}>{profile.values[f.key]}</td>
                        {people.map(([name, sat]) => (
                          <td key={name}>{typeof sat[f.sat] === "string" && sat[f.sat] ? String(sat[f.sat]) : "–"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <details className="taste-sources">
              <summary className="muted small">
                {tasteSourceLine(profile)}
                {profile.vintageYear == null ? " · nicht jahrgangsspezifisch" : ` · Jahrgang ${profile.vintageYear}`}
              </summary>
              <div className="stack-sm small">
                {profile.sourceNote && <p className="muted">{profile.sourceNote}</p>}
                {profile.sources.length > 0 && (
                  <ul className="taste-source-list">
                    {profile.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="link">
                          {s.title || host(s.url)}
                        </a>{" "}
                        <span className="muted">
                          · {SOURCE_KIND_LABELS[s.kind] ?? s.kind}
                          {s.vintage ? ` · Jahrgang ${s.vintage}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {Object.keys(profile.evidence).length > 0 && (
                  <ul className="taste-evidence">
                    {Object.entries(profile.evidence).map(([key, list]) => (
                      <li key={key}>
                        <strong>{evidenceLabel(key)}:</strong>{" "}
                        {list.map((e, i) => (
                          <span key={i}>
                            {i > 0 && " · "}„{e.quote}“ <span className="muted">({host(e.source_url)})</span>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </div>
        )}
      </EditUnit>
    </section>
  );
}

function evidenceLabel(key: string) {
  if (key === "style_summary") return "Beschreibung";
  if (key === "food_pairing") return "Passt zu";
  return TASTE_FIELDS.find((f) => f.key === key)?.label ?? key;
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
        {year == null ? "Gilt für alle Jahrgänge ohne eigenes Profil. " : `Gilt für Jahrgang ${year}. `}Von Hand Geändertes
        überschreibt die Recherche nicht mehr – neue Funde kommen dann als Vorschlag.
      </p>
    </EditForm>
  );
}
