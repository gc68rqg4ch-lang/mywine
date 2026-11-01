// Produzenten einheitlich halten (rein): einen Namen mit den vorhandenen Produzenten abgleichen,
// ohne Wort- oder Namenslisten (keine Liste von Rechtsformen).
// - gleich: nach Normalisierung identisch → vorhandene Schreibweise übernehmen
// - ähnlich: ein Name steckt im anderen (ab MIN_SIMILAR Zeichen) → nachfragen bzw. hinweisen
// - neu: nichts Ähnliches

/**
 * Normalisiert: klein, ohne Akzente, Klammerinhalt weg (keepParens: Klammern behalten, nur die
 * Zeichen weg), ohne Satzzeichen und Leerzeichen („Distilleria Giovannipoli (Casa Grappa)“ →
 * „distilleriagiovannipoli“).
 */
export function producerKey(name: string | null | undefined, options: { keepParens?: boolean } = {}) {
  let s = (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss");
  if (!options.keepParens) s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  return s.replace(/[^a-z0-9]+/g, "");
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
