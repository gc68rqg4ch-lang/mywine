import { z } from "zod";
import { sizeFromText } from "@/lib/research/price-match";
import { completeSpiritName, completeWineName } from "./wine-names";
import { COUNTRY_HINT, WINE_TYPES } from "@/lib/format";
import { normalizeGrapeShares, type GrapeSource } from "@/lib/grapes/shares";
import type { SpiritDraft, SpiritLabel } from "@/lib/spirits/draft";

const wineType = z.enum(WINE_TYPES);

export const GrapeShareSchema = z.object({
  grape: z.string().describe("Rebsorte, z. B. Tempranillo"),
  percent: z
    .number()
    .nullable()
    .describe("Anteil in Prozent für genau diesen Wein und Jahrgang; null wenn nicht belegt"),
});

/** Weindaten, wie sie vom Etikett gelesen bzw. korrigiert werden. */
export const WineProposalSchema = z.object({
  name: z.string().nullable().describe("Vollständiger Name ohne Jahrgang (mit Zusätzen wie Liqueur, Holzfass); Wein ohne Produzent, Spirituose mit Marke, wenn sie Teil des Produktnamens ist (z. B. Galliano Vanilla)"),
  producer: z.string().nullable().describe("Weingut / Produzent"),
  vintage_year: z.number().int().nullable().describe("Jahrgang, z. B. 2019; null wenn ohne Jahrgang"),
  country: z.string().nullable().describe(`${COUNTRY_HINT}; z. B. Spanien, Frankreich, Schweiz, USA`),
  region: z.string().nullable().describe("Weinbauregion, z. B. Rioja, Bordeaux, California"),
  appellation: z.string().nullable().describe("Herkunftsbezeichnung/Appellation, z. B. Napa Valley, Priorat DOQ"),
  type: wineType.nullable().describe("red, white, rose, sparkling, sweet, fortified oder spirit (Spirituose: Whisky, Grappa, Likör, Obstbrand …)"),
  grape_shares: z
    .array(GrapeShareSchema)
    .describe("Rebsorten mit Anteil; percent nur, wenn der Anteil angegeben ist, sonst null"),
  alcohol_content: z.number().nullable().describe("Alkoholgehalt in Volumenprozent, z. B. 13.5 – nur, wenn er dasteht; sonst null"),
  bottle_size_ml: z.number().int().nullable().describe("Flaschengrösse in ml, z. B. 750 für 75 cl, 500 für 50 cl – nur, wenn sie dasteht; sonst null (keine Standardgrösse)"),
});
export type WineProposal = z.infer<typeof WineProposalSchema>;

/**
 * Ablaufdatum vom Etikett als Text (nicht nullable – Grenze von 16 Union-Feldern):
 * „YYYY-MM-DD“ mit Tag, „YYYY-MM“ nur Monat/Jahr, leer = keins oder nicht sicher lesbar.
 */
const BestBeforeField = z
  .string()
  .describe(
    "Ablaufdatum („mindestens haltbar bis“, „zu verbrauchen bis“, „best before“, „à consommer de préférence avant“, „consumir preferentemente antes de“ …) als YYYY-MM-DD bzw. YYYY-MM, wenn nur Monat und Jahr dastehen; leer, wenn keins da ist oder es nicht klar lesbar ist (nicht raten). Nicht der Jahrgang.",
  )
  // Fehlt das Feld in der Antwort, gilt „keins“ (die Erkennung scheitert deswegen nicht).
  .catch("");

/**
 * Spirituose auf dem Etikett – ohne nullable Felder (Grenze von 16 Union-Feldern): "" bzw. 0 =
 * unbekannt. kind: wine, spirit oder unsure (dann fragt Antoine „Wein oder Spirituose?“).
 */
export const SpiritLabelSchema = z
  .object({
    kind: z.enum(["wine", "spirit", "unsure"]).describe("wine = Wein (auch Port, Sherry, Madeira = fortified), spirit = Spirituose (Whisky, Grappa, Likör, Obstbrand, Cognac, Rum, Gin, Vodka, Tequila …), unsure = nicht sicher"),
    category: z
      .string()
      .describe(
        "Bei Spirituosen die Hauptkategorie – nur genau einer dieser Namen, nie einen neuen: Whisky, Likör, Kräuterschnaps / Bitter, Obstbrand, Grappa / Trester, Cognac / Brandy, Rum, Gin, Vodka, Tequila / Mezcal, Andere; leer, wenn unklar bzw. bei Wein",
      ),
    subcategory: z
      .string()
      .describe(
        "Unterkategorie – nur einer dieser Namen, nie einen neuen (sonst leer): Whisky: Scotch Single Malt, Scotch Blend, Bourbon, Irish, Japanese, Schweizer; Likör: Frucht, Kaffee, Kräuter, Nuss, Sahne; Obstbrand: Apfel / Calvados, Kirsch, Williams, Zwetschge; Cognac / Brandy: Cognac, Armagnac, Brandy",
      ),
    age_years: z.number().describe("Altersangabe in Jahren (z. B. 12 bei „12 Years Old“); 0 = keine"),
    cask: z.string().describe("Fass, Reifung bzw. Finish (z. B. „Sherry Cask Finish“); leer, wenn keins dasteht"),
    distilled_year: z.number().describe("Jahr der Destillation („Distilled 2008“); 0 = keins"),
    bottled_year: z.number().describe("Jahr der Abfüllung („Bottled 2020“); 0 = keins"),
  })
  // Fehlt der Block in der Antwort: Wein (die Erkennung scheitert deswegen nicht).
  .catch({ kind: "wine", category: "", subcategory: "", age_years: 0, cask: "", distilled_year: 0, bottled_year: 0 });

/** Korrektur des Vorschlags (✏️ Korrigieren): Weindaten plus Ablaufdatum. */
export const CorrectionSchema = WineProposalSchema.extend({ best_before: BestBeforeField });

export const RecognitionSchema = WineProposalSchema.extend({
  confidence: z
    .number()
    .describe("Gesamtkonfidenz 0.0–1.0, wie sicher Name, Produzent und Jahrgang korrekt gelesen sind"),
  uncertain_notes: z
    .string()
    .nullable()
    .describe("Kurz auf Deutsch, was unsicher oder unleserlich war; sonst null"),
  vintage_certain: z
    .boolean()
    .describe("true nur, wenn der Jahrgang eindeutig lesbar auf dem Etikett steht; false bei fehlendem, verdecktem oder geratenem Jahrgang"),
  image_sides: z
    .array(z.enum(["front", "back", "other"]))
    .describe("Pro Foto in der gesendeten Reihenfolge: front = Vorderetikett, back = Rückenetikett, other = anderes"),
  best_before: BestBeforeField,
  spirit: SpiritLabelSchema,
});
export type Recognition = z.infer<typeof RecognitionSchema>;

/**
 * Felder, die eine Websuche ergänzen darf (nie Name/Jahrgang; den Produzenten nur,
 * wenn er fehlt – z. B. bei einer Erfassung per Text).
 * Rebsorten recherchiert eine eigene Suche mit Prozentanteilen (lib/grapes/research).
 */
export const ENRICHABLE_FIELDS = [
  "producer",
  "country",
  "region",
  "appellation",
  "type",
  "alcohol_content",
] as const;
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/** Gefundener Preis (CHF pro Flasche) mit Herkunft. */
export type PriceOffer = {
  amount: number;
  merchant: string;
  url: string;
  year: number | null;
  size_ml: number | null;
  /** both = bezahlt und Normalpreis setzen, regular = nur Normalpreis. */
  mode: "both" | "regular";
  /** Abweichender Zusatz, z. B. „Angebot ohne Riserva“ (kein exakter Treffer). */
  why?: string;
  /** Grösse der Flasche war unbekannt: beim Übernehmen die Grösse des Angebots eintragen. */
  set_size?: boolean;
};

export type StorageRoom = "Weinkeller" | "Wohnzimmer";

export type IngestStep =
  /** Foto-Album eingegangen (Bildtext/Absicht vermerkt), Erkennung folgt. */
  | "received"
  /** Gekauft oder nur verkostet? Wartet auf die Antwort (Foto ohne klaren Hinweis). */
  | "intent"
  /** Text-Erfassung: wartet auf die Beschreibung (nach „Neuer Wein“). */
  | "describe"
  /** Text-Erfassung: läuft Erkennung und Recherche. */
  | "researching"
  /** Text-Erfassung: Nachkauf zu einem Wein im Bestand? */
  | "restock"
  /** Ähnlicher bestehender Wein (andere Schreibweise): „Meinst du …?“ */
  | "similar"
  /** Text-Erfassung: Produzent fehlt noch. */
  | "producer"
  /** Jahrgang fehlt oder ist unsicher: Zahl oder „Ohne Jahrgang (NV)“. */
  | "vintage"
  | "review"
  | "correcting"
  | "location"
  /** Flaschengrösse nicht sicher gelesen: Knöpfe (35 cl … 1 l) oder getippt. */
  | "size"
  | "quantity"
  | "price"
  /** Geschenk: „Von wem?“ – Freitext oder „Überspringen“. */
  | "gift_from"
  | "regular_price"
  /** Preissuche fand nur einen anderen Jahrgang bzw. eine andere Grösse: „Übernehmen?“ */
  | "price_offer"
  /** Preis-Rückfrage zurückgehalten, solange eine andere Erfassung läuft (fängt keine Antworten ab). */
  | "price_held"
  | "vendor"
  | "vendor_new"
  /** Wein oder Spirituose? (Erkennung unsicher) */
  | "kind"
  /** Früher: neue Kategorie vorschlagen („Anlegen“) – entfallen; nur noch alte Erfassungen. */
  | "category"
  /** Spirituose: Hauptkategorie wählen. */
  | "category_main"
  /** Spirituose: Unterkategorie wählen (oder ohne). */
  | "category_sub"
  /** Text-Erfassung: Zusammenfassung mit [Ja] [Nein]. */
  | "confirm"
  | "saving"
  | "done";

/** Inhalt von ingest_jobs.extracted: Vorschlag plus Gesprächszustand. */
export type IngestState = {
  step: IngestStep;
  /** Bildtext des Albums (Hinweis auf „gekauft“ oder „verkostet“). */
  caption?: string;
  /** Absicht schon bekannt (Bildtext oder „wir verkosten einen Wein“ vorher). */
  intent?: "bought" | "tasted";
  /** Erkennung, solange die Absicht noch offen ist (Schritt „intent“). */
  pending_recognition?: {
    proposal: WineProposal;
    vintageCertain: boolean;
    model: string;
    confidence: number;
    notes: string | null;
    imageSides: ("front" | "back" | "other")[] | null;
    bestBefore?: string | null;
    spirit?: SpiritLabel | null;
  };
  /** photo (Standard) oder text: Erfassung per Freitext ohne Etikett. */
  source?: "photo" | "text";
  /** Text-Erfassung: der Wein (mit Jahrgang) liegt schon im Bestand → nur neue Charge. */
  restock?: boolean;
  /** Rückfrage „Meinst du …?“: die ähnlichen bestehenden Weine (IDs, bis 3). */
  similar_ids?: string[];
  /** Die Person hat den bestehenden Wein bestätigt („Ja, dieser“) – keine Nachkauf-Frage mehr. */
  wine_confirmed?: boolean;
  /** „Nein, neuer Wein“: nicht nochmals nach ähnlichen fragen. */
  new_wine?: boolean;
  /** Geschenk statt Kauf: Preis 0, kein Normalpreis/Händler; gift_from = von wem (null = unbekannt). */
  is_gift?: boolean;
  gift_from?: string | null;
  /** Trinkfenster aus der Recherche (wird in wine_vintages übernommen, wenn dort leer). */
  drink_from_year?: number | null;
  drink_until_year?: number | null;
  proposal: WineProposal;
  /** Der Jahrgang wurde erkannt, aber nicht sicher gelesen → nachfragen. */
  vintage_uncertain?: boolean;
  /** Die Person hat den Jahrgang bestätigt (auch „ohne Jahrgang“). */
  vintage_confirmed?: boolean;
  /** Ablaufdatum vom Etikett bzw. aus dem Text: „2028-09“ oder „2027-05-31“ (best-before.ts). */
  best_before?: string;
  /** Erster Vorschlag ohne vorherige Rückfrage: weitere Fotos innert 15 s gehören noch dazu. */
  photo_join?: boolean;
  recognition: {
    model: string;
    confidence: number;
    notes: string | null;
    enriched_fields: EnrichableField[];
    sources: string[];
    /** Pro Foto (Reihenfolge wie photo_paths): Vorder-/Rückseite – für wine_media. */
    image_sides?: ("front" | "back" | "other")[];
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
  /**
   * 🤷 (Preis suchen): both = bezahlt und Normalpreis suchen (bei der Frage „bezahlt?“), regular = nur
   * den Normalpreis (bei der Normalpreis- bzw. Geschenk-Wert-Frage). Gesucht wird nach dem Speichern.
   */
  price_search?: "both" | "regular";
  /**
   * Preis-Rückfrage nach der Suche (eigene kleine Erfassung zur schon gespeicherten Charge):
   * Antworten ändern nur deren Preise (price_source manual), nichts wird neu eingebucht.
   */
  price_followup?: {
    item_id: string;
    /** Die Flasche (HTML), in jeder Meldung dieser Rückfrage. */
    label?: string;
    mode?: "both" | "regular";
    /** not_found = Suche ohne Fund, fix = „Ändern“/„Selbst eingeben“, offer = anderer Jahrgang/Grösse. */
    ask?: "not_found" | "fix" | "offer";
    /** Zurückgehalten (Schritt „price_held“): dieser Schritt kommt nach der Freigabe. */
    held_step?: IngestStep;
    /** Seit wann zurückgehalten (ISO) – höchstens 24 Std.; die 10-Min.-Frist beginnt erst beim Senden. */
    held_at?: string;
  };
  /** Preissuche: nur anderer Jahrgang bzw. andere Grösse gefunden – Angebot zum Übernehmen. */
  price_offer?: PriceOffer;
  /** Händler-IDs in der Reihenfolge der Buttons (callback_data enthält nur den Index). */
  vendor_options?: string[];
  /** „Meinst du …?“: getippter Name und vorgeschlagener bestehender Händler. */
  vendor_typed?: string;
  vendor_suggest?: string;
  vendor_id?: string | null;
  vendor_name?: string | null;
  /** Spirituose: Angaben vom Etikett und Kategorie (draft.ts). */
  spirit?: SpiritDraft;
  /** Wein oder Spirituose unklar → nachfragen (Schritt „kind“). */
  kind_unsure?: boolean;
  /** Kategorie-Knöpfe: IDs in der Reihenfolge der Knöpfe (callback_data enthält nur den Index). */
  category_options?: string[];
};

/**
 * Freitext-Erfassung („Pintia 2019, 6 Flaschen, Weinkeller, 66 Franken bei Mövenpick“):
 * Wein wie bei der Etikett-Erkennung, dazu die Kaufangaben. Kaufangaben ohne
 * nullable-Felder (0 bzw. "" = nicht genannt), damit das Schema unter der
 * API-Grenze für Union-Typen bleibt.
 */
export const TextEntrySchema = WineProposalSchema.extend({
  purchase: z.object({
    quantity: z.number().int().describe("Anzahl Flaschen; 0 = nicht genannt"),
    storage_room: z.enum(["", "Weinkeller", "Wohnzimmer"]).describe("Lagerort; leer = nicht genannt"),
    price: z.number().describe("Bezahlter Preis pro Flasche in CHF; 0 = nicht genannt"),
    regular_price: z.number().describe("Normalpreis pro Flasche in CHF (bei einem Geschenk: Wert pro Flasche); 0 = nicht genannt"),
    vendor: z.string().describe("Händler; leer = nicht genannt"),
    // Nicht nullable (Grenze von 16 Union-Feldern pro Schema): false bzw. leer = nicht genannt.
    gift: z.boolean().describe("true, wenn der Wein ein Geschenk ist (geschenkt bekommen, Mitbringsel)"),
    gift_from: z.string().describe("Von wem geschenkt (Name); leer = nicht genannt"),
  }),
  best_before: BestBeforeField,
  spirit: SpiritLabelSchema,
});
export type TextEntry = z.infer<typeof TextEntrySchema>;

export function missingEnrichableFields(p: WineProposal): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) => p[field] == null);
}

/** Strings trimmen, leere Werte zu null, Zahlen auf plausible Bereiche prüfen. */
export function normalizeProposal(p: WineProposal, options: { spiritPossible?: boolean } = {}): WineProposal {
  const text = (v: string | null) => {
    const t = v?.trim();
    return t ? t : null;
  };
  const year = p.vintage_year;
  const alcohol = p.alcohol_content;
  const size = p.bottle_size_ml;
  return {
    // Nur Stufe („Reserva“) → Marke davor („Legaris Reserva“), wie die bestehenden Weine.
    name: p.type === "spirit" ? completeSpiritName(text(p.name), text(p.producer)) : completeWineName(text(p.name), text(p.producer)),
    producer: text(p.producer),
    vintage_year: year != null && year >= 1800 && year <= 2100 ? year : null,
    country: text(p.country),
    region: text(p.region),
    appellation: text(p.appellation),
    type: p.type,
    grape_shares: normalizeGrapeShares(p.grape_shares),
    // Spirituosen (bzw. noch unklar, ob Spirituose) bis 100 % vol, Wein höchstens 25 %.
    alcohol_content:
      alcohol != null && alcohol > 0 && alcohol <= (p.type === "spirit" || options.spiritPossible ? 100 : 25) ? Math.round(alcohol * 10) / 10 : null,
    // Keine Standardgrösse: nur was auf dem Etikett bzw. im Text steht (sonst Rückfrage).
    bottle_size_ml: size != null && size >= 20 && size <= 30000 ? Math.round(size) : null,
  };
}

export function grapeNames(p: Pick<WineProposal, "grape_shares">) {
  return p.grape_shares.map((s) => s.grape);
}

/** Jahrgang ist Pflicht (ausser Spirituose): fehlt er oder ist er unsicher, wird nachgefragt (ausser schon bestätigt). */
export function needsVintage(state: Pick<IngestState, "proposal" | "vintage_uncertain" | "vintage_confirmed">) {
  // Spirituosen: Jahrgang freiwillig (Destilliert/Abgefüllt stehen eigens) – nicht nachfragen.
  if (state.proposal.type === "spirit") return false;
  return !state.vintage_confirmed && (state.proposal.vintage_year == null || state.vintage_uncertain === true);
}

/**
 * Antwort auf die Grössenfrage: „50 cl“, „500 ml“, „0,5 l“, „0,7“, „1.5 Liter“; eine Zahl allein bis
 * 300 = cl, ab 20 sonst ml. Sonst null.
 */
export function parseSizeAnswer(text: string): number | null {
  const fromText = sizeFromText(text);
  if (fromText) return fromText >= 20 && fromText <= 30000 ? fromText : null;
  const m = text.trim().replace(",", ".").match(/^(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 0 && n < 10) return Math.round(n * 1000);
  if (n >= 10 && n <= 300) return Math.round(n * 10);
  return n > 300 && n <= 30000 ? Math.round(n) : null;
}

/** Antwort auf die Jahrgangsfrage: „2019“ → 2019, „NV“/„ohne“ → null, sonst undefined. */
export function parseVintageAnswer(text: string): number | null | undefined {
  const t = text.trim().toLowerCase();
  if (/^(nv|n\.v\.|ohne( jahrgang)?|kein(en)? jahrgang)$/.test(t)) return null;
  const m = t.match(/^(?:jahrgang\s*)?(\d{4})$/);
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1800 && year <= new Date().getFullYear() + 1 ? year : undefined;
}

/**
 * „Verkostet“ per Freitext („Heute im Kronenhalle den Pintia 2019 probiert, 120 Franken die
 * Flasche, mit Sara, 4,5 Sterne, würd ich kaufen“): Wein (nur die Kernangaben) plus Angaben
 * zum Eintrag – ohne nullable-Felder (leer / 0 / -1 = nicht genannt), wegen der API-Grenze.
 */
export const TastedTextSchema = WineProposalSchema.pick({
  name: true,
  producer: true,
  vintage_year: true,
  type: true,
  country: true,
  region: true,
}).extend({
  tasting: z.object({
    tasted_on: z.string().describe("Datum YYYY-MM-DD, wenn genannt („gestern“ → Datum); leer = heute"),
    place: z.string().describe("Ort: Restaurant, Bar, Weingut oder bei wem; leer = nicht genannt"),
    price: z.number().describe("Preis; 0 = nicht genannt"),
    price_unit: z.enum(["", "bottle", "glass"]).describe("bottle = pro Flasche, glass = pro Glas; leer = nicht genannt"),
    currency: z.enum(["", "CHF", "AED", "EUR"]).describe("Franken = CHF, Dirham = AED; leer = nicht genannt"),
    occasion: z.string().describe("Anlass, z. B. Geburtstag; leer = nicht genannt"),
    companions: z.string().describe("Mit wem (Begleitung); leer = nicht genannt"),
    note: z.string().describe("Eindruck/Notiz zum Wein in den Worten der Person; leer = nichts"),
    rating: z.number().describe("Sterne der schreibenden Person, 0–5 in halben Schritten; -1 = nicht genannt"),
    want_to_buy: z.boolean().describe("true, wenn die Person ihn kaufen möchte („würd ich kaufen“, „merken“)"),
  }),
});
export type TastedText = z.infer<typeof TastedTextSchema>;
