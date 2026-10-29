// Recherche einer Spirituose (rein): Schema der Antwort und Prüfung. Ohne Unions (Sentinels statt
// null: "" bzw. 0 = unbekannt) und ohne min/max (strict Tool). Die Kategorie kommt nur aus der
// Liste der bestehenden („Whisky › Bourbon“) – die Recherche legt nie Kategorien an.

import { z } from "zod";
import { COUNTRY_HINT } from "@/lib/format";
import { categoryLabel, categoryPath, type SpiritCategory } from "./categories";
import { MAX_ENUM } from "./ai-categories";

export const UNKNOWN_CATEGORY = "unbekannt";

/** Auswahl der Kategorien als Text: Hauptkategorien und „Haupt › Unter“. */
export function categoryChoices(all: SpiritCategory[]) {
  return all
    .map((c) => ({ id: c.id, label: categoryLabel(categoryPath(all, c.id))! }))
    .filter((c) => c.label)
    .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
}

export function spiritResearchSchema(all: SpiritCategory[]) {
  const labels = categoryChoices(all).map((c) => c.label);
  // Sehr viele Kategorien: Text statt enum (Grenze der strukturierten Ausgabe), Abgleich im Code.
  const category = labels.length < MAX_ENUM ? z.enum([UNKNOWN_CATEGORY, ...labels] as [string, ...string[]]) : z.string();
  return z.object({
    matches_spirit: z.boolean().describe("true nur, wenn die Quellen genau diese Spirituose (Name + Hersteller/Destillerie, gleiche Altersangabe) beschreiben"),
    producer: z.string().describe("Destillerie bzw. Hersteller; leer, wenn unbekannt"),
    country: z.string().describe(`${COUNTRY_HINT}; leer, wenn unbekannt`),
    region: z.string().describe("Region (z. B. Islay, Speyside, Kentucky, Cognac); leer, wenn unbekannt"),
    alcohol_content: z.number().describe("Alkohol in % vol; 0 = unbekannt"),
    age_years: z.number().describe("Altersangabe in Jahren (ganze Zahl); 0 = keine Altersangabe"),
    cask: z.string().describe("Fass, Reifung bzw. Finish (z. B. „Sherry Cask Finish“); leer, wenn unbekannt"),
    distilled_year: z.number().describe("Jahr der Destillation (ganze Zahl); 0 = unbekannt"),
    bottled_year: z.number().describe("Jahr der Abfüllung (ganze Zahl); 0 = unbekannt"),
    category: category.describe(`Passende bestehende Kategorie (${labels.join("; ")}); „${UNKNOWN_CATEGORY}“, wenn keine eindeutig passt (keine neuen Kategorien)`),
    sources: z.array(z.string()).describe("URLs der verwendeten Quellen"),
  });
}

export type SpiritResearchRaw = z.infer<ReturnType<typeof spiritResearchSchema>>;

export type SpiritFindings = {
  producer?: string;
  country?: string;
  region?: string;
  alcohol_content?: number;
  age_years?: number;
  cask?: string;
  distilled_year?: number;
  bottled_year?: number;
  spirit_category_id?: string;
};

const text = (v: string) => {
  const t = v.trim();
  return t && t.length <= 200 && t.toLowerCase() !== UNKNOWN_CATEGORY ? t : undefined;
};
const year = (v: number) => (Number.isInteger(v) && v >= 1800 && v <= 2100 ? v : undefined);

/** Antwort prüfen: Ungültiges verwerfen; Kategorie nur, wenn sie genau einer bestehenden entspricht. */
export function spiritFindings(raw: SpiritResearchRaw, all: SpiritCategory[]): SpiritFindings | null {
  if (!raw.matches_spirit) return null;
  const out: SpiritFindings = {};
  const set = <K extends keyof SpiritFindings>(k: K, v: SpiritFindings[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("producer", text(raw.producer));
  set("country", text(raw.country));
  set("region", text(raw.region));
  set("alcohol_content", Number.isFinite(raw.alcohol_content) && raw.alcohol_content > 0 && raw.alcohol_content <= 100 ? Math.round(raw.alcohol_content * 10) / 10 : undefined);
  set("age_years", Number.isInteger(raw.age_years) && raw.age_years >= 1 && raw.age_years <= 100 ? raw.age_years : undefined);
  set("cask", text(raw.cask));
  set("distilled_year", year(raw.distilled_year));
  set("bottled_year", year(raw.bottled_year));
  const choice = categoryChoices(all).find((c) => c.label === raw.category);
  if (choice) out.spirit_category_id = choice.id;
  return Object.keys(out).length ? out : null;
}

/** Felder der Spirituose in wines (Reihenfolge der Meldung „ergänzt“). */
export const SPIRIT_FIELD_LABELS: Record<keyof SpiritFindings, string> = {
  producer: "Hersteller",
  country: "Land",
  region: "Region",
  alcohol_content: "Alkohol",
  age_years: "Alter",
  cask: "Fass/Finish",
  distilled_year: "Destilliert",
  bottled_year: "Abgefüllt",
  spirit_category_id: "Kategorie",
};
