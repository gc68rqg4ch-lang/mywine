// Anzeige des Geschmacksprofils (ohne Bearbeiten) – kurz und knapp: einspaltig nur bekannte
// Merkmale mit 5-Stufen-Skala, eine Reihe Aromen, ein Satz zum Stil, „Passt zu“. Eigene
// WSET-Verkostungen als zweite Markierung auf derselben Skala.

import { normalizeData } from "@/lib/tasting/sat";
import { aromaChips, shortSummary, tasteRows, tasteStep, type StoredTasteProfile, type TasteKey } from "@/lib/taste/profile";

export type Tasting = { person: string | null; sat: unknown; tasted_at: string };

/** Neueste WSET-Verkostung je Person (Liste ist neueste zuerst), höchstens zwei. */
function latestPerPerson(tastings: Tasting[]) {
  const seen = new Map<string, Record<string, unknown>>();
  for (const t of tastings) {
    if (!t.person || seen.has(t.person) || seen.size >= 2) continue;
    seen.set(t.person, normalizeData(t.sat, t.tasted_at).fields as Record<string, unknown>);
  }
  return [...seen];
}

const STEPS = [0, 1, 2, 3, 4];

/** 5-Stufen-Skala: Punkt der Recherche (gefüllt), eigene Verkostungen als Ring auf derselben Skala. */
function Scale({ step, marks }: { step: number; marks: (number | null)[] }) {
  return (
    <span className="taste-scale" aria-hidden>
      {STEPS.map((i) => (
        <span
          key={i}
          className={[
            "taste-dot",
            i < step ? "is-below" : "",
            i === step ? "is-on" : "",
            ...marks.map((m, n) => (m === i ? `mark-${n + 1}` : "")),
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </span>
  );
}

export function TasteView({ profile, keys, tastings }: { profile: StoredTasteProfile; keys: TasteKey[]; tastings: Tasting[] }) {
  const people = latestPerPerson(tastings);
  const rows = tasteRows(profile, keys);
  const chips = aromaChips(profile.aromas);
  const summary = profile.styleSummary ? shortSummary(profile.styleSummary) : null;
  const personStep = (sat: Record<string, unknown>, key: TasteKey, field: string) =>
    typeof sat[field] === "string" ? tasteStep(key, sat[field] as string) : null;
  const shownPeople = people.filter(([, sat]) => rows.some((r) => personStep(sat, r.key, r.sat) != null));
  return (
<div className="stack-sm taste-card">
  {rows.length > 0 && (
    <ul className="taste-rows">
      {rows.map((r) => {
        const marks = shownPeople.map(([, sat]) => personStep(sat, r.key, r.sat));
        const others = shownPeople
          .map(([name, sat]) => (typeof sat[r.sat] === "string" && sat[r.sat] ? `${name}: ${sat[r.sat]}` : null))
          .filter(Boolean)
          .join(", ");
        return (
          <li key={r.key} className="taste-row" title={others || undefined}>
            <span className="taste-label">{r.label}</span>
            <Scale step={r.step} marks={marks} />
            <span className="taste-value">{r.value}</span>
          </li>
        );
      })}
    </ul>
  )}
  {shownPeople.length > 0 && (
    <p className="taste-legend small muted">
      <span className="taste-dot is-on" aria-hidden /> Recherche
      {shownPeople.map(([name], n) => (
        <span key={name}>
          {" "}
          <span className={`taste-dot mark-${n + 1}`} aria-hidden /> {name}
        </span>
      ))}
    </p>
  )}
  {chips.length > 0 && (
    <div className="chips taste-chips">
      {chips.map((a) => (
        <span key={a} className="chip chip-static">
          {a}
        </span>
      ))}
    </div>
  )}
  {summary && <p className="taste-summary">{summary}</p>}
  {profile.foodPairing.length > 0 && (
    <p className="small">
      <span className="muted">Passt zu:</span> {profile.foodPairing.join(", ")}
    </p>
  )}
</div>
  );
}
