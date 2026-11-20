// Prüfung des Bestands (rein, nur lesend): Produzenten, die nach dem Abgleich gleich sind, aber
// unterschiedlich geschrieben gespeichert wurden; Weinnamen, die mit dem Produzenten beginnen;
// Weinnamen, die nach Herkunfts-/Lagenangaben aussehen. Ändert nichts.

import { producerKey } from "./match";
import { tidyWineName } from "@/lib/ingest/wine-names";
import { foldText } from "@/lib/text/fold";

export type AuditWine = { id: string; name: string; producer: string | null; type?: string | null };

/** Wörter, die auf eine Herkunfts-/Lagenangabe statt einer Cuvée deuten. */
export const ORIGIN_WORDS = ["vignoble", "vignobles", "vineyard", "vineyards", "estate", "lieu dit", "lieudit", "origine", "origines", "terroir", "clos de la", "parcelle", "single vineyard", "grown"];

export function nameAudit(wines: AuditWine[]) {
  // 1. Produzentengruppen: gleicher Schlüssel, verschiedene Schreibweisen (mit Anzahl Weine).
  const groups = new Map<string, Map<string, number>>();
  for (const w of wines) {
    const p = w.producer?.trim();
    if (!p) continue;
    const key = producerKey(p);
    const g = groups.get(key) ?? new Map<string, number>();
    g.set(p, (g.get(p) ?? 0) + 1);
    groups.set(key, g);
  }
  const producerGroups = [...groups.values()]
    .filter((g) => g.size > 1)
    .map((g) => [...g.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).map(([spelling, count]) => ({ spelling, count })))
    .sort((a, b) => a[0].spelling.localeCompare(b[0].spelling, "de"));

  // 2. Weinnamen, die mit dem Produzenten beginnen – wie das Einbuchen sie jetzt kürzen würde
  // (ohne Spirituosen; bleibt nur eine Stufe wie „Reserva“, gehört die Marke dazu).
  const producerInName = wines.flatMap((w) => {
    const suggestion = w.producer ? tidyWineName(w.name, w.producer, w.type) : w.name;
    return suggestion && suggestion !== w.name ? [{ id: w.id, name: w.name, producer: w.producer!, suggestion }] : [];
  });

  // 3. Weinnamen, die nach Herkunfts-/Lagenangaben aussehen.
  const originLike = wines
    .filter((w) => w.type !== "spirit")
    .flatMap((w) => {
      const n = ` ${foldText(w.name)} `;
      const hit = ORIGIN_WORDS.find((word) => n.includes(` ${word} `));
      return hit ? [{ id: w.id, name: w.name, producer: w.producer, word: hit }] : [];
    });
  return { producerGroups, producerInName, originLike };
}

/** Als Text (für Bericht bzw. Konsole). */
export function auditText(result: ReturnType<typeof nameAudit>) {
  const lines: string[] = [];
  lines.push(`Produzentengruppen mit verschiedenen Schreibweisen: ${result.producerGroups.length}`);
  for (const g of result.producerGroups) lines.push(`- ${g.map((s) => `«${s.spelling}» (${s.count})`).join(" = ")}`);
  lines.push("", `Weinnamen, die mit dem Produzenten beginnen: ${result.producerInName.length}`);
  for (const w of result.producerInName) lines.push(`- «${w.name}» (${w.producer}) → «${w.suggestion}»`);
  lines.push("", `Weinnamen wie Herkunfts-/Lagenangaben: ${result.originLike.length}`);
  for (const w of result.originLike) lines.push(`- «${w.name}» (${w.producer ?? "ohne Produzent"}) – „${w.word}“`);
  return lines.join("\n");
}
