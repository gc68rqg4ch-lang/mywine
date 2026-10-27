import "server-only";

import { formatBottleSize, wineTypeLabel } from "@/lib/format";
import { escapeHtml } from "@/lib/telegram/api";
import type { TgInlineKeyboard } from "@/lib/telegram/types";
import type { EnrichableField, IngestState } from "./schema";

/** callback_data: "<aktion>:<jobId>[:<wert>]" – bleibt unter Telegrams 64 Bytes. */
export type CallbackAction = "save" | "fix" | "drop" | "loc" | "qty" | "skipprice";

export function callbackData(action: CallbackAction, jobId: string, value?: string) {
  return [action, jobId, value].filter(Boolean).join(":");
}

export function parseCallbackData(data: string | undefined) {
  const [action, jobId, value] = (data ?? "").split(":");
  const actions: CallbackAction[] = ["save", "fix", "drop", "loc", "qty", "skipprice"];
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
  grapes: "Trauben",
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
    `Trauben: ${e(p.grapes.join(", ") || "–")}`,
    `Alkohol: ${p.alcohol_content != null ? `${p.alcohol_content.toLocaleString("de-CH")} %` : "–"}`,
    `Flasche: ${e(formatBottleSize(p.bottle_size_ml) ?? "–")}`,
    "",
    `<i>Erkennung: ${Math.round(r.confidence * 100)} % (${e(modelLabel(r.model))})</i>`,
  ];
  if (r.notes) lines.push(`<i>Unsicher: ${e(r.notes)}</i>`);
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

export const HELP_TEXT = [
  "Schick mir <b>Vorder- und Rückseite</b> einer Flasche als Album (beide Fotos zusammen auswählen).",
  "Ich erkenne den Wein, du bestätigst oder korrigierst, danach frage ich Lagerort, Anzahl und Preis ab.",
].join("\n");

/** "24.50", "24,50", "CHF 24.-" → 24.5; null bei ungültiger Eingabe. */
export function parsePrice(text: string) {
  const match = text.replace(/['’\s]/g, "").match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value < 100_000 ? value : null;
}

export function parseQuantity(text: string) {
  const match = text.trim().match(/^(\d{1,3})\b/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}
