// Formulare der Weinseite → Bearbeitungen (rein, ohne DB). Nur Felder, die im Formular
// stehen, werden übernommen; leere Felder heissen „leeren“ (null). Geprüft wird im Modul.

import { parsePrice } from "@/lib/format";
import { ROOMS, type BatchChanges, type Edit, type Room, type WineChanges } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FormError extends Error {}

function reader(form: FormData) {
  const has = (name: string) => form.has(name);
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const id = (name: string) => {
    const v = text(name);
    if (!UUID_RE.test(v)) throw new FormError("Ungültige Angabe.");
    return v;
  };
  /** "" → null; ganze Zahl, sonst Fehler. */
  const int = (name: string, label: string) => {
    const v = text(name).replace(/['’\s]/g, "");
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n)) throw new FormError(`${label}: bitte eine ganze Zahl.`);
    return n;
  };
  /** Jahrgang: "" oder „NV“ → ohne Jahrgang. */
  const year = (name: string) => (/^(nv|ohne)?$/i.test(text(name)) ? null : int(name, "Jahrgang"));
  const decimal = (name: string, label: string) => {
    const v = text(name).replace(",", ".").replace(/[%\s]/g, "");
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new FormError(`${label}: bitte eine Zahl.`);
    return n;
  };
  const price = (name: string, label: string) => {
    const v = text(name);
    if (v === "") return null;
    const p = parsePrice(v);
    if (p == null) throw new FormError(`${label}: bitte einen Preis wie 24.50 oder leer lassen.`);
    return p;
  };
  return { has, text, id, int, year, decimal, price };
}

/** Liest die Bearbeitung(en) eines Formulars (Feld „kind“). */
export function editsFromForm(form: FormData): Edit[] | { error: string } {
  const r = reader(form);
  try {
    switch (r.text("kind")) {
      case "wine": {
        const set: WineChanges = {};
        if (r.has("name")) set.name = r.text("name");
        if (r.has("producer")) set.producer = r.text("producer");
        if (r.has("type")) set.type = (r.text("type") || null) as WineChanges["type"];
        for (const key of ["country", "region", "appellation"] as const) if (r.has(key)) set[key] = r.text(key) || null;
        if (r.has("alcohol")) set.alcohol = r.decimal("alcohol", "Alkohol");
        return [{ kind: "wine", wineId: r.id("wineId"), set }];
      }
      case "vintage": {
        const wineId = r.id("wineId");
        const from = r.year("from");
        const edits: Edit[] = [];
        if (r.has("drinkFrom") || r.has("drinkUntil")) {
          edits.push({ kind: "drinkWindow", wineId, year: from, from: r.int("drinkFrom", "Ab"), until: r.int("drinkUntil", "Bis") });
        }
        // Jahrgang zuletzt: danach heisst der Jahrgang anders.
        if (r.has("to")) edits.push({ kind: "vintage", wineId, from, to: r.year("to") });
        return edits;
      }
      case "batch": {
        const itemId = r.id("itemId");
        const set: BatchChanges = {};
        if (r.has("quantity")) set.quantity = r.int("quantity", "Anzahl") ?? 0;
        if (r.has("bottleSize")) {
          const cl = r.decimal("bottleSize", "Flaschengrösse");
          if (cl == null) throw new FormError("Flaschengrösse fehlt.");
          set.bottleSizeMl = Math.round(cl * 10);
        }
        if (r.has("purchasedAt")) set.purchasedAt = r.text("purchasedAt") || null;
        if (r.has("vendor")) set.vendor = r.text("vendor") || null;
        if (r.has("giftField")) set.isGift = r.has("isGift");
        if (r.has("purchasePrice")) set.purchasePrice = r.price("purchasePrice", "Bezahlt");
        if (r.has("regularPrice")) set.regularPrice = r.price("regularPrice", "Normalpreis");
        const edits: Edit[] = [{ kind: "batch", itemId, set }];
        if (r.has("room") && r.text("room") !== r.text("roomBefore")) {
          const room = r.text("room") as Room;
          if (!ROOMS.includes(room)) throw new FormError("Bitte einen Lagerort wählen.");
          edits.push({ kind: "move", itemId, room, count: r.int("moveCount", "Anzahl verschieben") ?? undefined });
        }
        if (r.has("vintage") && r.text("vintage") !== r.text("vintageBefore")) {
          edits.push({ kind: "batchVintage", itemId, to: r.year("vintage") });
        }
        return edits;
      }
      case "deleteBatch":
        return [{ kind: "deleteBatch", itemId: r.id("itemId") }];
      case "openBottle": {
        const fill = r.int("fill", "Füllstand");
        const openedOn = r.text("openedOn");
        return [{ kind: "openBottle", itemId: r.id("itemId"), ...(fill != null ? { fill } : {}), ...(openedOn ? { openedOn } : {}) }];
      }
      case "drunkBottle":
        return [{ kind: "drunkBottle", itemId: r.id("itemId"), drunkOn: r.text("drunkOn") }];
      case "reopen":
        return [{ kind: "reopen", itemId: r.id("itemId"), fill: r.int("fill", "Füllstand") ?? 0 }];
      default:
        return { error: "Unbekannte Bearbeitung." };
    }
  } catch (error) {
    if (error instanceof FormError) return { error: error.message };
    throw error;
  }
}
