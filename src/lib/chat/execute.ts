import "server-only";

import { applyEdit } from "@/lib/edit/edit";
import { todayIso } from "@/lib/format";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Proposal } from "./proposals";
import { T } from "@/lib/bot/texts";
import { emptySpiritBottle, setSpiritFill } from "@/lib/spirits/bottles";

export type ExecuteResult = { ok: boolean; text: string; itemId?: string };

async function openItem(db: AdminClient, itemId: string) {
  const { data, error } = await db
    .from("cellar_overview")
    .select("producer, name, vintage_year, status, type, wine_id")
    .eq("inventory_item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const label = (r: { producer: string | null; name: string | null; vintage_year: number | null }) =>
  [r.producer, r.name, r.vintage_year].filter(Boolean).join(" ");

/** Spirituose leer: Meldung mit Restbestand bzw. „letzte Flasche“. */
async function spiritEmpty(db: AdminClient, wineId: string, itemId?: string | null): Promise<ExecuteResult> {
  const result = await emptySpiritBottle(db, wineId, itemId);
  if (!result.ok) return { ok: false, text: result.error };
  return { ok: true, text: plain(T.spiritEmptied(result.name, result.remaining)), itemId: result.nextId ?? undefined };
}

/** Texte aus texts.ts sind HTML-sicher (escaped) – hier wieder als reiner Text (wird beim Senden escaped). */
const plain = (html: string) => html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Führt einen bestätigten Vorschlag aus; prüft dabei den aktuellen Zustand erneut. */
export async function executeProposal(db: AdminClient, p: Proposal): Promise<ExecuteResult> {
  switch (p.kind) {
    case "spiritFill": {
      const { data: wine } = await db.from("wines").select("name").eq("id", p.wineId).maybeSingle();
      if (p.percent === 0) return spiritEmpty(db, p.wineId);
      const result = await setSpiritFill(db, p.wineId, p.percent);
      return result.ok ? { ok: true, text: plain(T.spiritFillSet(wine?.name ?? "Spirituose", p.percent)) } : { ok: false, text: result.error };
    }
    case "spiritEmpty":
      return spiritEmpty(db, p.wineId);
    case "fill": {
      // Spirituose: 0 % = leer (nächste Flasche wird aktuell).
      if (p.percent === 0) {
        const item = await openItem(db, p.itemId);
        if (item?.type === "spirit" && item.wine_id) return spiritEmpty(db, item.wine_id, p.itemId);
      }
      const result = await applyEdit(db, { kind: "openBottle", itemId: p.itemId, fill: p.percent });
      return result.ok ? { ok: true, text: `Ich habe ${result.done}.`, itemId: p.itemId } : { ok: false, text: result.error };
    }
    case "drunk": {
      const item = await openItem(db, p.itemId);
      // Spirituose: leer – die nächste volle Flasche wird aktuell.
      if (item?.type === "spirit" && item.wine_id) return spiritEmpty(db, item.wine_id, p.itemId);
      const { data, error } = await db
        .from("inventory_items")
        .update({ status: "drunk" })
        .eq("id", p.itemId)
        .eq("status", "open")
        .select("id");
      if (error) throw error;
      if (!data?.length || !item) return { ok: false, text: "Diese Flasche ist nicht mehr offen – ich habe nichts geändert." };
      await db.from("open_bottle_details").update({ fill_level_percent: 0 }).eq("inventory_item_id", p.itemId);
      return { ok: true, text: `Ich habe ${label(item)} als ausgetrunken markiert. Zum Wohl!`, itemId: p.itemId };
    }
    case "open": {
      // Spirituosen: kein „öffnen“ – es gibt immer eine aktuelle Flasche.
      const { data: batch } = await db.from("inventory_items").select("wine:wines(type)").eq("id", p.itemId).maybeSingle();
      if ((batch?.wine as { type?: string } | null)?.type === "spirit") return { ok: false, text: plain(T.spiritNoOpen) };
      const { data: openId, error } = await db.rpc("open_bottle", {
        p_item_id: p.itemId,
        p_fill_level_percent: 100,
        p_date_opened: todayIso(),
      });
      if (error) {
        // 22023: Charge ist nicht (mehr) ungeöffnet bzw. leer.
        if (error.code === "22023" || error.code === "P0002") {
          return { ok: false, text: "Von dieser Charge ist keine ungeöffnete Flasche mehr da – ich habe nichts geändert." };
        }
        throw error;
      }
      const item = openId ? await openItem(db, openId) : null;
      return { ok: true, text: `Ich habe ${item ? label(item) : "die Flasche"} geöffnet.`, itemId: openId ?? undefined };
    }
    case "rate": {
      const { data: persons, error } = await db.from("persons").select("id, name");
      if (error) throw error;
      const person = (persons ?? []).find((x) => x.id.startsWith(p.personKey));
      if (!person) return { ok: false, text: "Diese Person kenne ich nicht – ich habe nichts geändert." };
      const result = await applyEdit(db, { kind: "rating", wineId: p.wineId, year: p.vintageYear, personId: person.id, rating: p.rating });
      return result.ok ? { ok: true, text: `Ich habe ${result.done}.` } : { ok: false, text: result.error };
    }
  }
}
