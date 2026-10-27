// Rebsorten mit optionalem Prozentanteil – reine Helfer, auch im Browser nutzbar.

export type GrapeShare = { grape: string; percent: number | null };

/** Werte der Spalte wine_grape_shares.source. */
export type GrapeSource = "import" | "label" | "research" | "manual";

export const GRAPE_SOURCE_LABELS: Record<GrapeSource, string> = {
  import: "Import",
  label: "Etikett",
  research: "Recherche",
  manual: "manuell",
};

export function isGrapeSource(value: string): value is GrapeSource {
  return value in GRAPE_SOURCE_LABELS;
}

/** Summe der angegebenen Prozente (Rebsorten ohne Prozent zählen nicht). */
export function percentSum(shares: GrapeShare[]) {
  return Math.round(shares.reduce((sum, s) => sum + (s.percent ?? 0), 0) * 100) / 100;
}

/**
 * Trimmt, entfernt Duplikate (ohne Gross-/Kleinschreibung) und unplausible Prozente.
 * Ergeben die Prozente zusammen mehr als 100 (Rundung toleriert), sind sie nicht
 * vertrauenswürdig und werden verworfen – die Rebsorten bleiben.
 */
export function normalizeGrapeShares(shares: GrapeShare[]): GrapeShare[] {
  const seen = new Set<string>();
  const result: GrapeShare[] = [];
  for (const share of shares) {
    const grape = share.grape.trim().replace(/\s+/g, " ");
    const key = grape.toLocaleLowerCase("de-CH");
    if (!grape || seen.has(key)) continue;
    seen.add(key);
    const p = share.percent;
    const percent = p != null && Number.isFinite(p) && p > 0 && p <= 100 ? Math.round(p * 100) / 100 : null;
    result.push({ grape, percent });
  }
  if (percentSum(result) > 100.5) return result.map((s) => ({ ...s, percent: null }));
  return result;
}

/** true, wenn es Rebsorten gibt und jede einen Prozentanteil hat. */
export function hasCompletePercents(shares: GrapeShare[]) {
  return shares.length > 0 && shares.every((s) => s.percent != null);
}

export function hasAnyPercent(shares: GrapeShare[]) {
  return shares.some((s) => s.percent != null);
}

export function formatShare(share: GrapeShare) {
  return share.percent == null
    ? share.grape
    : `${share.grape} ${share.percent.toLocaleString("de-CH")} %`;
}

export function formatShares(shares: GrapeShare[]) {
  return shares.map(formatShare).join(", ");
}
