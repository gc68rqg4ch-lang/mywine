import "server-only";

import { applyEdit } from "@/lib/edit/edit";
import { todayIso } from "@/lib/format";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Proposal } from "./proposals";

export type ExecuteResult = { ok: boolean; text: string; itemId?: string };

async function openItem(db: AdminClient, itemId: string) {
  const { data, error } = await db
    .from("cellar_overview")
    .select("producer, name, vintage_year, status")
    .eq("inventory_item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const label = (r: { producer: string | null; name: string | null; vintage_year: number | null }) =>
  [r.producer, r.name, r.vintage_year].filter(Boolean).join(" ");

/** Führt einen bestätigten Vorschlag aus; prüft dabei den aktuellen Zustand erneut. */
export async function executeProposal(db: AdminClient, p: Proposal): Promise<ExecuteResult> {
  switch (p.kind) {
    case "fill": {
      const result = await applyEdit(db, { kind: "openBottle", itemId: p.itemId, fill: p.percent });
      return result.ok ? { ok: true, text: `Ich habe ${result.done}.`, itemId: p.itemId } : { ok: false, text: result.error };
    }
    case "drunk": {
      const item = await openItem(db, p.itemId);
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
