// Öffnen rückgängig: eine kürzlich geöffnete Flasche wieder als ungeöffnet buchen (DB-Funktion
// undo_open_bottle). Dieselbe Prüfung wie in der Funktion – hier, damit Menü, Chat und App den
// Knopf nur zeigen bzw. vorschlagen, wenn es geht, und sonst ehrlich sagen, warum nicht:
// offen, geöffnet vor höchstens 24 Stunden (open_bottle_details.created_at, nicht date_opened),
// seit dem Öffnen keine Bewertung, Verkostung, Foto oder Erfassung an dieser Flasche.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

export const UNDO_OPEN_HOURS = 24;

export type UndoOpenBlock = "not_open" | "too_old" | "linked";

/** Warum nicht rückgängig (rein); null = es geht. */
export function undoOpenBlock(s: { status: string | null; openedAt: string | null; linked: boolean }, now = Date.now()): UndoOpenBlock | null {
  if (s.status !== "open") return "not_open";
  if (!s.openedAt || new Date(s.openedAt).getTime() < now - UNDO_OPEN_HOURS * 3600_000) return "too_old";
  if (s.linked) return "linked";
  return null;
}

/** Erklärung für die Person (Chat, Meldungen). */
export const UNDO_OPEN_BLOCK_TEXT: Record<UndoOpenBlock, string> = {
  not_open: "Diese Flasche ist nicht (mehr) offen – ich habe nichts geändert.",
  too_old: `Das Öffnen liegt mehr als ${UNDO_OPEN_HOURS} Stunden zurück – rückgängig geht nur kurz danach. Korrigieren lässt es sich über ✏️ Bearbeiten bzw. in der App.`,
  linked: "An dieser Flasche hängen seit dem Öffnen schon Bewertungen, Verkostungen oder Fotos – darum nicht rückgängig. Korrigieren lässt es sich über ✏️ Bearbeiten bzw. in der App.",
};

/** Fehlercodes von undo_open_bottle → Grund. */
const CODE_BLOCK: Record<string, UndoOpenBlock> = { "22023": "not_open", P0002: "not_open", UO001: "too_old", UO002: "linked" };

export type UndoOpenItem = { itemId: string; wineId: string; producer: string | null; name: string; year: number | null; fill: number | null; type: string | null };

/** Kann diese Flasche zurückgebucht werden? Mit den Angaben für Rückfrage und Meldung. */
export async function undoOpenCheck(db: Db, itemId: string): Promise<{ ok: true; item: UndoOpenItem } | { ok: false; block: UndoOpenBlock; text: string }> {
  const [{ data: item, error }, { data: details, error: dErr }] = await Promise.all([
    db.from("cellar_overview").select("inventory_item_id, wine_id, producer, name, vintage_year, type, status, fill_level_percent").eq("inventory_item_id", itemId).maybeSingle(),
    db.from("open_bottle_details").select("created_at").eq("inventory_item_id", itemId).maybeSingle(),
  ]);
  if (error) throw error;
  if (dErr) throw dErr;
  const openedAt = details?.created_at ?? null;
  const linked =
    item?.status === "open" && openedAt
      ? (
          await Promise.all(
            (["wine_ratings", "wine_tastings", "wine_media", "ingest_jobs"] as const).map(async (table) => {
              const { data, error: lErr } = await db.from(table).select("inventory_item_id").eq("inventory_item_id", itemId).gte("created_at", openedAt).limit(1);
              if (lErr) throw lErr;
              return (data ?? []).length > 0;
            }),
          )
        ).some(Boolean)
      : false;
  const block = undoOpenBlock({ status: item?.status ?? null, openedAt, linked });
  if (block || !item?.wine_id) return { ok: false, block: block ?? "not_open", text: UNDO_OPEN_BLOCK_TEXT[block ?? "not_open"] };
  return {
    ok: true,
    item: { itemId, wineId: item.wine_id, producer: item.producer ?? null, name: item.name ?? "", year: item.vintage_year ?? null, fill: item.fill_level_percent ?? null, type: item.type ?? null },
  };
}

/** „VASO 2021“ (mit Produzent, wenn vorhanden). */
export const undoLabel = (i: Pick<UndoOpenItem, "producer" | "name" | "year">) => [i.producer, i.name, i.year].filter(Boolean).join(" ");

/** Rückfrage: „VASO 2021 (60 %) wieder als ungeöffnet buchen?“ – unter 100 % mit Hinweis zum Füllstand. */
export function undoOpenQuestion(i: UndoOpenItem) {
  const head = `${undoLabel(i)}${i.fill != null ? ` (${i.fill} %)` : ""} wieder als ungeöffnet buchen?`;
  return i.fill != null && i.fill < 100 ? `${head} Damit wird auch der Füllstand zurückgenommen (wieder voll und zu).` : head;
}

/** Zurückbuchen (erneute Prüfung in der DB-Funktion); Meldung mit dem neuen Bestand des Jahrgangs. */
export async function undoOpenBottle(db: Db, itemId: string): Promise<{ ok: true; text: string; sealedId: string } | { ok: false; text: string }> {
  const check = await undoOpenCheck(db, itemId);
  if (!check.ok) return { ok: false, text: check.text };
  const { data: sealedId, error } = await db.rpc("undo_open_bottle", { p_item_id: itemId });
  if (error) {
    const block = CODE_BLOCK[error.code ?? ""];
    if (block) return { ok: false, text: UNDO_OPEN_BLOCK_TEXT[block] };
    throw error;
  }
  const { item } = check;
  let q = db.from("inventory_items").select("status, quantity").eq("wine_id", item.wineId).in("status", ["sealed", "open"]);
  q = item.year == null ? q.is("vintage_year", null) : q.eq("vintage_year", item.year);
  const { data: rows } = await q;
  const sealed = (rows ?? []).filter((r) => r.status === "sealed").reduce((n, r) => n + r.quantity, 0);
  const open = (rows ?? []).filter((r) => r.status === "open").length;
  const stock = [`${sealed} Fl. ungeöffnet`, open ? `${open} offen` : null].filter(Boolean).join(" · ");
  return { ok: true, text: `Ich habe ${undoLabel(item)} wieder als ungeöffnet gebucht (jetzt ${stock}).`, sealedId: String(sealedId) };
}

/** Welche dieser offenen Flaschen lassen sich zurückbuchen? Prüfung je Flasche (Weinseite: Wein und Spirituose). */
export async function undoableItems(db: Db, itemIds: readonly string[]): Promise<Set<string>> {
  const checks = await Promise.all(itemIds.map(async (id) => ((await undoOpenCheck(db, id)).ok ? id : null)));
  return new Set(checks.filter((id): id is string => id != null));
}
