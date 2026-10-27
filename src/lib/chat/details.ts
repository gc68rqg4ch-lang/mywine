// „ℹ️ Details“ im Wein-Menü des Bots: kompakte Nachricht für einen Jahrgang.
// Rein, ohne DB – leere Angaben fallen weg statt „–“ zu zeigen.

import { countryFlag } from "@/lib/cellar/overview";
import { drinkWindowLabel } from "@/lib/cellar/overview";
import { daysSince, formatBottleSize, formatMoney, formatStarNumber, priceDiscount, type WineType } from "@/lib/format";
import { typeEmoji } from "./menu-view";

export type DetailBottle = {
  status: "sealed" | "open" | "drunk";
  quantity: number;
  storage_room: string | null;
  bottle_size_ml: number | null;
  fill_level_percent: number | null;
  date_opened: string | null;
  purchase_price: number | null;
  regular_price: number | null;
  currency: string | null;
};

export type WineDetails = {
  name: string;
  producer: string;
  type: WineType | null;
  year: number | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  alcohol: number | null;
  /** z. B. „Tempranillo 85 %, Garnacha 15 %“ */
  grapes: string | null;
  drinkFrom: number | null;
  drinkUntil: number | null;
  bottles: DetailBottle[];
  ratings: { person: string; rating: number }[];
  lastTasting: { quality: string | null; points: number | null } | null;
  appUrl: string | null;
  /** Anzahl PDFs (Jahrgang und ohne Jahrgang); anschauen auf der Weinseite. */
  documents?: number;
  /** Offene Vorschläge aus der Recherche (Abweichungen). */
  suggestions?: number;
};

const e = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const join = (parts: (string | null | undefined | false)[], sep = " · ") => parts.filter(Boolean).join(sep);

/** „CHF 24.50 · normal CHF 29.90 · −18.1 %“; Normalpreis nur, wenn er abweicht. */
function priceText(b: Pick<DetailBottle, "purchase_price" | "regular_price" | "currency">) {
  if (b.purchase_price == null) return b.regular_price != null ? `normal ${formatMoney(b.regular_price, b.currency)}` : null;
  const discount = priceDiscount(b.purchase_price, b.regular_price);
  return join([
    formatMoney(b.purchase_price, b.currency),
    discount && `normal ${formatMoney(b.regular_price, b.currency)}`,
    discount && `${discount.amount > 0 ? "−" : "+"}${Math.abs(discount.percent).toLocaleString("de-CH")} %`,
  ]);
}

export function wineDetailsText(d: WineDetails) {
  const place = (b: DetailBottle) => b.storage_room ?? "ohne Lagerort";
  const size = (b: DetailBottle) => (b.bottle_size_ml && b.bottle_size_ml !== 750 ? ` (${formatBottleSize(b.bottle_size_ml)})` : "");

  // Ungeöffnete Flaschen je Lagerort (und Grösse) zusammenzählen.
  const stock = new Map<string, number>();
  for (const b of d.bottles) {
    if (b.status !== "sealed" || b.quantity <= 0) continue;
    const key = `${place(b)}${size(b)}`;
    stock.set(key, (stock.get(key) ?? 0) + b.quantity);
  }
  const open = d.bottles.filter((b) => b.status === "open");

  // Preise: je unterschiedlicher Kombination eine Angabe; bei mehreren mit Lagerort.
  // Quelle: ungeöffnete Chargen, sonst offene, sonst getrunkene Flaschen.
  const hasPrice = (b: DetailBottle) => b.purchase_price != null || b.regular_price != null;
  const priceSource =
    (["sealed", "open", "drunk"] as const)
      .map((status) => d.bottles.filter((b) => b.status === status && hasPrice(b)))
      .find((list) => list.length) ?? [];
  const prices = new Map<string, string[]>();
  for (const b of priceSource) {
    const text = priceText(b);
    if (!text) continue;
    const where = prices.get(text) ?? [];
    if (!where.includes(place(b))) where.push(place(b));
    prices.set(text, where);
  }
  const priceLines =
    prices.size > 1 ? [...prices].map(([text, where]) => `${where.join(", ")}: ${text}`) : [...prices.keys()];

  const flag = countryFlag(d.country);
  const drinkWindow = drinkWindowLabel(d.drinkFrom, d.drinkUntil);
  const tasting = d.lastTasting
    ? join([d.lastTasting.quality, d.lastTasting.points != null ? `${d.lastTasting.points.toLocaleString("de-CH")} / 4 Punkte` : null])
    : "";

  const lines = [
    `${typeEmoji(d.type)} <b>${e(d.name)} ${d.year ?? "o. J."}</b>`,
    e(d.producer),
    e(join([d.country && `${flag ? `${flag} ` : ""}${d.country}`, d.region, d.appellation])),
    e(join([d.grapes && `🍇 ${d.grapes}`, d.alcohol != null && `${d.alcohol.toLocaleString("de-CH")} % vol`])),
    drinkWindow && `⏳ Trinkreife ${drinkWindow}`,
    stock.size && `📦 ${e(join([...stock].map(([where, n]) => `${where} ${n}`)))}`,
    ...open.map((b) =>
      e(
        join([
          `🍷 Offen: ${place(b)}${size(b)}`,
          b.fill_level_percent != null && `${b.fill_level_percent} %`,
          b.date_opened && `seit ${Math.max(0, daysSince(b.date_opened) ?? 0)} T.`,
        ]),
      ),
    ),
    ...priceLines.map((p) => `💰 ${e(p)}`),
    d.ratings.length && `⭐ ${e(join(d.ratings.map((r) => `${r.person} ${formatStarNumber(r.rating)}`)))}`,
    tasting && `📝 ${e(tasting)}`,
    d.documents
      ? `📄 ${d.documents === 1 ? "1 Dokument" : `${d.documents} Dokumente`}${d.appUrl ? ` – <a href="${d.appUrl}">auf der Weinseite</a>` : ""}`
      : null,
    d.suggestions
      ? `🔎 ${d.suggestions === 1 ? "1 offener Vorschlag" : `${d.suggestions} offene Vorschläge`} aus der Recherche${d.appUrl ? ` – <a href="${d.appUrl}">auf der Weinseite entscheiden</a>` : ""}`
      : null,
    d.appUrl && `<a href="${d.appUrl}">In der App öffnen</a>`,
  ];
  return lines.filter((l): l is string => typeof l === "string" && l.trim() !== "").join("\n");
}
