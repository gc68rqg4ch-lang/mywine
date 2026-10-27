import "server-only";

import { todayIso } from "@/lib/format";
import { saveRating } from "@/lib/ratings";
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
      const item = await openItem(db, p.itemId);
      if (item?.status !== "open") return { ok: false, text: "Diese Flasche ist nicht mehr offen – nichts geändert." };
      const { error } = await db
        .from("open_bottle_details")
        .upsert({ inventory_item_id: p.itemId, fill_level_percent: p.percent }, { onConflict: "inventory_item_id" });
      if (error) throw error;
      return { ok: true, text: `Füllstand ${label(item)} auf ${p.percent} % gesetzt.`, itemId: p.itemId };
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
      if (!data?.length || !item) return { ok: false, text: "Diese Flasche ist nicht mehr offen – nichts geändert." };
      await db.from("open_bottle_details").update({ fill_level_percent: 0 }).eq("inventory_item_id", p.itemId);
      return { ok: true, text: `${label(item)} als ausgetrunken markiert. Zum Wohl!`, itemId: p.itemId };
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
          return { ok: false, text: "Von dieser Position ist keine ungeöffnete Flasche mehr da – nichts geändert." };
        }
        throw error;
      }
      const item = openId ? await openItem(db, openId) : null;
      return { ok: true, text: `${item ? label(item) : "Flasche"} geöffnet.`, itemId: openId ?? undefined };
    }
    case "rate": {
      const [{ data: persons, error: pErr }, { data: wine, error: wErr }] = await Promise.all([
        db.from("persons").select("id, name"),
        db.from("wines").select("producer, name").eq("id", p.wineId).maybeSingle(),
      ]);
      if (pErr) throw pErr;
      if (wErr) throw wErr;
      const person = (persons ?? []).find((x) => x.id.startsWith(p.personKey));
      if (!person || !wine) return { ok: false, text: "Person oder Wein nicht gefunden – nichts geändert." };
      await saveRating(db, { wineId: p.wineId, vintageYear: p.vintageYear, itemId: null }, person.id, p.rating);
      return {
        ok: true,
        text: `Bewertung von ${person.name} gespeichert: ${label({ ...wine, vintage_year: p.vintageYear })} → ${p.rating.toLocaleString("de-CH")} von 5 Sternen`,
      };
    }
  }
}
