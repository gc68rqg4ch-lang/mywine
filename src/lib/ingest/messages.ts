import "server-only";

import { T } from "@/lib/bot/texts";
import { formatBottleSize, formatBottles, formatMoney, todayIso, wineTypeLabel } from "@/lib/format";
import { formatBestBefore, isExpired, parseBestBefore } from "./best-before";
import { drinkWindowHint, drinkWindowText } from "@/lib/cellar/drink-window";
import { formatShares } from "@/lib/grapes/shares";
import { escapeHtml } from "@/lib/telegram/api";
import type { TgInlineKeyboard } from "@/lib/telegram/types";
import type { EnrichableField, IngestState } from "./schema";
import { spiritLines } from "@/lib/spirits/draft";

/** callback_data: "<aktion>:<jobId>[:<wert>]" – bleibt unter Telegrams 64 Bytes. */
export type CallbackAction =
  | "save"
  | "fix"
  | "drop"
  | "loc"
  | "qty"
  | "qtyother"
  /** Flaschengrösse in ml bzw. „other“ (tippen) */
  | "size"
  | "skipprice"
  | "gift"
  | "skipgift"
  | "sameprice"
  | "regother"
  | "skipregular"
  | "vendor"
  | "newvendor"
  | "skipvendor"
  /** Alle Händler alphabetisch, Seite (0, 1, …) */
  | "allvendors"
  /** „Meinst du …?“: ja (vorgeschlagener Händler) bzw. nein (getippten Namen neu anlegen) */
  | "vendorsim"
  | "vendorcreate"
  | "restock"
  | "confirm"
  | "vint"
  | "simyes"
  | "simno"
  /** Wein oder Spirituose? (w | s) */
  | "kind"
  /** Hauptkategorie (Index) */
  | "catmain"
  /** Unterkategorie (Index) bzw. „none“ = ohne */
  | "catsub"
  /** 🤷 (Preis suchen) bei „bezahlt?“ (bezahlt und Normalpreis) */
  | "searchprice"
  /** 🤷 (Preis suchen) beim Normalpreis bzw. Geschenk-Wert (nur Normalpreis) */
  | "searchreg"
  /** Preissuche: anderen Jahrgang/andere Grösse übernehmen, selbst eingeben, leer lassen */
  | "offeryes"
  | "offerself"
  | "offerleave";

export function callbackData(action: CallbackAction, jobId: string, value?: string) {
  return [action, jobId, value].filter(Boolean).join(":");
}

export function parseCallbackData(data: string | undefined) {
  const [action, jobId, value] = (data ?? "").split(":");
  const actions: CallbackAction[] = [
    "simyes",
    "simno",
    "save",
    "fix",
    "drop",
    "loc",
    "qty",
    "qtyother",
    "size",
    "skipprice",
    "gift",
    "skipgift",
    "sameprice",
    "regother",
    "skipregular",
    "vendor",
    "newvendor",
    "skipvendor",
    "allvendors",
    "vendorsim",
    "vendorcreate",
    "restock",
    "confirm",
    "vint",
    "kind",
    "catmain",
    "catsub",
    "searchprice",
    "searchreg",
    "offeryes",
    "offerself",
    "offerleave",
  ];
  if (!actions.includes(action as CallbackAction) || !/^[0-9a-f-]{36}$/.test(jobId ?? "")) {
    return null;
  }
  return { action: action as CallbackAction, jobId, value };
}

const FIELD_LABELS: Record<EnrichableField, string> = {
  producer: "Produzent",
  country: "Land",
  region: "Region",
  appellation: "Appellation",
  type: "Typ",
  alcohol_content: "Alkohol",
};

const e = (value: string) => escapeHtml(value);

/** „ – bald trinken“ bzw. „ – über dem Höhepunkt“ (bis im laufenden Jahr bzw. davor). */
const drinkHintText = (until: number | null) => {
  const hint = drinkWindowHint(until);
  return hint ? ` – ${hint}` : "";
};

/** Foto-Vorschlag: „Trinkreife: 2024–2030“ (aus der Recherche bzw. dem Etikett), sonst nichts. */
function drinkLine(state: Pick<IngestState, "drink_from_year" | "drink_until_year">) {
  const text = drinkWindowText(state.drink_from_year ?? null, state.drink_until_year ?? null);
  return text ? `Trinkreife: ${e(text)}${drinkHintText(state.drink_until_year ?? null)}` : null;
}

/** „📆 Haltbar bis September 2028“ (mit „schon abgelaufen“), wenn ein Ablaufdatum da ist. */
export function bestBeforeLine(state: Pick<IngestState, "best_before">, today = todayIso()) {
  const bb = parseBestBefore(state.best_before);
  return bb ? T.bestBeforeLine(e(formatBestBefore(bb)), isExpired(bb, today)) : null;
}

/** extra: Hinweise aus der DB (z. B. bestehendes Trinkfenster bleibt). */
export function proposalMessage(state: IngestState, matched: boolean, extra: string[] = []) {
  const p = state.proposal;
  const r = state.recognition;
  // Spirituose: Kategorie, Alter, Fass …; keine Trauben, kein Trinkfenster (nur ein Ablaufdatum).
  const spirit = p.type === "spirit";
  const icon = spirit ? "🥃" : "🍷";
  const lines = [
    // Ohne Produzent steht der Name oben (kein „Produzent unbekannt“).
    ...(p.producer
      ? [`${icon} <b>${e(p.producer)}</b>`, `${e(p.name ?? "Name unbekannt")}${p.vintage_year != null ? ` ${p.vintage_year}` : ""}`]
      : [`${icon} <b>${e(p.name ?? "Name unbekannt")}</b>${p.vintage_year != null ? ` ${p.vintage_year}` : ""}`]),
    spirit ? (p.vintage_year != null ? `📅 Jahrgang: ${p.vintage_year}` : null) : vintageLine(state),
    "",
    `Typ: ${e(p.type ? wineTypeLabel(p.type) : state.kind_unsure ? "Wein oder Spirituose? (ich frage gleich nach)" : "–")}`,
    ...(spirit ? spiritLines(state.spirit).map(e) : []),
    `Herkunft: ${e([p.country, p.region, p.appellation].filter(Boolean).join(" · ") || "–")}`,
    spirit ? null : `Trauben: ${e(formatShares(p.grape_shares) || "–")}`,
    `Alkohol: ${p.alcohol_content != null ? `${p.alcohol_content.toLocaleString("de-CH")} %` : "–"}`,
    `Flasche: ${e(formatBottleSize(p.bottle_size_ml) ?? "–")}`,
    ...[spirit ? null : drinkLine(state), bestBeforeLine(state)].filter((l): l is string => l != null),
    ...extra,
  ].filter((l): l is string => l != null);
  // Keine Technik (Modell, Prozent) – nur, wo ich unsicher bin.
  if (r.notes) lines.push("", `<i>Nicht ganz sicher bin ich bei: ${e(r.notes)}</i>`);
  const grapeNote = {
    research: "🍇 <i>Die Rebsorten habe ich für diesen Jahrgang recherchiert</i>",
    existing: "🍇 <i>Die Rebsorten habe ich aus deinem Bestand übernommen</i>",
  }[state.grape_source as string];
  if (grapeNote && p.grape_shares.length) lines.push(grapeNote);
  if (matched) lines.push("<i>Diesen Wein kenne ich schon – ich lege nur eine neue Charge an.</i>");
  if (r.enriched_fields.length) {
    lines.push(
      `🔎 <i>Im Web ergänzt habe ich: ${r.enriched_fields.map((f) => FIELD_LABELS[f]).join(", ")}</i>`,
    );
  }
  if (!p.name) {
    lines.push("", spirit ? "Mir fehlt noch der Name – magst du ihn kurz korrigieren?" : "Mir fehlt noch der Name des Weins – magst du ihn kurz korrigieren?");
  }
  return lines.join("\n");
}

export function reviewKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "💾 Speichern", callback_data: callbackData("save", jobId) },
        { text: "✏️ Korrigieren", callback_data: callbackData("fix", jobId) },
        { text: "🗑️ Verwerfen", callback_data: callbackData("drop", jobId) },
      ],
    ],
  };
}

/** „✖️ Abbrechen“ unter jeder Rückfrage. */
const cancelRow = (jobId: string) => [{ text: "✖️ Abbrechen", callback_data: callbackData("drop", jobId) }];

export function locationKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Weinkeller", callback_data: callbackData("loc", jobId, "keller") },
        { text: "Wohnzimmer", callback_data: callbackData("loc", jobId, "wohnzimmer") },
      ],
      cancelRow(jobId),
    ],
  };
}

/** Grössen-Knöpfe (Etikett ohne lesbare Grösse); jede andere Grösse als Text. */
export const SIZE_CHOICES: [string, number][] = [["35 cl", 350], ["50 cl", 500], ["70 cl", 700], ["75 cl", 750], ["1 l", 1000]];
export function sizeKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      SIZE_CHOICES.slice(0, 3).map(([text, ml]) => ({ text, callback_data: callbackData("size", jobId, String(ml)) })),
      [...SIZE_CHOICES.slice(3).map(([text, ml]) => ({ text, callback_data: callbackData("size", jobId, String(ml)) })), { text: "✏️ Andere", callback_data: callbackData("size", jobId, "other") }],
      cancelRow(jobId),
    ],
  };
}

export function quantityKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [1, 2, 3, 6, 12].map((n) => ({
        text: String(n),
        callback_data: callbackData("qty", jobId, String(n)),
      })),
      // Jede andere Zahl: als Text (geht auch ohne diesen Knopf).
      [{ text: "✏️ Andere Zahl", callback_data: callbackData("qtyother", jobId) }],
      cancelRow(jobId),
    ],
  };
}

/**
 * Preis-Knöpfe nur als Emoji (sonst schneidet das iPhone sie ab): 🎁 Geschenk, 🤷 weiss ich nicht –
 * 🤷 startet die Preissuche bei Schweizer Händlern (nach dem Speichern). Betrag bzw. „–“ (leer
 * lassen) werden getippt. search false (z. B. nachdem die Suche nichts fand): ohne 🤷.
 */
const shrugButton = (jobId: string, action: "searchprice" | "searchreg") => ({ text: "🤷", callback_data: callbackData(action, jobId) });

/** Frage „bezahlt?“: Betrag bzw. „–“ tippen oder 🎁 Geschenk · 🤷 (Preis suchen). */
export function priceKeyboard(jobId: string, search = true): TgInlineKeyboard {
  return {
    inline_keyboard: [[{ text: "🎁", callback_data: callbackData("gift", jobId) }, ...(search ? [shrugButton(jobId, "searchprice")] : [])], cancelRow(jobId)],
  };
}

/** Geschenk: Normalpreis (Wert) pro Flasche – Betrag bzw. „–“ tippen oder 🤷 (Normalpreis suchen). */
export function giftValueKeyboard(jobId: string, search = true): TgInlineKeyboard {
  return { inline_keyboard: [...(search ? [[shrugButton(jobId, "searchreg")]] : []), cancelRow(jobId)] };
}

/** Preissuche fand nur einen anderen Jahrgang bzw. eine andere Grösse: übernehmen? */
export function priceOfferKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "✅ Übernehmen", callback_data: callbackData("offeryes", jobId) }, { text: "✏️ Selbst eingeben", callback_data: callbackData("offerself", jobId) }],
      [{ text: "Leer lassen", callback_data: callbackData("offerleave", jobId) }],
    ],
  };
}

/** Geschenk: „Von wem?“ – Name schreiben oder „Überspringen“. */
export function giftFromKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "Überspringen", callback_data: callbackData("skipgift", jobId) }], cancelRow(jobId)] };
}

/**
 * Normalpreis: mit bezahltem Betrag „✅ Ja, gleich“ · 🤷 (Normalpreis suchen), ohne nur 🤷. Ein
 * anderer Betrag bzw. „–“ (leer) wird getippt.
 */
export function regularPriceKeyboard(jobId: string, paid: number | null, search = true): TgInlineKeyboard {
  const row = [...(paid != null ? [{ text: "✅ Ja, gleich", callback_data: callbackData("sameprice", jobId) }] : []), ...(search ? [shrugButton(jobId, "searchreg")] : [])];
  return { inline_keyboard: [...(row.length ? [row] : []), cancelRow(jobId)] };
}

/** „–“, „-“, „—“, „leer“, „nichts“: Preis bewusst leer lassen (keine Suche). */
export const isLeaveEmpty = (text: string) => /^\s*(?:-|–|—|leer|nichts)\s*[.!]?\s*$/i.test(text);

/** Alle Händler: so viele je Seite, dann „Weiter“. */
export const VENDORS_PER_PAGE = 24;

/**
 * Händler als Buttons (je zwei pro Zeile), dazu „📋 Alle Händler“ (more), „Neuer Händler“ und
 * „Überspringen“. page: Seite der alphabetischen Liste aller Händler (vendors = alle; Index im
 * callback_data = Position in der ganzen Liste) mit „Weiter ▶️“, solange es weitere gibt.
 */
export function vendorKeyboard(jobId: string, vendors: { name: string }[], options: { more?: boolean; page?: number } = {}): TgInlineKeyboard {
  const rows: TgInlineKeyboard["inline_keyboard"] = [];
  const from = options.page != null ? options.page * VENDORS_PER_PAGE : 0;
  const shown = options.page != null ? vendors.slice(from, from + VENDORS_PER_PAGE) : vendors;
  shown.forEach((vendor, i) => {
    const button = { text: vendor.name, callback_data: callbackData("vendor", jobId, String(from + i)) };
    if (i % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  if (options.page == null && options.more) rows.push([{ text: "📋 Alle Händler", callback_data: callbackData("allvendors", jobId, "0") }]);
  if (options.page != null && from + VENDORS_PER_PAGE < vendors.length) rows.push([{ text: "Weiter ▶️", callback_data: callbackData("allvendors", jobId, String(options.page + 1)) }]);
  rows.push([
    { text: "➕ Neuer Händler", callback_data: callbackData("newvendor", jobId) },
    { text: "Überspringen", callback_data: callbackData("skipvendor", jobId) },
  ]);
  rows.push(cancelRow(jobId));
  return { inline_keyboard: rows };
}

/** „Meinst du «Otto's»?“: Ja (bestehender Händler) bzw. den getippten Namen neu anlegen. */
export function similarVendorKeyboard(jobId: string, existing: string, typed: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: `✅ Ja, ${existing}`, callback_data: callbackData("vendorsim", jobId) }],
      [{ text: `➕ Nein, «${typed}» neu anlegen`, callback_data: callbackData("vendorcreate", jobId) }],
      cancelRow(jobId),
    ],
  };
}

export function skipVendorKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "Überspringen", callback_data: callbackData("skipvendor", jobId) }], cancelRow(jobId)] };
}

/** Hilfe-Text – steht im zentralen Text-Modul. */
export const HELP_TEXT = T.help;

export { parsePrice } from "@/lib/format";

/**
 * Anzahl Flaschen aus einer Antwort: ganze Zahl 1–999 am Anfang („24“, „6 Flaschen“).
 * Nicht: 0, negative Zahlen, Dezimalzahlen („2.5“), Wörter („zwei“).
 */
export function parseQuantity(text: string) {
  const match = text.trim().match(/^(\d{1,4})(?![.,]\d)(?!\d)/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}

/** Anzahl im Bild- oder Freitext: „6 Flaschen“, „12 Fl.“, „3 bottles“; sonst null. */
export function quantityInText(text: string | null | undefined) {
  const match = (text ?? "").match(/(?:^|[^\d.,])(\d{1,3})\s*(?:fl\b\.?|flaschen?\b|flasche\b|bottles?\b|stk\b\.?|stück\b)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}

// ---------------------------------------------------------------------------
// Erfassung per Text

export const DESCRIBE_TEXT = T.describe;

export function cancelKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "✖️ Abbrechen", callback_data: callbackData("drop", jobId) }]] };
}

/** Bestehender Wein in der Rückfrage: „Name (Produzent)“. */
export const similarLabel = (w: { name: string; producer: string | null }) => (w.producer ? `${w.name} (${w.producer})` : w.name);

/** „Meinst du …?“: ein Treffer → Ja/Nein; mehrere → je Wein ein Knopf, dazu „Nein, neuer Wein“. */
export function similarKeyboard(jobId: string, wines: { name: string; producer: string | null }[]): TgInlineKeyboard {
  const choices =
    wines.length === 1
      ? [[{ text: T.similarYes, callback_data: callbackData("simyes", jobId, "0") }]]
      : wines.map((w, i) => [{ text: similarLabel(w).slice(0, 60), callback_data: callbackData("simyes", jobId, String(i)) }]);
  return {
    inline_keyboard: [
      ...choices,
      [{ text: T.similarNo, callback_data: callbackData("simno", jobId) }],
      [{ text: "✖️ Abbrechen", callback_data: callbackData("drop", jobId) }],
    ],
  };
}

export function restockKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Ja, Nachkauf", callback_data: callbackData("restock", jobId) },
        { text: "✖️ Nein, abbrechen", callback_data: callbackData("drop", jobId) },
      ],
    ],
  };
}

/** Jahrgangsfrage: erkannten Jahrgang bestätigen oder „ohne Jahrgang“. */
export function vintageKeyboard(jobId: string, guess: number | null): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        ...(guess != null ? [{ text: `✅ ${guess} stimmt`, callback_data: callbackData("vint", jobId, String(guess)) }] : []),
        { text: "Ohne Jahrgang (NV)", callback_data: callbackData("vint", jobId, "nv") },
      ],
      [{ text: "✖️ Abbrechen", callback_data: callbackData("drop", jobId) }],
    ],
  };
}

/** Jahrgang für Zusammenfassungen: Zahl, „ohne (NV)“ oder offen. */
export function vintageLine(state: IngestState) {
  const year = state.proposal.vintage_year;
  if (state.vintage_uncertain && !state.vintage_confirmed) return `📅 Jahrgang: ${year ?? "?"} (unsicher – ich frage gleich nach)`;
  if (year != null) return `📅 Jahrgang: ${year}`;
  return state.vintage_confirmed ? "📅 Jahrgang: ohne (NV)" : "📅 Jahrgang: fehlt noch – ich frage gleich nach";
}

export function confirmKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "✅ Ja", callback_data: callbackData("confirm", jobId) },
        { text: "✖️ Nein", callback_data: callbackData("drop", jobId) },
      ],
    ],
  };
}

/** Kurzer Steckbrief des erkannten Weins (Text-Erfassung). */
export function wineSummaryLines(state: IngestState) {
  const p = state.proposal;
  const spirit = p.type === "spirit";
  const window =
    !spirit && (state.drink_from_year || state.drink_until_year)
      ? `Trinkreife ${state.drink_from_year ?? "?"}–${state.drink_until_year ?? "?"}${drinkHintText(state.drink_until_year ?? null)}`
      : null;
  return [
    `${spirit ? "🥃" : "🍷"} <b>${e([p.producer, [p.name, p.vintage_year].filter(Boolean).join(" ")].filter(Boolean).join(" – "))}</b>${state.restock ? " <i>(Nachkauf)</i>" : ""}`,
    spirit ? null : vintageLine(state),
    e(
      [
        p.type ? wineTypeLabel(p.type) : null,
        [p.country, p.region, p.appellation].filter(Boolean).join(", ") || null,
        p.bottle_size_ml && p.bottle_size_ml !== (spirit ? 700 : 750) ? formatBottleSize(p.bottle_size_ml) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    e(
      [
        p.grape_shares.length ? `🍇 ${formatShares(p.grape_shares)}` : null,
        p.alcohol_content != null ? `${p.alcohol_content.toLocaleString("de-CH")} %` : null,
        window,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    // Spirituose: „Whisky › Bourbon · 12 Jahre · Sherry Cask …“
    spirit ? e(spiritLines(state.spirit).map((l) => l.replace(/^(Kategorie|Alter): /, "")).join(" · ")) : null,
    bestBeforeLine(state),
  ].filter((l) => l && l !== "<b></b>");
}

/**
 * Preise in Zusammenfassung und Bestätigung: beide gleich → „CHF 34.80“; verschieden →
 * „Bezahlt CHF 29.80 · Normalpreis CHF 34.80“; nur einer → „Bezahlt …“ bzw. „Normalpreis …“.
 */
export function priceLine(paid: number | null | undefined, regular: number | null | undefined, search?: "both" | "regular") {
  const money = (v: number) => formatMoney(v, "CHF");
  // 🤷 (Preis suchen): Preis bzw. Normalpreis wird nach dem Speichern gesucht.
  if (search === "both") return "Preis: wird gesucht …";
  if (search === "regular") return [paid != null ? `Bezahlt ${money(paid)}` : null, "Normalpreis: wird gesucht …"].filter(Boolean).join(" · ");
  if (paid != null && regular != null) return paid === regular ? money(paid) : `Bezahlt ${money(paid)} · Normalpreis ${money(regular)}`;
  if (paid != null) return `Bezahlt ${money(paid)}`;
  if (regular != null) return `Normalpreis ${money(regular)}`;
  return null;
}

/** Zusammenfassung vor dem Speichern (Text-Erfassung). extra: Hinweise aus der DB. */
export function textSummaryMessage(state: IngestState, extra: string[] = []) {
  const purchase = [
    state.quantity != null ? formatBottles(state.quantity) : null,
    state.storage_room ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Geschenk: statt Preis „🎁 Geschenk von <Name>“ (giftLine ist schon HTML-sicher).
  const prices = state.is_gift
    ? null
    : [
        priceLine(state.price, state.regular_price, state.price_search),
        state.vendor_name ? `bei ${state.vendor_name}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return [
    "📝 <b>Zusammenfassung</b>",
    ...wineSummaryLines(state),
    ...extra,
    e(purchase),
    state.is_gift
      ? [
          T.giftLine(state.gift_from ?? null),
          state.price_search ? "Normalpreis: wird gesucht …" : state.regular_price != null ? e(`Normalpreis ${formatMoney(state.regular_price, "CHF")}`) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : prices
        ? e(prices)
        : null,
    "",
    state.restock ? "Soll ich das als neue Charge zum bestehenden Wein speichern?" : "Soll ich das so speichern?",
  ]
    .filter((l) => l != null && l !== undefined)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Spirituosen: Wein oder Spirituose? Kategorie wählen bzw. neue vorschlagen

export function kindKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🍷 Wein", callback_data: callbackData("kind", jobId, "w") },
        { text: "🥃 Spirituose", callback_data: callbackData("kind", jobId, "s") },
      ],
      cancelRow(jobId),
    ],
  };
}

/** Vorschlag neue Kategorie: „Anlegen“ / „Bestehende wählen“. */
/** Kategorien als Knöpfe (je zwei pro Zeile); Unterkategorien mit „Ohne Unterkategorie“. */
export function categoryKeyboard(jobId: string, names: string[], level: "main" | "sub", mainName?: string): TgInlineKeyboard {
  const rows: TgInlineKeyboard["inline_keyboard"] = [];
  names.forEach((name, index) => {
    const button = { text: name, callback_data: callbackData(level === "main" ? "catmain" : "catsub", jobId, String(index)) };
    if (index % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  if (level === "sub") rows.push([{ text: `Nur „${mainName ?? "Hauptkategorie"}“`, callback_data: callbackData("catsub", jobId, "none") }]);
  rows.push(cancelRow(jobId));
  return { inline_keyboard: rows };
}
