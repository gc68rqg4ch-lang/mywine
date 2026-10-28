import "server-only";

import { T } from "@/lib/bot/texts";
import { formatBottleSize, formatBottles, formatMoney, wineTypeLabel } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { escapeHtml } from "@/lib/telegram/api";
import type { TgInlineKeyboard } from "@/lib/telegram/types";
import type { EnrichableField, IngestState } from "./schema";

/** callback_data: "<aktion>:<jobId>[:<wert>]" – bleibt unter Telegrams 64 Bytes. */
export type CallbackAction =
  | "save"
  | "fix"
  | "drop"
  | "loc"
  | "qty"
  | "qtyother"
  | "skipprice"
  | "gift"
  | "skipgift"
  | "sameprice"
  | "skipregular"
  | "vendor"
  | "newvendor"
  | "skipvendor"
  | "restock"
  | "confirm"
  | "vint";

export function callbackData(action: CallbackAction, jobId: string, value?: string) {
  return [action, jobId, value].filter(Boolean).join(":");
}

export function parseCallbackData(data: string | undefined) {
  const [action, jobId, value] = (data ?? "").split(":");
  const actions: CallbackAction[] = [
    "save",
    "fix",
    "drop",
    "loc",
    "qty",
    "qtyother",
    "skipprice",
    "gift",
    "skipgift",
    "sameprice",
    "skipregular",
    "vendor",
    "newvendor",
    "skipvendor",
    "restock",
    "confirm",
    "vint",
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

export function proposalMessage(state: IngestState, matched: boolean) {
  const p = state.proposal;
  const r = state.recognition;
  const lines = [
    // Ohne Produzent steht der Name oben (kein „Produzent unbekannt“).
    ...(p.producer
      ? [`🍷 <b>${e(p.producer)}</b>`, `${e(p.name ?? "Name unbekannt")}${p.vintage_year != null ? ` ${p.vintage_year}` : ""}`]
      : [`🍷 <b>${e(p.name ?? "Name unbekannt")}</b>${p.vintage_year != null ? ` ${p.vintage_year}` : ""}`]),
    vintageLine(state),
    "",
    `Typ: ${e(p.type ? wineTypeLabel(p.type) : "–")}`,
    `Herkunft: ${e([p.country, p.region, p.appellation].filter(Boolean).join(" · ") || "–")}`,
    `Trauben: ${e(formatShares(p.grape_shares) || "–")}`,
    `Alkohol: ${p.alcohol_content != null ? `${p.alcohol_content.toLocaleString("de-CH")} %` : "–"}`,
    `Flasche: ${e(formatBottleSize(p.bottle_size_ml) ?? "–")}`,
  ];
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
    lines.push("", "Mir fehlt noch der Name des Weins – magst du ihn kurz korrigieren?");
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

export function priceKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🎁 Geschenk", callback_data: callbackData("gift", jobId) },
        { text: "Überspringen", callback_data: callbackData("skipprice", jobId) },
      ],
      cancelRow(jobId),
    ],
  };
}

/** Geschenk: Normalpreis (Wert) pro Flasche – Betrag schreiben oder „🤷 Weiss ich nicht“. */
export function giftValueKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "🤷 Weiss ich nicht", callback_data: callbackData("skipregular", jobId) }], cancelRow(jobId)] };
}

/** Geschenk: „Von wem?“ – Name schreiben oder „Überspringen“. */
export function giftFromKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "Überspringen", callback_data: callbackData("skipgift", jobId) }], cancelRow(jobId)] };
}

export function regularPriceKeyboard(jobId: string, paid: number | null): TgInlineKeyboard {
  const row = [{ text: "Überspringen", callback_data: callbackData("skipregular", jobId) }];
  if (paid != null) {
    row.unshift({ text: "Gleich wie bezahlt", callback_data: callbackData("sameprice", jobId) });
  }
  return { inline_keyboard: [row, cancelRow(jobId)] };
}

/** Händler als Buttons (je zwei pro Zeile), dazu „Neuer Händler“ und „Überspringen“. */
export function vendorKeyboard(jobId: string, vendors: { name: string }[]): TgInlineKeyboard {
  const rows: TgInlineKeyboard["inline_keyboard"] = [];
  vendors.forEach((vendor, index) => {
    const button = { text: vendor.name, callback_data: callbackData("vendor", jobId, String(index)) };
    if (index % 2 === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([
    { text: "➕ Neuer Händler", callback_data: callbackData("newvendor", jobId) },
    { text: "Überspringen", callback_data: callbackData("skipvendor", jobId) },
  ]);
  rows.push(cancelRow(jobId));
  return { inline_keyboard: rows };
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
  const window =
    state.drink_from_year || state.drink_until_year
      ? `Trinkreife ${state.drink_from_year ?? "?"}–${state.drink_until_year ?? "?"}`
      : null;
  return [
    `🍷 <b>${e([p.producer, [p.name, p.vintage_year].filter(Boolean).join(" ")].filter(Boolean).join(" – "))}</b>${state.restock ? " <i>(Nachkauf)</i>" : ""}`,
    vintageLine(state),
    e(
      [
        p.type ? wineTypeLabel(p.type) : null,
        [p.country, p.region, p.appellation].filter(Boolean).join(", ") || null,
        p.bottle_size_ml && p.bottle_size_ml !== 750 ? formatBottleSize(p.bottle_size_ml) : null,
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
  ].filter((l) => l && l !== "<b></b>");
}

/** Zusammenfassung vor dem Speichern (Text-Erfassung). */
export function textSummaryMessage(state: IngestState) {
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
        state.price != null ? `bezahlt ${formatMoney(state.price, "CHF")}` : null,
        state.regular_price != null ? `Normalpreis ${formatMoney(state.regular_price, "CHF")}` : null,
        state.vendor_name ? `bei ${state.vendor_name}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return [
    "📝 <b>Zusammenfassung</b>",
    ...wineSummaryLines(state),
    e(purchase),
    state.is_gift
      ? [T.giftLine(state.gift_from ?? null), state.regular_price != null ? e(`Normalpreis ${formatMoney(state.regular_price, "CHF")}`) : null]
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
