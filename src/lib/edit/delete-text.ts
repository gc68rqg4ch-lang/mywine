// Texte zum unwiderruflichen Löschen – rein (ohne DB), damit App, Bot und Tests dieselben
// Warnungen zeigen. Löschen heisst „falsch erfasst“, nicht „getrunken“.

import { formatDate, zurichDate } from "@/lib/format";

export type DeletableBottle = {
  status: "sealed" | "open" | "drunk";
  quantity: number;
  storage_room: string | null;
  drunk_at?: string | null;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Wie viele Flaschen gelöscht werden: 1…Anzahl, sonst die ganze Position. */
export function deleteCount(item: Pick<DeletableBottle, "quantity">, count?: number | null) {
  return count == null ? item.quantity : Math.min(Math.max(1, Math.floor(count)), item.quantity);
}

/**
 * Warnung vor dem Löschen von Flaschen, z. B. „1 Flasche aus Charge Wohnzimmer löschen? Sie
 * verschwindet aus dem Bestand und wird im Journal als gelöscht vermerkt. Nicht als getrunken.“
 */
export function deleteBottlesQuestion(item: DeletableBottle, count?: number | null) {
  const n = deleteCount(item, count);
  const room = item.storage_room ?? "ohne Lagerort";
  const verb = n === 1 ? "Sie verschwindet" : "Sie verschwinden";
  const noted = n === 1 ? "wird im Journal als gelöscht vermerkt" : "werden im Journal als gelöscht vermerkt";
  switch (item.status) {
    case "sealed":
      return `${plural(n, "Flasche", "Flaschen")} aus Charge ${room} löschen? ${verb} aus dem Bestand und ${noted}. Nicht als getrunken.`;
    case "open":
      return `Die offene Flasche (${room}) löschen? Sie verschwindet aus dem Bestand und wird im Journal als gelöscht vermerkt. Nicht als getrunken.`;
    case "drunk": {
      const on = item.drunk_at ? ` vom ${formatDate(zurichDate(item.drunk_at))}` : "";
      const what = n === 1 ? `Die getrunkene Flasche${on}` : `${n} getrunkene Flaschen${on}`;
      return `${what} löschen? ${verb} aus „Getrunken“ und ${noted} (falsch erfasst).`;
    }
  }
}

/** Was „Ganzen Wein löschen“ mitnimmt. */
export type WineDeleteSummary = {
  bottles: { sealed: number; open: number; drunk: number };
  ratings: number;
  tastings: number;
  encounters: number;
  photos: number;
  documents: number;
};

/** „7 Flaschen (5 im Bestand, 1 offen, 1 getrunken), 3 Bewertungen, 1 Verkostung, 2 Verkostet-Einträge, 4 Fotos, 1 PDF“ */
export function wineDeleteSummaryText(s: WineDeleteSummary) {
  const total = s.bottles.sealed + s.bottles.open + s.bottles.drunk;
  const detail = [
    s.bottles.sealed ? `${s.bottles.sealed} im Bestand` : null,
    s.bottles.open ? `${s.bottles.open} offen` : null,
    s.bottles.drunk ? `${s.bottles.drunk} getrunken` : null,
  ].filter(Boolean);
  const parts = [
    total ? `${plural(total, "Flasche", "Flaschen")}${detail.length ? ` (${detail.join(", ")})` : ""}` : null,
    s.ratings ? plural(s.ratings, "Bewertung", "Bewertungen") : null,
    s.tastings ? plural(s.tastings, "Verkostung", "Verkostungen") : null,
    s.encounters ? plural(s.encounters, "Verkostet-Eintrag", "Verkostet-Einträge") : null,
    s.photos ? plural(s.photos, "Foto", "Fotos") : null,
    s.documents ? plural(s.documents, "PDF", "PDFs") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nur die Stammdaten";
}

export const IRREVERSIBLE = "Das lässt sich nicht rückgängig machen.";

/** Bestätigung im App-Dialog: Weinname eintippen (ohne Gross-/Kleinschreibung, Leerzeichen egal). */
export function nameConfirmed(typed: string, name: string) {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-CH");
  return norm(typed) !== "" && norm(typed) === norm(name);
}
