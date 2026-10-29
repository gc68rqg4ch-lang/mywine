// Kategorien der Spirituosen für Antoine (Erkennung Foto/Text, Recherche) – zur Laufzeit aus
// spirit_categories (sortiert nach sort_order), nicht fest im Code. Die feste Liste unten ist nur
// der Rückfall, wenn die DB nicht lesbar ist. Rein: baut Schema (enum) und Text der Liste.

import { z } from "zod";
import { mainCategories, subCategories, type SpiritCategory } from "./categories";

/** Rückfall (Stand der Tabelle beim Umbau): Haupt- und Unterkategorien in Reihenfolge. */
const FALLBACK_TREE: [string, string[]][] = [
  ["Whisky", ["Scotch Single Malt", "Scotch Blend", "Bourbon", "Irish", "Japanese", "Schweizer"]],
  ["Likör", ["Frucht", "Kaffee", "Kräuter", "Nuss", "Sahne"]],
  ["Kräuterschnaps / Bitter", []],
  ["Obstbrand", ["Apfel / Calvados", "Kirsch", "Williams", "Zwetschge"]],
  ["Grappa / Trester", []],
  ["Cognac / Brandy", ["Cognac", "Armagnac", "Brandy"]],
  ["Rum", []],
  ["Gin", []],
  ["Vodka", []],
  ["Tequila / Mezcal", []],
  ["Andere", []],
];

export const FALLBACK_CATEGORIES: SpiritCategory[] = FALLBACK_TREE.flatMap(([main, subs], i) => [
  { id: `fallback-${i}`, parentId: null, name: main, sortOrder: (i + 1) * 10 },
  ...subs.map((sub, k) => ({ id: `fallback-${i}-${k}`, parentId: `fallback-${i}`, name: sub, sortOrder: (k + 1) * 10 })),
]);

/**
 * Höchstens so viele Werte als enum (Grenze der strukturierten Ausgabe); mehr Hauptkategorien →
 * Text mit Liste in der Beschreibung (Abgleich im Code, matchCategory).
 */
export const MAX_ENUM = 60;

/** Hauptkategorien und Unterkategorien je Hauptkategorie, nach sort_order. */
export function categoryTree(all: SpiritCategory[]) {
  return mainCategories(all).map((m) => ({ main: m.name, subs: subCategories(all, m.id).map((s) => s.name) }));
}

/** Prompt-Liste der Unterkategorien: „Whisky: Bourbon, Irish; Likör: Frucht, …“. */
export function subcategoryText(all: SpiritCategory[]) {
  return categoryTree(all)
    .filter((t) => t.subs.length)
    .map((t) => `${t.main}: ${t.subs.join(", ")}`)
    .join("; ");
}

/**
 * Block „spirit“ der Erkennung (Foto und Text) zu den Kategorien: Hauptkategorie als enum (mit
 * „“ = leer), Unterkategorie als Text mit der Liste (Abgleich im Code). Ohne nullable Felder
 * (Grenze von 16 Union-Feldern): "" bzw. 0 = unbekannt.
 */
export function spiritLabelSchema(all: SpiritCategory[], options: { lenient?: boolean } = {}) {
  const mains = categoryTree(all).map((t) => t.main);
  const mainText = mains.join(", ");
  const category =
    // lenient: zum Einlesen der Antwort – jeder Name gilt (Abgleich im Code, matchCategory),
    // statt den ganzen Block zu verwerfen; das enum geht nur als JSON-Schema an Claude.
    !options.lenient && mains.length && mains.length < MAX_ENUM ? z.enum(["", ...mains] as [string, ...string[]]) : z.string();
  return z
    .object({
      kind: z.enum(["wine", "spirit", "unsure"]).describe("wine = Wein (auch Port, Sherry, Madeira = fortified), spirit = Spirituose (Whisky, Grappa, Likör, Obstbrand, Cognac, Rum, Gin, Vodka, Tequila …), unsure = nicht sicher"),
      category: category.describe(`Bei Spirituosen die Hauptkategorie – nur genau einer dieser Namen, nie einen neuen: ${mainText}; leer, wenn unklar bzw. bei Wein`),
      subcategory: z.string().describe(`Unterkategorie – nur einer dieser Namen, nie einen neuen (sonst leer): ${subcategoryText(all)}`),
      age_years: z.number().describe("Altersangabe in Jahren (z. B. 12 bei „12 Years Old“); 0 = keine"),
      cask: z.string().describe("Fass, Reifung bzw. Finish (z. B. „Sherry Cask Finish“); leer, wenn keins dasteht"),
      distilled_year: z.number().describe("Jahr der Destillation („Distilled 2008“); 0 = keins"),
      bottled_year: z.number().describe("Jahr der Abfüllung („Bottled 2020“); 0 = keins"),
    })
    // Fehlt der Block in der Antwort: Wein (die Erkennung scheitert deswegen nicht).
    .catch({ kind: "wine", category: "", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 });
}
