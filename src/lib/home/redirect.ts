// Alte Adressen: bis zur Startseite war der Bestand unter „/“. „/?…“ mit Listen-Parametern führt
// jetzt nach „/bestand?…“ mit denselben Parametern; ohne solche bleibt „/“ die Startseite.

type Params = Record<string, string | string[] | undefined>;

/** Parameter der Listen (siehe list-params.ts). */
export const LIST_PARAM_KEYS = ["q", "gruppe", "typ", "auf", "land", "region", "traube", "jv", "jb", "preis", "reife", "sterne", "von_person", "haendler"] as const;

/** Ziel für eine alte Bestand-Adresse – null, wenn „/“ die Startseite bleibt. */
export function legacyListTarget(params: Params): string | null {
  if (!LIST_PARAM_KEYS.some((k) => params[k] !== undefined)) return null;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const v of [value ?? []].flat()) search.append(key, v);
  return `/bestand?${search.toString()}`;
}
