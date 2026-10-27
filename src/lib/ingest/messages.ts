import "server-only";

import { formatBottleSize, wineTypeLabel } from "@/lib/format";
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
  | "skipprice"
  | "sameprice"
  | "skipregular"
  | "vendor"
  | "newvendor"
  | "skipvendor";

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
    "skipprice",
    "sameprice",
    "skipregular",
    "vendor",
    "newvendor",
    "skipvendor",
  ];
  if (!actions.includes(action as CallbackAction) || !/^[0-9a-f-]{36}$/.test(jobId ?? "")) {
    return null;
  }
  return { action: action as CallbackAction, jobId, value };
}

const FIELD_LABELS: Record<EnrichableField, string> = {
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
    `🍷 <b>${e(p.producer ?? "Produzent unbekannt")}</b>`,
    `${e(p.name ?? "Name unbekannt")} ${p.vintage_year ?? "(ohne Jahrgang)"}`,
    "",
    `Typ: ${e(p.type ? wineTypeLabel(p.type) : "–")}`,
    `Herkunft: ${e([p.country, p.region, p.appellation].filter(Boolean).join(" · ") || "–")}`,
    `Trauben: ${e(formatShares(p.grape_shares) || "–")}`,
    `Alkohol: ${p.alcohol_content != null ? `${p.alcohol_content.toLocaleString("de-CH")} %` : "–"}`,
    `Flasche: ${e(formatBottleSize(p.bottle_size_ml) ?? "–")}`,
    "",
    `<i>Erkennung: ${Math.round(r.confidence * 100)} % (${e(modelLabel(r.model))})</i>`,
  ];
  if (r.notes) lines.push(`<i>Unsicher: ${e(r.notes)}</i>`);
  const grapeNote = {
    research: "🍇 <i>Rebsorten für diesen Jahrgang recherchiert</i>",
    existing: "🍇 <i>Rebsorten aus deinem Keller übernommen</i>",
  }[state.grape_source as string];
  if (grapeNote && p.grape_shares.length) lines.push(grapeNote);
  if (matched) lines.push("✅ <i>Diesen Wein gibt es schon – er wird wiederverwendet.</i>");
  if (r.enriched_fields.length) {
    lines.push(
      `🔎 <i>Per Websuche ergänzt: ${r.enriched_fields.map((f) => FIELD_LABELS[f]).join(", ")}</i>`,
    );
  }
  if (!p.name || !p.producer) {
    lines.push("", "⚠️ Name und Produzent werden zum Speichern gebraucht – bitte korrigieren.");
  }
  return lines.join("\n");
}

function modelLabel(model: string) {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  return model;
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

export function locationKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Weinkeller", callback_data: callbackData("loc", jobId, "keller") },
        { text: "Wohnzimmer", callback_data: callbackData("loc", jobId, "wohnzimmer") },
      ],
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
    ],
  };
}

export function priceKeyboard(jobId: string): TgInlineKeyboard {
  return {
    inline_keyboard: [[{ text: "Überspringen", callback_data: callbackData("skipprice", jobId) }]],
  };
}

export function regularPriceKeyboard(jobId: string, paid: number | null): TgInlineKeyboard {
  const row = [{ text: "Überspringen", callback_data: callbackData("skipregular", jobId) }];
  if (paid != null) {
    row.unshift({ text: "Gleich wie bezahlt", callback_data: callbackData("sameprice", jobId) });
  }
  return { inline_keyboard: [row] };
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
  return { inline_keyboard: rows };
}

export function skipVendorKeyboard(jobId: string): TgInlineKeyboard {
  return { inline_keyboard: [[{ text: "Überspringen", callback_data: callbackData("skipvendor", jobId) }]] };
}

export const HELP_TEXT = [
  "Unten findest du das Menü: <b>🍷 Offen</b>, <b>📦 Bestand</b>, <b>⏰ Trinkreif</b>, <b>📷 Neuer Wein</b>.",
  "Tipp auf einen Wein für Gläser, Füllstand, Öffnen, Ausgetrunken und Bewertungen.",
  "",
  "📷 Neuer Wein: Vorder- und Rückseite als Album schicken.",
  "💬 Oder einfach schreiben, z. B. <i>Welche Rioja habe ich noch?</i> oder <i>Sara gibt dem Pintia 4,5 Sterne.</i>",
  "/reset vergisst den Gesprächsverlauf, /id zeigt deine Telegram-ID.",
].join("\n");

export { parsePrice } from "@/lib/format";

export function parseQuantity(text: string) {
  const match = text.trim().match(/^(\d{1,3})\b/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}
