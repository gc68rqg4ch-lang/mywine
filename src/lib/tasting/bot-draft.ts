// Verkostung per Telegram („Erzählen“): welche Felder aus Freitext befüllt werden dürfen,
// wie ein Ergebnis von Claude in den SAT-Stand übernommen wird, was noch fehlt und wie
// die kompakte Zusammenfassung aussieht. Rein, ohne DB und ohne Claude.

import {
  APPEARANCE_FIELDS,
  COLOURS,
  CONCLUSION_FIELDS,
  NOSE_FIELDS,
  PALATE_FIELDS,
  aromaBlocksForType,
  autoEvaluate,
  currentScore,
  mousseVisible,
  tanninVisible,
  type FieldDef,
  type SatData,
  type SatType,
} from "./sat";

/** Felder, die aus Freitext kommen dürfen (Qualität und Punkte berechnet die App-Logik). */
export function extractableFields(type: SatType): FieldDef[] {
  return [
    ...APPEARANCE_FIELDS,
    { key: "farbton", label: "Farbton", options: COLOURS[type] },
    ...NOSE_FIELDS,
    ...PALATE_FIELDS.filter(
      (f) => (f.key !== "tannin" || tanninVisible(type)) && (f.key !== "mousse" || mousseVisible(type)),
    ),
    ...CONCLUSION_FIELDS.filter((f) => f.key === "trinkreife"),
  ];
}

/** Aromen-Lexikon für den Weintyp: Gruppe → erlaubte Begriffe. */
export function aromaLexicon(type: SatType) {
  const lexicon = new Map<string, string[]>();
  for (const block of aromaBlocksForType(type)) for (const [group, options] of block.groups) lexicon.set(group, options);
  return lexicon;
}

export type AromaRef = { group: string; aroma: string };

/** Ergebnis von Claude für einen Freitext: nur, was in diesem Text vorkommt. */
export type Extraction = {
  fields: Record<string, string | string[] | null>;
  aromas_add: AromaRef[];
  aromas_remove: AromaRef[];
  notes: string | null;
};

/**
 * Übernimmt einen Freitext-Auszug: genannte Felder überschreiben (nur exakte Optionswerte),
 * Aromen hinzufügen/entfernen, Notizen anhängen – danach Punkte und Qualität wie in der App.
 */
export function applyExtraction(data: SatData, x: Extraction): SatData {
  const fields = { ...data.fields };
  for (const def of extractableFields(data.type)) {
    const value = x.fields[def.key];
    if (value == null) continue;
    if (def.multi) {
      const list = (Array.isArray(value) ? value : [value]).filter((v) => def.options.includes(v));
      if (list.length) fields[def.key] = [...new Set(list)];
    } else if (typeof value === "string" && def.options.includes(value)) {
      fields[def.key] = value;
    }
  }

  const lexicon = aromaLexicon(data.type);
  const aromas: Record<string, string[]> = Object.fromEntries(
    Object.entries(data.aromas).map(([group, list]) => [group, [...list]]),
  );
  for (const { group, aroma } of x.aromas_remove) {
    if (!aromas[group]) continue;
    aromas[group] = aromas[group].filter((a) => a !== aroma);
    if (!aromas[group].length) delete aromas[group];
  }
  for (const { group, aroma } of x.aromas_add) {
    if (!lexicon.get(group)?.includes(aroma)) continue;
    const list = aromas[group] ?? [];
    if (!list.includes(aroma)) aromas[group] = [...list, aroma];
  }

  const note = x.notes?.trim();
  const notes = note ? [data.notes.trim(), note].filter(Boolean).join("\n") : data.notes;
  return autoEvaluate({ ...data, fields, aromas, notes }, new Set()).data;
}

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v !== "");

/**
 * Was für die Qualitätsbewertung (Länge, Intensität, Komplexität) bzw. fürs Resultat
 * noch fehlt – als kurze Bezeichnungen in Formular-Reihenfolge.
 */
export function missingCategories(data: SatData) {
  const f = data.fields;
  const forQuality = [
    !filled(f.geschmackIntensitaet) && "Geschmacksintensität",
    !filled(f.abgang) && "Abgang",
    !Object.values(data.aromas).some((list) => list.length) && "Aromen",
    !filled(f.entwicklung) && "Entwicklungsstadium",
  ].filter((x): x is string => Boolean(x));
  const forResult = [
    !filled(f.suesse) && "Süsse",
    !filled(f.saeure) && "Säure",
    tanninVisible(data.type) && !filled(f.tannin) && "Tannin",
    !filled(f.koerper) && "Körper",
    mousseVisible(data.type) && !filled(f.mousse) && "Mousse",
    !filled(f.trinkreife) && "Trinkreife",
  ].filter((x): x is string => Boolean(x));
  return [...forQuality, ...forResult];
}

/** Kompakte Zusammenfassung: Resultat, 👃 Nase, 👅 Gaumen, Trinkreife. */
export function draftSummary(data: SatData) {
  const f = data.fields;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const score = currentScore(data);
  const quality = s(f.qualitaet);
  const result =
    score != null
      ? `${quality ?? "–"} · ${score.toLocaleString("de-CH")} / 4 Punkte`
      : quality === "fehlerhaft"
        ? "fehlerhaft"
        : "noch offen (Punkte unvollständig)";
  const aromas = [...new Set(Object.values(data.aromas).flat())];
  const nose = [
    s(f.reintoenigkeit) === "unsauber (fehlerhaft?)" ? "unsauber" : null,
    s(f.geruchIntensitaet),
    aromas.length ? aromas.join(", ") : null,
    s(f.entwicklung),
  ].filter(Boolean);
  const palate = [
    s(f.suesse),
    s(f.saeure) && `Säure ${f.saeure}`,
    tanninVisible(data.type) && s(f.tannin) && `Tannin ${f.tannin}`,
    s(f.alkohol) && `Alkohol ${f.alkohol}`,
    s(f.koerper) && `Körper ${f.koerper}`,
    mousseVisible(data.type) && s(f.mousse) && `Mousse ${f.mousse}`,
    s(f.geschmackIntensitaet) && `Intensität ${f.geschmackIntensitaet}`,
    s(f.abgang) && `Abgang ${f.abgang}`,
  ].filter(Boolean);
  return {
    result,
    nose: nose.length ? nose.join(" · ") : "–",
    palate: palate.length ? palate.join(" · ") : "–",
    readiness: s(f.trinkreife),
  };
}
