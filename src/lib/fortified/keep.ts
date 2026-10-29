// Likörweine (type fortified): wie lange eine offene Flasche gut bleibt (Kühlschrank, verschlossen).
// wines.open_keep_days mit Herkunft open_keep_source (research / estimate / manual) und Notiz.
// „Gut bis“ wird nie gespeichert: immer Öffnungsdatum + Tage. Rein, ohne DB.
// Rangfolge wie beim Trinkfenster: manual nie automatisch überschreiben, research ersetzt
// estimate, estimate ersetzt nichts.

export const KEEP_SOURCES = ["research", "estimate", "manual"] as const;
export type KeepSource = (typeof KEEP_SOURCES)[number];
export const asKeepSource = (v: unknown): KeepSource | null => ((KEEP_SOURCES as readonly unknown[]).includes(v) ? (v as KeepSource) : null);

export const KEEP_SOURCE_LABELS: Record<KeepSource, string> = { research: "recherchiert", estimate: "geschätzt", manual: "von Hand" };

/** Stile mit geschätzter Haltbarkeit offen (Tage). */
export const KEEP_STYLES = {
  fino_manzanilla: { label: "Fino/Manzanilla", days: 7 },
  amontillado: { label: "Amontillado", days: 21 },
  oloroso_cream_px: { label: "Oloroso/Cream/Pedro Ximénez", days: 60 },
  port_white_ruby_reserve: { label: "Weisser Port/Ruby/Reserve", days: 28 },
  port_lbv: { label: "LBV", days: 21 },
  port_tawny: { label: "Tawny", days: 42 },
  port_tawny_aged: { label: "Tawny mit Altersangabe (10/20/30/40 Jahre)", days: 60 },
  port_vintage: { label: "Vintage Port/Colheita mit Depot", days: 3 },
  madeira: { label: "Madeira", days: 365 },
  marsala: { label: "Marsala", days: 90 },
  vermouth: { label: "Wermut", days: 60 },
  vdn: { label: "Vin Doux Naturel/Banyuls/Maury", days: 30 },
  unknown: { label: "Stil unbekannt", days: 30 },
} as const;
export type KeepStyle = keyof typeof KEEP_STYLES;
export const KEEP_STYLE_KEYS = Object.keys(KEEP_STYLES) as KeepStyle[];

export type FoundKeep = { days: number; source: "research" | "estimate"; note: string | null };
export type StoredKeep = { days: number | null; source: KeepSource | null };

/** Schätzung nach Stil (unbekannt: 30 Tage). */
export function estimateKeep(style: KeepStyle | null | undefined): FoundKeep {
  const s = KEEP_STYLES[style ?? "unknown"] ?? KEEP_STYLES.unknown;
  return { days: s.days, source: "estimate", note: `Schätzung nach Stil: ${s.label}` };
}

/**
 * Stil aus Name, Produzent und Region erraten (ohne Recherche, z. B. wenn sie nichts liefert).
 * Reihenfolge: genaue Angaben (Alter, LBV, Vintage) vor allgemeinen (Port, Sherry).
 */
export function guessKeepStyle(wine: { name: string; producer?: string | null; region?: string | null; appellation?: string | null; country?: string | null }): KeepStyle {
  const t = ` ${[wine.name, wine.producer, wine.region, wine.appellation].filter(Boolean).join(" ")} `.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  if (has(/\b(fino|manzanilla)\b/)) return "fino_manzanilla";
  if (has(/\bamontillado\b/)) return "amontillado";
  if (has(/\b(oloroso|cream|pedro xim[eé]nez|px)\b/)) return "oloroso_cream_px";
  if (has(/\bmadeira\b|\b(sercial|verdelho|bual|boal|malmsey|malvasia)\b/)) return "madeira";
  if (has(/\bmarsala\b/)) return "marsala";
  if (has(/\b(wermut|vermouth|vermut|antica formula|carpano|cocchi|noilly|martini rosso|dolin)\b/)) return "vermouth";
  if (has(/\b(banyuls|maury|rivesaltes|rasteau|vin doux naturel|vdn|muscat de beaumes)\b/)) return "vdn";
  const port = has(/\b(port|porto|portwein|douro|quinta)\b/) || wine.country === "Portugal";
  if (port) {
    if (has(/\b(lbv|late bottled)\b/)) return "port_lbv";
    if (has(/\b(vintage|colheita|crusted)\b/)) return "port_vintage";
    if (has(/\btawny\b/)) return has(/\b(10|20|30|40)\s*(years?|jahre|anos)\b/) ? "port_tawny_aged" : "port_tawny";
    if (has(/\b(10|20|30|40)\s*(years?|jahre|anos)\b/)) return "port_tawny_aged";
    if (has(/\b(white|weiss|weisser|branco|fine white|ruby|reserve|reserva)\b/)) return "port_white_ruby_reserve";
    return "port_white_ruby_reserve";
  }
  if (has(/\b(sherry|jerez|xer[eè]s)\b/)) return "oloroso_cream_px";
  return "unknown";
}

/** Was mit einer gefundenen Haltbarkeit passiert: setzen oder lassen. */
export function decideKeep(existing: StoredKeep | null, found: FoundKeep): "set" | "keep" {
  if (!Number.isInteger(found.days) || found.days < 1 || found.days > 3650) return "keep";
  if (!existing || existing.days == null) return "set";
  // Werte ohne Herkunft gelten als von Hand.
  const source = existing.source ?? "manual";
  if (source === "estimate") return found.source === "research" && found.days !== existing.days ? "set" : "keep";
  return "keep"; // manual, research
}

const DAY = 86_400_000;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Gut bis (YYYY-MM-DD) = Öffnungsdatum + Tage; null ohne eines von beiden. */
export function keepUntil(dateOpened: string | null | undefined, days: number | null | undefined) {
  if (!dateOpened || !days || !/^\d{4}-\d{2}-\d{2}/.test(dateOpened)) return null;
  return isoOf(toUtc(dateOpened) + days * DAY);
}

/** „25.11.“ */
export function shortDate(iso: string) {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.`;
}

/** Hinweis wie bei der Trinkreife: now = „bald trinken“, overdue = „über der Zeit“. */
export type KeepStatus = { until: string; text: string; hint: string | null; status: "ok" | "now" | "overdue" };

/** Ab so vielen Tagen vor „gut bis“: „bald trinken“. */
export const KEEP_SOON_DAYS = 7;

/**
 * „offen gut bis 25.11.“; ab 7 Tagen davor zusätzlich „bald trinken“, danach „3 Tage über der
 * Zeit“. today = heutiges Datum (YYYY-MM-DD, Europe/Zurich).
 */
export function keepStatus(dateOpened: string | null | undefined, days: number | null | undefined, today: string): KeepStatus | null {
  const until = keepUntil(dateOpened, days);
  if (!until) return null;
  const left = Math.round((toUtc(until) - toUtc(today)) / DAY);
  const text = `offen gut bis ${shortDate(until)}`;
  if (left < 0) return { until, text, hint: `${-left} ${-left === 1 ? "Tag" : "Tage"} über der Zeit`, status: "overdue" };
  if (left <= KEEP_SOON_DAYS) return { until, text, hint: "bald trinken", status: "now" };
  return { until, text, hint: null, status: "ok" };
}

/** Eine Zeile: „offen gut bis 25.11. · bald trinken“. */
export const keepLine = (s: KeepStatus | null) => (s ? [s.text, s.hint].filter(Boolean).join(" · ") : null);

/** Dauer lesbar: „1 Woche“, „ca. 4 Wochen“, „ca. 2 Monate“, „ca. 1 Jahr“. */
export function keepDuration(days: number) {
  if (days < 7) return days === 1 ? "1 Tag" : `${days} Tage`;
  if (days < 56) {
    const w = Math.round(days / 7);
    return `ca. ${w} ${w === 1 ? "Woche" : "Wochen"}`;
  }
  if (days < 330) {
    const m = Math.round(days / 30);
    return `ca. ${m} ${m === 1 ? "Monat" : "Monate"}`;
  }
  const y = Math.round(days / 365);
  return `ca. ${y} ${y === 1 ? "Jahr" : "Jahre"}`;
}

/** Weinseite: „offen ca. 4 Wochen“ bzw. „offen ≈ 4 Wochen“ bei Schätzung. */
export function keepText(days: number | null, source: KeepSource | null) {
  if (!days) return null;
  const d = keepDuration(days);
  return source === "estimate" ? `offen ≈ ${d.replace(/^ca\. /, "")}` : `offen ${d}`;
}
