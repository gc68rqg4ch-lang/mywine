// Änderungsvorschläge des Chat-Modus. Ein Vorschlag steckt vollständig im
// callback_data des [Ja]-Buttons (max. 64 Bytes) – es braucht keinen Zwischenspeicher.
// Ausgeführt wird erst nach dem Klick, mit erneuter Prüfung des aktuellen Zustands.

import type { TgInlineKeyboard } from "@/lib/telegram/types";

export const GLASS_ML = 150;

export type Proposal =
  | { kind: "fill"; itemId: string; percent: number }
  | { kind: "open"; itemId: string }
  | { kind: "drunk"; itemId: string }
  | { kind: "rate"; wineId: string; vintageYear: number | null; personKey: string; rating: number }
  /** Spirituose: Füllstand der aktuellen Flasche (0 = leer). */
  | { kind: "spiritFill"; wineId: string; percent: number }
  /** Spirituose: aktuelle Flasche leer, die nächste wird aktuell. */
  | { kind: "spiritEmpty"; wineId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);

/** Kürzel einer Person im callback_data (Anfang der UUID). */
export function personKey(personId: string) {
  return personId.slice(0, 8);
}

export function encodeProposal(p: Proposal) {
  switch (p.kind) {
    case "fill":
      return `cf:${p.itemId}:${p.percent}`;
    case "open":
      return `co:${p.itemId}`;
    case "drunk":
      return `cd:${p.itemId}`;
    case "rate":
      return `cr:${p.wineId}:${p.vintageYear ?? "-"}:${p.personKey}:${Math.round(p.rating * 2)}`;
    case "spiritFill":
      return `cs:${p.wineId}:${p.percent}`;
    case "spiritEmpty":
      return `cz:${p.wineId}`;
  }
}

export const REJECT_DATA = "cx";

/**
 * Bearbeitungen (Wein, Charge, Jahrgang …) passen nicht in 64 Bytes: Sie liegen bis zur
 * Antwort in ingest_jobs (source = telegram_edit); die Knöpfe tragen nur die Job-ID.
 */
export const editYes = (jobId: string) => `ce:${jobId}`;
export const editNo = (jobId: string) => `cn:${jobId}`;
/** Die zweite Möglichkeit eines Vorschlags (z. B. „Eintrag und Wein“). */
export const editAlt = (jobId: string) => `cw:${jobId}`;

export function decodeEditCallback(data: string | undefined) {
  const [tag, id] = (data ?? "").split(":");
  if ((tag !== "ce" && tag !== "cn" && tag !== "cw") || !UUID_RE.test(id ?? "")) return null;
  return { confirm: tag !== "cn", alternative: tag === "cw", jobId: id };
}

export function editKeyboard(jobId: string, labels: { yes: string; no: string } = { yes: "Ja", no: "Nein" }): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: labels.yes, callback_data: editYes(jobId) }, { text: labels.no, callback_data: editNo(jobId) }]] };
}

export function isChatCallback(data: string | undefined) {
  return data === REJECT_DATA || /^c[fodrnewsz]:/.test(data ?? "");
}

export function decodeProposal(data: string | undefined): Proposal | null {
  const [tag, ...rest] = (data ?? "").split(":");
  const id = rest[0] ?? "";
  if (!UUID_RE.test(id)) return null;
  switch (tag) {
    case "cf": {
      const percent = Number(rest[1]);
      return rest.length === 2 && Number.isInteger(percent) && percent >= 0 && percent <= 100
        ? { kind: "fill", itemId: id, percent }
        : null;
    }
    case "co":
      return rest.length === 1 ? { kind: "open", itemId: id } : null;
    case "cs": {
      const percent = Number(rest[1]);
      return rest.length === 2 && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? { kind: "spiritFill", wineId: id, percent } : null;
    }
    case "cz":
      return rest.length === 1 ? { kind: "spiritEmpty", wineId: id } : null;
    case "cd":
      return rest.length === 1 ? { kind: "drunk", itemId: id } : null;
    case "cr": {
      if (rest.length !== 4) return null;
      const [, vintage, key, halves] = rest;
      const year = vintage === "-" ? null : Number(vintage);
      const twice = Number(halves);
      if (year != null && !(Number.isInteger(year) && year > 1800 && year < 2200)) return null;
      if (!/^[0-9a-f]{8}$/.test(key) || !Number.isInteger(twice) || twice < 0 || twice > 10) return null;
      return { kind: "rate", wineId: id, vintageYear: year, personKey: key, rating: twice / 2 };
    }
    default:
      return null;
  }
}

export function confirmKeyboard(p: Proposal): TgInlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Ja", callback_data: encodeProposal(p) },
      { text: "Nein", callback_data: REJECT_DATA },
    ]],
  };
}

/**
 * Neuer Füllstand in Prozent nach `glasses` Gläsern (≈ 150 ml) bei gegebener
 * Flaschengrösse; gerundet auf ganze Prozent, nie unter 0.
 */
export function fillAfterGlasses(currentPercent: number, glasses: number, bottleSizeMl: number) {
  const size = bottleSizeMl > 0 ? bottleSizeMl : 750;
  const next = currentPercent - (glasses * GLASS_ML * 100) / size;
  return Math.max(0, Math.min(100, Math.round(next)));
}
