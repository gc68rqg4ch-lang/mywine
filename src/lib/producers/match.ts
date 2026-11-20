// Produzenten einheitlich halten (rein): einen Namen mit den vorhandenen Produzenten abgleichen,
// ohne Wort- oder Namenslisten (keine Liste von Rechtsformen).
// - gleich: nach Normalisierung identisch (ohne Zusätze wie Vineyards, Cellars, Château) →
//   vorhandene Schreibweise übernehmen
// - ähnlich: ein Name steckt im anderen (ab MIN_SIMILAR Zeichen) → nachfragen bzw. hinweisen
// - neu: nichts Ähnliches

/**
 * Typische Zusätze zum eigentlichen Namen des Produzenten – beim Vergleich egal („DAOU“ =
 * „Daou Vineyards“, „Orin Swift“ = „Orin Swift Cellars“, „Louis Roederer“ = „Champagne Louis
 * Roederer“). Ganze Wörter bzw. Wortfolgen (gefaltet), mehrwortige zuerst.
 */
export const PRODUCER_ADDITIONS = [
  "family estates", "wine company", "vineyards", "vineyard", "winery", "wines", "cellars", "cellar", "estates", "estate",
  "distillery", "champagne", "chateau", "domaine", "weingut", "bodegas", "bodega", "cantina", "quinta",
] as const;

const ADDITION_RE = new RegExp(`(^| )(${PRODUCER_ADDITIONS.join("|")})(?= |$)`, "g");

/** Wörter ohne Akzente, klein, ohne Satzzeichen („Château d'Yquem“ → „chateau d yquem“). */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();

/** Ohne typische Zusätze (Vineyards, Cellars, Château …); bleibt nichts übrig: unverändert. */
export function withoutAdditions(folded: string) {
  const rest = folded.replace(ADDITION_RE, " ").replace(/\s+/g, " ").trim();
  return rest || folded;
}

/**
 * Normalisiert: klein, ohne Akzente, Klammerinhalt weg (keepParens: Klammern behalten, nur die
 * Zeichen weg), ohne typische Zusätze (PRODUCER_ADDITIONS; keepAdditions: mit), ohne Satzzeichen
 * und Leerzeichen („Distilleria Giovannipoli (Casa Grappa)“ → „distilleriagiovannipoli“,
 * „Daou Vineyards“ → „daou“).
 */
export function producerKey(name: string | null | undefined, options: { keepParens?: boolean; keepAdditions?: boolean } = {}) {
  let s = name ?? "";
  if (!options.keepParens) s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  let folded = fold(s);
  if (!options.keepAdditions) folded = withoutAdditions(folded);
  return folded.replace(/ /g, "");
}

/** Ab so vielen Zeichen (normalisiert) gilt „steckt im anderen“ als ähnlich – kürzere sind zu unspezifisch. */
export const MIN_SIMILAR = 6;

export type ProducerMatch =
  | { kind: "same"; producer: string }
  | { kind: "similar"; candidates: string[] }
  | { kind: "new" };

/** Steckt der eine Name im anderen (mit bzw. ohne Klammerinhalt)? Der kürzere mindestens MIN_SIMILAR Zeichen. */
export function similarProducers(a: string, b: string) {
  const [ka, kb] = [producerKey(a), producerKey(b)];
  if (!ka || !kb || ka === kb) return false;
  const pairs: [string, string][] = [
    [ka, producerKey(b, { keepParens: true })],
    [kb, producerKey(a, { keepParens: true })],
    [ka, kb],
    [ka, producerKey(b, { keepParens: true, keepAdditions: true })],
    [kb, producerKey(a, { keepParens: true, keepAdditions: true })],
  ];
  return pairs.some(([short, long]) => short.length >= MIN_SIMILAR && short !== long && long.includes(short));
}

/** Gleich nach Normalisierung? */
export const sameProducer = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = producerKey(a);
  return ka !== "" && ka === producerKey(b);
};

/**
 * Abgleich mit den vorhandenen Produzenten: gleich (vorhandene Schreibweise; bei mehreren
 * gleichen die häufigste, sonst die erste), ähnlich (bis zu max Treffer) oder neu.
 */
export function matchProducer(name: string | null | undefined, existing: string[], max = 3): ProducerMatch {
  const wanted = (name ?? "").trim();
  if (!producerKey(wanted)) return { kind: "new" };
  const counts = new Map<string, number>();
  for (const p of existing) if (p?.trim()) counts.set(p.trim(), (counts.get(p.trim()) ?? 0) + 1);
  const unique = [...counts.keys()];
  const same = unique.filter((p) => sameProducer(p, wanted)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  if (same.length) return { kind: "same", producer: same.includes(wanted) ? wanted : same[0] };
  const similar = unique
    .filter((p) => similarProducers(p, wanted))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, "de-CH"))
    .slice(0, max);
  return similar.length ? { kind: "similar", candidates: similar } : { kind: "new" };
}

/** Andere Schreibweise desselben Produzenten (gleich oder ähnlich) – z. B. nur Rechtsform oder Zusatz? */
export const sameOrSimilarProducer = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && (sameProducer(a, b) || similarProducers(a, b));

/** Wörter eines Textes mit ihrer Position im Original (für das Abschneiden ohne Umformatieren). */
function wordSpans(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map((m) => ({ folded: fold(m[0]).replace(/ /g, ""), start: m.index!, end: m.index! + m[0].length }));
}

const NAME_FILLERS = new Set(["de", "du", "des", "del", "della", "di", "da", "do", "dos", "das", "la", "le", "les", "el", "los", "las", "the", "of", "von"]);

/**
 * Produzent nicht im Weinnamen: beginnt der Name mit dem Produzenten bzw. einer Variante davon
 * (ohne Zusätze wie Vineyards, Cellars, Château – gleich normalisiert wie beim Abgleich), fällt
 * dieser Teil weg: „DAOU Reserve Cabernet Sauvignon“ (DAOU Vineyards) → „Reserve Cabernet
 * Sauvignon“. Unverändert, wenn danach nichts übrig bliebe oder der Rest mit „de/du/of …“
 * beginnt („Margaux du Château Margaux“).
 */
export function stripProducerFromName(name: string | null, producer: string | null | undefined): string | null {
  if (!name?.trim() || !producer?.trim()) return name;
  const words = wordSpans(name);
  const variants = [producerKey(producer, { keepAdditions: true }), producerKey(producer)].filter(Boolean);
  for (const variant of [...new Set(variants)].sort((a, b) => b.length - a.length)) {
    // Kleinster Anfang des Namens (ganze Wörter), der normalisiert gleich der Variante ist.
    let acc = "";
    for (let i = 0; i < words.length; i++) {
      acc += words[i].folded;
      if (!variant.startsWith(acc)) break;
      if (acc !== variant) continue;
      // Zusätze direkt dahinter gehören noch zum Produzenten („Daou Vineyards Reserve …“).
      let end = i;
      for (let k = end + 1; k < words.length; k++) {
        const two = k + 1 < words.length ? `${words[k].folded} ${words[k + 1].folded}` : "";
        if ((PRODUCER_ADDITIONS as readonly string[]).includes(two)) k++;
        else if (!(PRODUCER_ADDITIONS as readonly string[]).includes(words[k].folded)) break;
        end = k;
      }
      const rest = name.slice(words[end].end).replace(/^[\s\-–—,:·.|/]+/, "");
      const next = words[end + 1];
      if (!rest.trim() || !next || NAME_FILLERS.has(next.folded)) return name;
      return rest.trim();
    }
  }
  return name;
}
