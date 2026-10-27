import { z } from "zod";
import { Constants } from "@/lib/database.types";
import { normalizeGrapeShares, type GrapeSource } from "@/lib/grapes/shares";

const wineType = z.enum(Constants.public.Enums.wine_type);

export const GrapeShareSchema = z.object({
  grape: z.string().describe("Rebsorte, z. B. Tempranillo"),
  percent: z
    .number()
    .nullable()
    .describe("Anteil in Prozent für genau diesen Wein und Jahrgang; null wenn nicht belegt"),
});

/** Weindaten, wie sie vom Etikett gelesen bzw. korrigiert werden. */
export const WineProposalSchema = z.object({
  name: z.string().nullable().describe("Name des Weins ohne Produzent und ohne Jahrgang"),
  producer: z.string().nullable().describe("Weingut / Produzent"),
  vintage_year: z.number().int().nullable().describe("Jahrgang, z. B. 2019; null wenn ohne Jahrgang"),
  country: z.string().nullable().describe("Land auf Deutsch, z. B. Spanien, Frankreich, Schweiz, USA"),
  region: z.string().nullable().describe("Weinbauregion, z. B. Rioja, Bordeaux, California"),
  appellation: z.string().nullable().describe("Herkunftsbezeichnung/Appellation, z. B. Napa Valley, Priorat DOQ"),
  type: wineType.nullable().describe("red, white, rose, sparkling, sweet, fortified oder orange"),
  grape_shares: z
    .array(GrapeShareSchema)
    .describe("Rebsorten mit Anteil; percent nur, wenn der Anteil angegeben ist, sonst null"),
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

/**
 * Felder, die eine Websuche ergänzen darf (nie Name/Produzent/Jahrgang vom Etikett).
 * Rebsorten recherchiert eine eigene Suche mit Prozentanteilen (lib/grapes/research).
 */
export const ENRICHABLE_FIELDS = [
  "country",
  "region",
  "appellation",
  "type",
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
  | "regular_price"
  | "vendor"
  | "vendor_new"
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
  /**
   * Herkunft der Rebsorten im Vorschlag: label/research/manual werden beim Speichern
   * in wine_grape_shares geschrieben, "existing" = schon in der DB, null = keine.
   */
  grape_source?: GrapeSource | "existing" | null;
  storage_room?: StorageRoom;
  quantity?: number;
  /** Bezahlter Preis pro Flasche (purchase_price). */
  price?: number | null;
  /** Normalpreis pro Flasche (regular_price). */
  regular_price?: number | null;
  /** Händler-IDs in der Reihenfolge der Buttons (callback_data enthält nur den Index). */
  vendor_options?: string[];
  vendor_id?: string | null;
  vendor_name?: string | null;
};

export function missingEnrichableFields(p: WineProposal): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) => p[field] == null);
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
    grape_shares: normalizeGrapeShares(p.grape_shares),
    alcohol_content:
      alcohol != null && alcohol >= 0 && alcohol <= 25 ? Math.round(alcohol * 10) / 10 : null,
    bottle_size_ml: size != null && size > 0 && size <= 30000 ? size : null,
  };
}

export function grapeNames(p: Pick<WineProposal, "grape_shares">) {
  return p.grape_shares.map((s) => s.grape);
}
