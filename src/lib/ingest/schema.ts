import { z } from "zod";
import { Constants } from "@/lib/database.types";

const wineType = z.enum(Constants.public.Enums.wine_type);

/** Weindaten, wie sie vom Etikett gelesen bzw. korrigiert werden. */
export const WineProposalSchema = z.object({
  name: z.string().nullable().describe("Name des Weins ohne Produzent und ohne Jahrgang"),
  producer: z.string().nullable().describe("Weingut / Produzent"),
  vintage_year: z.number().int().nullable().describe("Jahrgang, z. B. 2019; null wenn ohne Jahrgang"),
  country: z.string().nullable().describe("Land auf Deutsch, z. B. Spanien, Frankreich, Schweiz, USA"),
  region: z.string().nullable().describe("Weinbauregion, z. B. Rioja, Bordeaux, California"),
  appellation: z.string().nullable().describe("Herkunftsbezeichnung/Appellation, z. B. Napa Valley, Priorat DOQ"),
  type: wineType.nullable().describe("red, white, rose, sparkling, sweet, fortified oder orange"),
  grapes: z.array(z.string()).describe("Rebsorten, leer wenn unbekannt"),
  alcohol_content: z.number().nullable().describe("Alkoholgehalt in Volumenprozent, z. B. 13.5"),
  bottle_size_ml: z.number().int().nullable().describe("Flaschengrösse in ml, z. B. 750 für 75 cl"),
});
export type WineProposal = z.infer<typeof WineProposalSchema>;

export const RecognitionSchema = WineProposalSchema.extend({
  confidence: z
    .number()
    .describe("Gesamtkonfidenz 0.0–1.0, wie sicher Name, Produzent und Jahrgang korrekt gelesen sind"),
  uncertain_notes: z
    .string()
    .nullable()
    .describe("Kurz auf Deutsch, was unsicher oder unleserlich war; sonst null"),
});
export type Recognition = z.infer<typeof RecognitionSchema>;

/** Felder, die eine Websuche ergänzen darf (nie Name/Produzent/Jahrgang vom Etikett). */
export const ENRICHABLE_FIELDS = [
  "country",
  "region",
  "appellation",
  "type",
  "grapes",
  "alcohol_content",
] as const;
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

export type StorageRoom = "Weinkeller" | "Wohnzimmer";

export type IngestStep =
  | "review"
  | "correcting"
  | "location"
  | "quantity"
  | "price"
  | "saving"
  | "done";

/** Inhalt von ingest_jobs.extracted: Vorschlag plus Gesprächszustand. */
export type IngestState = {
  step: IngestStep;
  proposal: WineProposal;
  recognition: {
    model: string;
    confidence: number;
    notes: string | null;
    enriched_fields: EnrichableField[];
    sources: string[];
  };
  storage_room?: StorageRoom;
  quantity?: number;
  price?: number | null;
};

export function missingEnrichableFields(p: WineProposal): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) =>
    field === "grapes" ? p.grapes.length === 0 : p[field] == null,
  );
}

/** Strings trimmen, leere Werte zu null, Zahlen auf plausible Bereiche prüfen. */
export function normalizeProposal(p: WineProposal): WineProposal {
  const text = (v: string | null) => {
    const t = v?.trim();
    return t ? t : null;
  };
  const year = p.vintage_year;
  const alcohol = p.alcohol_content;
  const size = p.bottle_size_ml;
  return {
    name: text(p.name),
    producer: text(p.producer),
    vintage_year: year != null && year >= 1800 && year <= 2100 ? year : null,
    country: text(p.country),
    region: text(p.region),
    appellation: text(p.appellation),
    type: p.type,
    grapes: [...new Set(p.grapes.map((g) => g.trim()).filter(Boolean))],
    alcohol_content:
      alcohol != null && alcohol >= 0 && alcohol <= 25 ? Math.round(alcohol * 10) / 10 : null,
    bottle_size_ml: size != null && size > 0 && size <= 30000 ? size : null,
  };
}
