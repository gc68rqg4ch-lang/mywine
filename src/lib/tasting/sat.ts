// WSET Level 3 – Systematic Approach to Tasting (SAT).
// 1:1-Portierung des Verkostungs-Tools https://gc68rqg4ch-lang.github.io/WSET-Verkostungs-tool/
// (Felder, Optionen, Aromen-Lexikon, Punkte-Logik). Die Datenstruktur entspricht dem Tool,
// damit wine_tastings.sat dieselben Schlüssel hat. Reine Funktionen, auch im Browser nutzbar.

export type SatType = "rot" | "weiss" | "rose" | "schaum" | "suess";

export const SAT_TYPES: { type: SatType; label: string }[] = [
  { type: "rot", label: "Rotwein" },
  { type: "weiss", label: "Weisswein" },
  { type: "rose", label: "Rosé" },
  { type: "schaum", label: "Schaumwein" },
  { type: "suess", label: "Gespritete & Süssweine" },
];

/** Werte für wine_tastings.wine_style. */
export const WINE_STYLE: Record<SatType, string> = {
  rot: "Rotwein",
  weiss: "Weisswein",
  rose: "Rosé",
  schaum: "Schaumwein",
  suess: "Gespritete & Süssweine",
};

export type FieldValue = string | string[] | boolean | null | undefined;
export type SatFields = Record<string, FieldValue>;
export type SatAromas = Record<string, string[]>;

export type SatData = {
  type: SatType;
  meta: {
    date?: string;
    name?: string;
    producer?: string;
    region?: string;
    vintage?: string;
    grape?: string;
  };
  fields: SatFields;
  aromas: SatAromas;
  byType: Record<SatType, { fields: SatFields; aromas: SatAromas }>;
  appearanceOther: string;
  notes: string;
};

export type FieldDef = {
  key: string;
  label: string;
  hint?: string;
  options: string[];
  multi?: boolean;
  score?: boolean;
};

export const COLOURS: Record<SatType, string[]> = {
  rot: ["purpurrot", "rubinrot", "granatrot", "braunrot", "braun"],
  weiss: ["grüngelb", "zitronengelb", "goldgelb", "bernsteingelb", "braun"],
  rose: ["hellrosa", "lachsfarben", "orange"],
  schaum: ["grüngelb", "zitronengelb", "goldgelb", "hellrosa", "lachsfarben"],
  suess: ["zitronengelb", "goldgelb", "bernsteingelb", "braun", "rubinrot", "granatrot", "braunrot"],
};

const split = (s: string) => s.split("|");

/** Optischer Eindruck (Farbton hängt vom Weintyp ab, siehe COLOURS). */
export const APPEARANCE_FIELDS: FieldDef[] = [
  { key: "klarheit", label: "Klarheit", options: split("klar|trüb (fehlerhaft?)") },
  { key: "farbtiefe", label: "Farbtiefe", options: split("blass|mittel|tief") },
];

export const NOSE_FIELDS: FieldDef[] = [
  { key: "reintoenigkeit", label: "Reintönigkeit", options: split("sauber|unsauber (fehlerhaft?)") },
  {
    key: "geruchIntensitaet",
    label: "Intensität",
    options: split("verhalten|mittel (−)|mittel|mittel (+)|ausgeprägt"),
  },
  {
    key: "aromaauspraegung",
    label: "Aromaausprägung",
    hint: "Mehrfachauswahl",
    options: split("primär|sekundär|tertiär"),
    multi: true,
  },
  {
    key: "entwicklung",
    label: "Entwicklungsstadium",
    options: split("jugendlich|erste Reifenoten|voll gereift|müde / Höhepunkt überschritten"),
  },
];

export const PALATE_FIELDS: FieldDef[] = [
  { key: "suesse", label: "Süsse", options: split("trocken|fast trocken|halbtrocken|halbsüss|süss|üppig") },
  { key: "saeure", label: "Säure", options: split("niedrig|mittel (−)|mittel|mittel (+)|hoch") },
  { key: "tannin", label: "Tannin", options: split("niedrig|mittel (−)|mittel|mittel (+)|hoch") },
  { key: "alkohol", label: "Alkohol", options: split("niedrig|mittel|hoch") },
  { key: "koerper", label: "Körper", options: split("schlank|mittel (−)|mittel|mittel (+)|voll") },
  {
    key: "mousse",
    label: "Mousse",
    hint: "nur bei Schaumwein relevant",
    options: split("fein|cremig|aggressiv"),
  },
  {
    key: "geschmackIntensitaet",
    label: "Geschmacksintensität",
    options: split("zart|mittel (−)|mittel|mittel (+)|ausgeprägt"),
  },
  {
    key: "geschmacksauspraegung",
    label: "Geschmacksausprägung",
    hint: "Mehrfachauswahl",
    options: split("primär|sekundär|tertiär"),
    multi: true,
  },
  { key: "abgang", label: "Abgang", options: split("kurz|mittel (−)|mittel|mittel (+)|lang") },
];

export const SCORE_FIELDS: FieldDef[] = [
  {
    key: "balance",
    label: "Balance",
    hint: "Level-2-Voreinstellung: 1 Punkt; für Level 3 manuell änderbar",
    options: split("0|0.5|1"),
    score: true,
  },
  {
    key: "laenge",
    label: "Länge",
    hint: "automatischer Vorschlag aus Abgang",
    options: split("0|0.5|1"),
    score: true,
  },
  {
    key: "intensitaet",
    label: "Intensität",
    hint: "automatischer Vorschlag aus Geschmacksintensität",
    options: split("0|0.5|1"),
    score: true,
  },
  {
    key: "komplexitaet",
    label: "Komplexität",
    hint: "automatischer Vorschlag aus Vielfalt, Präzision sowie primären/sekundären/tertiären Ebenen",
    options: split("0|0.5|1"),
    score: true,
  },
];

export const QUALITY_OPTIONS = split("fehlerhaft|schwach|durchschnittlich|gut|sehr gut|hervorragend");

export const READINESS_OPTIONS = [
  "zu jung",
  "kann jetzt getrunken werden, hat aber noch Reifungspotenzial",
  "jetzt trinken: nicht für Alterung oder weitere Lagerung geeignet",
  "zu alt",
];

export const CONCLUSION_FIELDS: FieldDef[] = [
  { key: "qualitaet", label: "Qualität", options: QUALITY_OPTIONS },
  { key: "trinkreife", label: "Trinkreife / Reifungspotenzial", options: READINESS_OPTIONS },
];

export const SCORE_KEYS = ["balance", "laenge", "intensitaet", "komplexitaet"] as const;

type AromaBlock = { title?: string; sub?: string; groups: [string, string][] };

const AROMAS: Record<string, AromaBlock> = {
  primary: {
    title: "Primäre Aromen und Geschmacksnoten",
    sub: "Aus der Traube und aus der alkoholischen Gärung",
    groups: [
      ["Floral", "Akazie|Blüten|Geissblatt|Geranie|Holunderblüte|Kamille|Rose|Veilchen"],
      ["Grüne Früchte", "Apfel|Birne|Birnendrops|Quitte|Stachelbeere|Traube"],
      ["Zitrusfrüchte", "Grapefruit|Limettensaft|Limettenschale|Orangenschale|Zitrone|Zitronenschale"],
      ["Steinobst", "Aprikose|Nektarine|Pfirsich"],
      ["Tropische Früchte", "Ananas|Banane|Litschi|Mango|Melone|Passionsfrucht"],
      ["Rote Früchte", "Erdbeere|Himbeere|Preiselbeere|rote Kirsche|Rote Johannisbeere|rote Pflaume"],
      ["Schwarze Früchte", "Brombeere|Heidelbeere|schwarze Kirsche|Schwarze Johannisbeere|schwarze Pflaume"],
      [
        "Getrocknete / gekochte Früchte",
        "Backpflaume|Feige|Fruchtkompott|Fruchtkonserve|gebackene Früchte|Kirschwasser|marmeladig|Rosine|Sultanine",
      ],
      ["Krautig", "Gras|grüne Paprikaschote|Schwarze Johannisbeerblätter|Spargel|Tomatenblätter"],
      ["Kräuterwürzig", "Dill|Eukalyptus|Fenchel|Lavendel|medizinisch|Minze"],
      ["Scharfe Gewürze", "Lakritze|Muskatnuss|schwarzer Pfeffer|weisser Pfeffer"],
      ["Mineralisch", "Feuerstein|Graphit|Kreide|nasse Steine|Schiefer"],
      ["Sonstige", "Gummi|Jod|medizinisch|Petrol|Rauch"],
    ],
  },
  secondary: {
    title: "Sekundäre Aromen und Geschmacksnoten",
    sub: "Aus der Weinbereitung nach der Gärung",
    groups: [
      ["Hefe / Hefesatz / Autolyse", "Biskuit|Brioche|Brot|Brotteig|Gebäck|Käse|Toast"],
      ["Biologischer Säureabbau", "Butter|Käse|Sahne"],
      [
        "Eiche",
        "Gewürznelke|Harz|Holzkohle|Kaffee|Karamellbonbon|Kokosnuss|Muskatnuss|Rauch|Schokolade|Toast|Vanille|Zedernholz",
      ],
    ],
  },
  tertiaryCommon: {
    title: "Tertiäre Aromen und Geschmacksnoten",
    sub: "Aus der Reifung",
    groups: [["Absichtliche Oxidation", "Kaffee|Karamell|Haselnuss|Mandel|Marzipan|Schokolade|Toffee|Walnuss"]],
  },
  tertiaryWhite: {
    groups: [
      ["Fruchtentwicklung – Weisswein", "getrocknete Aprikose|getrocknete Banane|getrockneter Apfel|Marmelade"],
      [
        "Flaschenreife – Weisswein",
        "Benzin / Petrolnote|Heu|Honig|Ingwer|Kerosin|Muskatnuss|nussig|Pilze|Toast|Zimt",
      ],
    ],
  },
  tertiaryRed: {
    groups: [
      [
        "Fruchtentwicklung – Rotwein",
        "Feige|gekochte Brombeere|gekochte rote Pflaume|getrocknete Brombeere|getrocknete Preiselbeere|Backpflaume|Teer",
      ],
      [
        "Flaschenreife – Rotwein",
        "Bauernhof|Erde|feuchtes Laub|fleischig|Leder|Pilze|Tabak|vegetabil|Waldboden|Wildbret",
      ],
    ],
  },
  tertiarySweet: {
    groups: [
      ["Botrytis / Edelfäule", "Bienenwachs|Honig|Ingwer|Marmelade|Safran"],
      [
        "Fruchtentwicklung – Süsswein",
        "Fruchtkonfitüre|getrocknete Aprikose|getrocknete Feige|Orangenmarmelade|Rosine|Sultanine",
      ],
      ["Flaschenreife – Süsswein", "Bienenwachs|Honig|Karamell|Nüsse|Pilze|Toffee"],
      [
        "Oxidative Reifung – gespritete Weine",
        "Haselnuss|Kaffee|Karamell|Leder|Mandel|Schokolade|Tabak|Toffee|Walnuss",
      ],
    ],
  },
  secondarySparkling: {
    title: "Sekundäre Aromen und Geschmacksnoten",
    sub: "Bei Schaumwein besonders wichtig: Aromen aus Hefesatzlagerung und Autolyse",
    groups: [
      ["Autolyse / Hefesatz", "Biskuit|Brioche|Brot|Brotteig|Gebäck|Hefe|Toast"],
      ["Biologischer Säureabbau", "Butter|Käse|Sahne"],
      ["Eiche", "Gewürznelke|Holzkohle|Kaffee|Karamellbonbon|Rauch|Toast|Vanille|Zedernholz"],
    ],
  },
};

const PRIMARY_GROUPS_BY_TYPE: Record<SatType, string[]> = {
  weiss: [
    "Floral", "Grüne Früchte", "Zitrusfrüchte", "Steinobst", "Tropische Früchte",
    "Getrocknete / gekochte Früchte", "Krautig", "Kräuterwürzig", "Scharfe Gewürze", "Mineralisch", "Sonstige",
  ],
  rot: [
    "Floral", "Rote Früchte", "Schwarze Früchte", "Getrocknete / gekochte Früchte",
    "Krautig", "Kräuterwürzig", "Scharfe Gewürze", "Mineralisch", "Sonstige",
  ],
  rose: [
    "Floral", "Grüne Früchte", "Zitrusfrüchte", "Steinobst",
    "Rote Früchte", "Krautig", "Kräuterwürzig", "Mineralisch", "Sonstige",
  ],
  schaum: [
    "Floral", "Grüne Früchte", "Zitrusfrüchte", "Steinobst",
    "Rote Früchte", "Krautig", "Kräuterwürzig", "Mineralisch", "Sonstige",
  ],
  suess: [
    "Floral", "Grüne Früchte", "Zitrusfrüchte", "Steinobst", "Tropische Früchte",
    "Rote Früchte", "Schwarze Früchte", "Getrocknete / gekochte Früchte",
    "Krautig", "Kräuterwürzig", "Scharfe Gewürze", "Mineralisch", "Sonstige",
  ],
};

export const AROMA_SUBTITLE: Record<"default" | "schaum" | "suess", string> = {
  schaum: "WSET-Level-3-Weinlexikon – bei Schaumwein mit besonderem Fokus auf Autolyse, Hefesatz und Mousse.",
  suess:
    "WSET-Level-3-Weinlexikon – Botrytis-/Süssweinstile und oxidativ gereifte gespritete Weine werden getrennt dargestellt.",
  default: "WSET-Level-3-Weinlexikon – nach Weinart auf die typischerweise relevanten Aromafamilien gefiltert.",
};

const VALID_TYPES: SatType[] = ["rot", "weiss", "rose", "schaum", "suess"];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function isSatType(value: unknown): value is SatType {
  return VALID_TYPES.includes(value as SatType);
}

function emptyTypeState(): { fields: SatFields; aromas: SatAromas } {
  return { fields: { balance: "1" }, aromas: {} };
}

export function freshData(today: string): SatData {
  return {
    type: "rot",
    meta: { date: today },
    fields: { balance: "1" },
    aromas: {},
    byType: {
      rot: emptyTypeState(),
      weiss: emptyTypeState(),
      rose: emptyTypeState(),
      schaum: emptyTypeState(),
      suess: emptyTypeState(),
    },
    appearanceOther: "",
    notes: "",
  };
}

/** Wie normalizeData() im Tool: füllt fehlende Teile auf und hält byType[type] synchron. */
export function normalizeData(value: unknown, today: string): SatData {
  const base = freshData(today);
  const source = (value && typeof value === "object" ? value : {}) as Partial<SatData>;
  const currentType = isSatType(source.type) ? source.type : base.type;
  const byType = {} as SatData["byType"];

  VALID_TYPES.forEach((t) => {
    const saved =
      source.byType && source.byType[t] && typeof source.byType[t] === "object"
        ? source.byType[t]
        : emptyTypeState();
    byType[t] = {
      fields: { ...emptyTypeState().fields, ...clone(saved.fields || {}) },
      aromas: clone(saved.aromas || {}),
    };
  });

  const visibleFields =
    source.fields && typeof source.fields === "object" ? clone(source.fields) : clone(byType[currentType].fields);
  const visibleAromas =
    source.aromas && typeof source.aromas === "object" ? clone(source.aromas) : clone(byType[currentType].aromas);

  byType[currentType] = {
    fields: { ...emptyTypeState().fields, ...visibleFields },
    aromas: visibleAromas,
  };

  return {
    type: currentType,
    meta: { ...base.meta, ...(source.meta && typeof source.meta === "object" ? source.meta : {}) },
    fields: { ...emptyTypeState().fields, ...visibleFields },
    aromas: visibleAromas,
    byType,
    appearanceOther: typeof source.appearanceOther === "string" ? source.appearanceOther : "",
    notes: typeof source.notes === "string" ? source.notes : "",
  };
}

/** Typwechsel: aktuellen Stand unter byType sichern und den des neuen Typs laden. */
export function switchType(data: SatData, next: SatType): SatData {
  const saved: SatData = {
    ...data,
    byType: { ...data.byType, [data.type]: { fields: clone(data.fields), aromas: clone(data.aromas) } },
  };
  const state = saved.byType[next] ?? emptyTypeState();
  return {
    ...saved,
    type: next,
    fields: { ...emptyTypeState().fields, ...clone(state.fields || {}) },
    aromas: clone(state.aromas || {}),
  };
}

/** byType[type] mit dem sichtbaren Stand synchron halten (saveCurrentTypeState im Tool). */
export function withCurrentTypeState(data: SatData): SatData {
  return {
    ...data,
    byType: { ...data.byType, [data.type]: { fields: clone(data.fields), aromas: clone(data.aromas) } },
  };
}

export function tanninVisible(type: SatType) {
  return type === "rot" || type === "suess";
}

export function mousseVisible(type: SatType) {
  return type === "schaum";
}

export type AromaLevel = "primary" | "secondary" | "tertiary";

export function aromaBlocksForType(type: SatType): { key: AromaLevel; title: string; sub: string; groups: [string, string[]][] }[] {
  let tertiaryType = AROMAS.tertiaryWhite;
  if (type === "rot") tertiaryType = AROMAS.tertiaryRed;
  if (type === "suess") tertiaryType = AROMAS.tertiarySweet;
  const allowedPrimary = new Set(PRIMARY_GROUPS_BY_TYPE[type] || PRIMARY_GROUPS_BY_TYPE.weiss);
  const secondary = type === "schaum" ? AROMAS.secondarySparkling : AROMAS.secondary;
  // Optionen alphabetisch wie im Tool (localeCompare, Gross-/Kleinschreibung egal).
  const sorted = (groups: [string, string][]): [string, string[]][] =>
    groups.map(([group, list]) => [
      group,
      list.split("|").sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })),
    ]);
  return [
    {
      key: "primary",
      title: AROMAS.primary.title!,
      sub: AROMAS.primary.sub!,
      groups: sorted(AROMAS.primary.groups.filter(([group]) => allowedPrimary.has(group))),
    },
    { key: "secondary", title: secondary.title!, sub: secondary.sub!, groups: sorted(secondary.groups) },
    {
      key: "tertiary",
      title: AROMAS.tertiaryCommon.title!,
      sub: AROMAS.tertiaryCommon.sub!,
      groups: sorted([...AROMAS.tertiaryCommon.groups, ...tertiaryType.groups]),
    },
  ];
}

export function aromaStats(data: SatData) {
  const levelGroups: Record<AromaLevel, Set<string>> = {
    primary: new Set(),
    secondary: new Set(),
    tertiary: new Set(),
  };
  aromaBlocksForType(data.type).forEach(({ key, groups }) => groups.forEach(([group]) => levelGroups[key].add(group)));
  const visible = new Set([...levelGroups.primary, ...levelGroups.secondary, ...levelGroups.tertiary]);
  const groups = Object.keys(data.aromas).filter(
    (group) => visible.has(group) && Array.isArray(data.aromas[group]) && data.aromas[group].length,
  );
  const count = groups.reduce((total, group) => total + data.aromas[group].length, 0);
  const levels = {
    primary: groups.filter((g) => levelGroups.primary.has(g)).length,
    secondary: groups.filter((g) => levelGroups.secondary.has(g)).length,
    tertiary: groups.filter((g) => levelGroups.tertiary.has(g)).length,
  };
  return { groups: groups.length, count, levels };
}

export function suggestedScore(data: SatData, key: string): number | null {
  if (key === "balance") return 1;
  if (key === "laenge") {
    const map: Record<string, number> = { kurz: 0, "mittel (−)": 0.5, mittel: 0.5, "mittel (+)": 0.5, lang: 1 };
    const v = data.fields.abgang;
    return typeof v === "string" && v in map ? map[v] : null;
  }
  if (key === "intensitaet") {
    const map: Record<string, number> = {
      zart: 0, "mittel (−)": 0.5, mittel: 0.5, "mittel (+)": 0.5, ausgeprägt: 1,
    };
    const v = data.fields.geschmackIntensitaet;
    return typeof v === "string" && v in map ? map[v] : null;
  }
  if (key === "komplexitaet") {
    const stats = aromaStats(data);
    const layers = Object.values(stats.levels).filter((v) => v > 0).length;
    if (stats.count === 0) return null;
    if (stats.count >= 7 && stats.groups >= 4 && layers >= 2) return 1;
    if (stats.count >= 4 && stats.groups >= 3) return 0.5;
    return 0;
  }
  return null;
}

export function qualityForScore(sum: number) {
  return sum === 4
    ? "hervorragend"
    : sum >= 3
      ? "sehr gut"
      : sum >= 2
        ? "gut"
        : sum >= 1
          ? "durchschnittlich"
          : "schwach";
}

/**
 * autoEvaluate() aus dem Tool: Punktevorschläge für nicht manuell gesetzte Kriterien,
 * Summe, automatische Qualität (Flag _autoQuality) und „fehlerhaft“ bei Fehlertönen.
 */
export function autoEvaluate(input: SatData, manualScores: ReadonlySet<string>) {
  const data: SatData = { ...input, fields: { ...input.fields } };
  SCORE_KEYS.forEach((key) => {
    if (manualScores.has(key)) return;
    const value = suggestedScore(data, key);
    if (value === null) delete data.fields[key];
    else data.fields[key] = String(value);
  });

  const complete = SCORE_KEYS.every((key) => Number.isFinite(parseFloat(String(data.fields[key]))));
  let score: number | null = null;
  let quality: string | null = null;
  if (complete) {
    score = SCORE_KEYS.reduce((total, key) => total + parseFloat(String(data.fields[key])), 0);
    quality = qualityForScore(score);
    if (!data.fields.qualitaet || data.fields._autoQuality) {
      data.fields.qualitaet = quality;
      data.fields._autoQuality = true;
    }
  } else if (data.fields._autoQuality) {
    delete data.fields.qualitaet;
    delete data.fields._autoQuality;
  }
  if (data.fields.klarheit === "trüb (fehlerhaft?)" || data.fields.reintoenigkeit === "unsauber (fehlerhaft?)") {
    data.fields.qualitaet = "fehlerhaft";
    data.fields._autoQuality = true;
  }
  return { data: withCurrentTypeState(data), score, quality };
}

/** Klick auf eine Pille (pills()-Handler im Tool). */
export function toggleField(data: SatData, field: FieldDef | { key: string; multi?: boolean }, option: string): SatData {
  const fields = { ...data.fields };
  if (field.multi) {
    const arr = Array.isArray(fields[field.key]) ? (fields[field.key] as string[]) : [];
    fields[field.key] = arr.includes(option) ? arr.filter((x) => x !== option) : arr.concat(option);
  } else {
    fields[field.key] = fields[field.key] === option ? null : option;
    // Abweichung vom Tool: Dort überschreibt autoEvaluate eine von Hand gewählte
    // Qualität sofort wieder (_autoQuality bleibt gesetzt). Eine Wahl von Hand gilt.
    if (field.key === "qualitaet") fields._autoQuality = false;
  }
  return { ...data, fields };
}

export function toggleAroma(data: SatData, group: string, option: string): SatData {
  const aromas = { ...data.aromas };
  const arr = Array.isArray(aromas[group]) ? aromas[group] : [];
  aromas[group] = arr.includes(option) ? arr.filter((x) => x !== option) : arr.concat(option);
  if (!aromas[group].length) delete aromas[group];
  return { ...data, aromas };
}

/**
 * Beim Laden einer gespeicherten Verkostung: Kriterien, deren Wert vom Vorschlag
 * abweicht, gelten als manuell gesetzt – sonst würde autoEvaluate sie überschreiben.
 */
export function manualScoresFromData(data: SatData) {
  const manual = new Set<string>();
  SCORE_KEYS.forEach((key) => {
    const value = data.fields[key];
    if (value == null) return;
    const suggestion = suggestedScore(data, key);
    if (suggestion === null || String(suggestion) !== String(value)) manual.add(key);
  });
  return manual;
}

export function currentScore(data: SatData) {
  const complete = SCORE_KEYS.every((key) => Number.isFinite(parseFloat(String(data.fields[key]))));
  return complete ? SCORE_KEYS.reduce((t, key) => t + parseFloat(String(data.fields[key])), 0) : null;
}

/** „Als Text kopieren“ (toText() im Tool). */
export function toText(data: SatData) {
  const f = data.fields;
  const s = (v: FieldValue) => (typeof v === "string" && v ? v : "—");
  const list = (v: FieldValue) => (Array.isArray(v) && v.length ? v.join(", ") : "—");
  const lines = [
    "WSET LEVEL 3 – SYSTEMATISCHES VERKOSTEN",
    "",
    `Wein: ${data.meta.name || "—"}`,
    `Produzent: ${data.meta.producer || "—"}`,
    `Region: ${data.meta.region || "—"}`,
    `Jahrgang: ${data.meta.vintage || "—"}`,
    `Rebsorte(n): ${data.meta.grape || "—"}`,
    "",
    "OPTISCHER EINDRUCK",
    `Klarheit: ${s(f.klarheit)}`,
    `Farbtiefe: ${s(f.farbtiefe)}`,
    `Farbton: ${s(f.farbton)}`,
    `Andere Eindrücke: ${data.appearanceOther || "—"}`,
    "",
    "GERUCH",
    `Reintönigkeit: ${s(f.reintoenigkeit)}`,
    `Intensität: ${s(f.geruchIntensitaet)}`,
    `Aromaausprägung: ${list(f.aromaauspraegung)}`,
    `Entwicklungsstadium: ${s(f.entwicklung)}`,
    "",
    "AROMEN",
  ];
  const visible = new Set<string>();
  aromaBlocksForType(data.type).forEach(({ groups }) => groups.forEach(([g]) => visible.add(g)));
  Object.entries(data.aromas)
    .filter(([k]) => visible.has(k))
    .forEach(([k, v]) => lines.push(`${k}: ${v.join(", ")}`));
  lines.push("", "GESCHMACK", `Süsse: ${s(f.suesse)}`, `Säure: ${s(f.saeure)}`);
  if (tanninVisible(data.type)) lines.push(`Tannin: ${s(f.tannin)}`);
  lines.push(`Alkohol: ${s(f.alkohol)}`, `Körper: ${s(f.koerper)}`);
  if (mousseVisible(data.type)) lines.push(`Mousse: ${s(f.mousse)}`);
  lines.push(
    `Geschmacksintensität: ${s(f.geschmackIntensitaet)}`,
    `Geschmacksausprägung: ${list(f.geschmacksauspraegung)}`,
    `Abgang: ${s(f.abgang)}`,
    "",
    "GESAMTEINDRUCK",
    `Qualität: ${s(f.qualitaet)}`,
    `Trinkreife/Reifungspotenzial: ${s(f.trinkreife)}`,
    "",
    `Notizen: ${data.notes || "—"}`,
  );
  return lines.join("\n");
}

/** Weintyp der App → Startauswahl im Formular. */
export function satTypeForWine(type: string | null | undefined): SatType {
  switch (type) {
    case "red":
      return "rot";
    case "rose":
      return "rose";
    case "sparkling":
      return "schaum";
    case "sweet":
    case "fortified":
      return "suess";
    default:
      return "weiss";
  }
}
