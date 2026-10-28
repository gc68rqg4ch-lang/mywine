import "server-only";

// „✏️ Bearbeiten“ im Wein-Menü: Bereich wählen, dann den aktuellen Stand zeigen und die
// Änderung als Text erwarten. Die nächste Nachricht geht an den Chat (Claude), der über
// die Bearbeiten-Werkzeuge einen Vorschlag mit vorher → nachher macht.

import { formatBottleSize, formatDate, formatMoney, wineTypeLabel, zurichDate } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import type { AdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/telegram/api";
import type { EditArea } from "./menu-view";

const e = escapeHtml;
const yearLabel = (year: number | null) => (year == null ? "ohne Jahrgang (NV)" : String(year));

const EXAMPLES: Record<EditArea, string> = {
  w: "„Region Toro“, „Produzent Bodegas Vega Sicilia“, „Alkohol 14,5 %“",
  j: "„Jahrgang ist eigentlich 2018“, „trinkreif 2026 bis 2034“",
  c: "„2 Flaschen ins Wohnzimmer“, „bezahlt 24.50“, „gekauft am 3.10. bei Mövenpick“, „es sind nur 5 Flaschen“",
  g: "„85 % Tempranillo, 15 % Garnacha“",
  b: "„meine Bewertung 4 Sterne“, „Saras Bewertung löschen“",
  v: "„Verkostung vom 12.10. löschen“, „die Verkostung war am 11.10.“",
};

/** Aktueller Stand eines Bereichs (HTML) für die Nachricht im Menü. */
export async function editAreaText(db: AdminClient, wineId: string, year: number | null, area: EditArea) {
  const lines: string[] = [];
  const byYear = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(q: Q) =>
    year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);

  switch (area) {
    case "w": {
      const { data: w, error } = await db.from("wines").select("*").eq("id", wineId).single();
      if (error) throw error;
      lines.push(
        `Name: ${e(w.name)}`,
        ...(w.producer ? [`Produzent: ${e(w.producer)}`] : []),
        `Typ: ${wineTypeLabel(w.type)}`,
        `Land: ${e(w.country ?? "–")} · Region: ${e(w.region ?? "–")}`,
        `Appellation: ${e(w.appellation ?? "–")}`,
        `Alkohol: ${w.alcohol_content != null ? `${w.alcohol_content.toLocaleString("de-CH")} % vol` : "–"}`,
      );
      break;
    }
    case "j": {
      const { data, error } = await byYear(db.from("wine_vintages").select("drink_from_year, drink_until_year").eq("wine_id", wineId)).maybeSingle();
      if (error) throw error;
      lines.push(
        `Jahrgang: ${yearLabel(year)}`,
        `Trinkfenster: ${data?.drink_from_year || data?.drink_until_year ? `${data.drink_from_year ?? "?"}–${data.drink_until_year ?? "?"}` : "–"}`,
      );
      break;
    }
    case "c": {
      const { data, error } = await byYear(
        db
          .from("cellar_overview")
          .select("status, quantity, storage_room, bottle_size_ml, purchased_at, vendor_name, is_gift, purchase_price, regular_price, fill_level_percent, date_opened, drunk_at")
          .eq("wine_id", wineId),
      ).order("status");
      if (error) throw error;
      if (!data?.length) lines.push("Keine Flaschen erfasst.");
      for (const [i, r] of (data ?? []).entries()) {
        const what =
          r.status === "sealed"
            ? `${r.quantity} Fl. ${r.storage_room ?? "ohne Lagerort"}`
            : r.status === "open"
              ? `offen ${r.fill_level_percent ?? "?"} % (seit ${formatDate(r.date_opened) ?? "?"}) ${r.storage_room ?? ""}`.trim()
              : `getrunken ${formatDate(zurichDate(r.drunk_at)) ?? ""}`.trim();
        const facts = [
          r.bottle_size_ml && r.bottle_size_ml !== 750 ? formatBottleSize(r.bottle_size_ml) : null,
          r.purchase_price != null ? formatMoney(r.purchase_price, "CHF") : null,
          r.regular_price != null ? `normal ${formatMoney(r.regular_price, "CHF")}` : null,
          r.purchased_at ? `gekauft ${formatDate(r.purchased_at)}` : null,
          r.vendor_name,
          r.is_gift ? "Geschenk" : null,
        ].filter(Boolean);
        lines.push(`${i + 1}) ${e([what, ...facts].join(" · "))}`);
      }
      break;
    }
    case "g": {
      const grapes = await loadGrapeShares(db, wineId, year);
      lines.push(
        grapes
          ? `Rebsorten: ${e(formatShares(grapes.shares))}${grapes.vintageYear == null && year != null ? " (für alle Jahrgänge)" : ""}`
          : "Rebsorten: –",
      );
      break;
    }
    case "b": {
      const { data, error } = await byYear(db.from("latest_wine_ratings").select("person_name, rating, rated_at").eq("wine_id", wineId));
      if (error) throw error;
      if (!data?.length) lines.push("Noch keine Bewertung.");
      for (const r of data ?? []) lines.push(`${e(r.person_name ?? "?")}: ${r.rating?.toLocaleString("de-CH")} ★ (${formatDate(r.rated_at)})`);
      break;
    }
    case "v": {
      const { data, error } = await byYear(
        db.from("wine_tastings").select("tasted_at, quality_level, quality_points, person:persons(name)").eq("wine_id", wineId),
      ).order("tasted_at", { ascending: false });
      if (error) throw error;
      if (!data?.length) lines.push("Noch keine Verkostung.");
      for (const t of data ?? []) {
        lines.push(
          `• ${formatDate(t.tasted_at)} · ${e(t.person?.name ?? "?")} · ${e(t.quality_level ?? "ohne Resultat")}${t.quality_points != null ? ` (${t.quality_points.toLocaleString("de-CH")} / 4)` : ""}`,
        );
      }
      break;
    }
  }
  lines.push("", `✏️ Schreib mir, was ich ändern soll – z. B. ${EXAMPLES[area]}. Ich zeige dir vorher, was sich ändert.`);
  return lines.join("\n");
}

/** Notiz im Gesprächsverlauf, damit die nächste Nachricht dem Wein zugeordnet wird. */
export const editContextNote = (wineId: string, year: number | null, area: EditArea, title: string) =>
  `[Bearbeiten: ${title}, wine_id=${wineId}, Jahrgang ${year ?? 0} (0 = ohne), Bereich ${area}. Ich warte auf die Änderung.]`;
