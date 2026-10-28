// Formulare der Weinseite (nach ✏️ an Ort und Stelle), alle über das gemeinsame
// Bearbeiten-Modul (src/lib/edit) – dieselben Prüfungen wie im Bot. Selten Gebrauchtes
// steht unter „Mehr“.

import { ROOMS } from "@/lib/edit/types";
import type { ReactNode } from "react";
import { WINE_TYPE_LABELS, todayIso, zurichDate, type InventoryStatus, type WineType } from "@/lib/format";
import type { GrapeShare } from "@/lib/grapes/shares";
import { DeleteBottles } from "./delete-sections";
import { GrapeRowsField } from "./grape-card";
import { EditForm } from "./edit-form";
import { GiftField } from "./gift-field";

const yearInput = (year: number | null) => (year == null ? "NV" : String(year));
const priceInput = (v: number | null) => (v == null ? "" : v.toFixed(2));

/** Selten gebrauchte Felder, zugeklappt. */
function More({ children }: { children: ReactNode }) {
  return (
    <details className="more-fields">
      <summary>Mehr</summary>
      <div className="edit-grid">{children}</div>
    </details>
  );
}

/**
 * „Zum Wein“ als ein Formular (ein „Speichern“): Stammdaten, Rebsorten mit % und Trinkfenster
 * des Jahrgangs; unter „Mehr“ Appellation, Alkohol und Jahrgang umbenennen (ganzer Jahrgang,
 * bestehender → Rückfrage und zusammenführen). Am Ende die Fotos (Hochladen gilt sofort).
 */
export function WineCardForm({
  wine,
  year,
  otherYears,
  shares,
  drinkFrom,
  drinkUntil,
  photos,
}: {
  wine: {
    id: string;
    name: string;
    producer: string | null;
    type: WineType | null;
    country: string | null;
    region: string | null;
    appellation: string | null;
    alcohol_content: number | null;
  };
  year: number | null;
  otherYears: (number | null)[];
  /** Angezeigte Rebsorten (des Jahrgangs bzw. „alle Jahrgänge“). */
  shares: GrapeShare[];
  drinkFrom: number | null;
  drinkUntil: number | null;
  /** Fotos hochladen, ersetzen, löschen (gilt sofort) – eigener Block am Ende. */
  photos?: ReactNode;
}) {
  return (
    <EditForm hidden={{ kind: "wineCard", wineId: wine.id, from: yearInput(year) }} mergeYears={otherYears.map(yearInput)}>
      <div className="edit-grid">
        <label className="field">
          <span>Name</span>
          <input type="text" name="name" defaultValue={wine.name} required autoComplete="off" />
        </label>
        <label className="field">
          <span>Produzent</span>
          <input type="text" name="producer" defaultValue={wine.producer ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Typ</span>
          <select name="type" defaultValue={wine.type ?? ""}>
            <option value="">Unbekannt</option>
            {(Object.keys(WINE_TYPE_LABELS) as WineType[]).map((t) => (
              <option key={t} value={t}>
                {WINE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Land</span>
          <input type="text" name="country" defaultValue={wine.country ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Region</span>
          <input type="text" name="region" defaultValue={wine.region ?? ""} autoComplete="off" />
        </label>
      </div>
      <GrapeRowsField shares={shares} year={year} />
      <div className="edit-grid">
        <label className="field">
          <span>Trinkreif ab</span>
          <input type="text" name="drinkFrom" defaultValue={drinkFrom ?? ""} inputMode="numeric" placeholder="Jahr" autoComplete="off" />
        </label>
        <label className="field">
          <span>bis</span>
          <input type="text" name="drinkUntil" defaultValue={drinkUntil ?? ""} inputMode="numeric" placeholder="Jahr" autoComplete="off" />
        </label>
      </div>
      <More>
        <label className="field">
          <span>Appellation</span>
          <input type="text" name="appellation" defaultValue={wine.appellation ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Alkohol (% vol)</span>
          <input type="text" name="alcohol" inputMode="decimal" defaultValue={wine.alcohol_content?.toString() ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Jahrgang umbenennen</span>
          <input type="text" name="to" defaultValue={yearInput(year)} inputMode="numeric" autoComplete="off" />
        </label>
        <p className="muted small field-wide">
          Gilt für den ganzen Jahrgang samt Bewertungen, Verkostungen und Fotos. „NV“ = ohne Jahrgang. Gibt es den neuen
          Jahrgang schon, werden beide zusammengeführt.
        </p>
      </More>
      {photos && (
        <fieldset className="stack-sm photo-field">
          <legend className="field-label">Fotos</legend>
          {photos}
        </fieldset>
      )}
    </EditForm>
  );
}

/** Notizen zum Wein: ein mehrzeiliges Feld; Speichern getrimmt, leer → keine Notiz. */
export function WineNotesForm({ wineId, notes }: { wineId: string; notes: string | null }) {
  return (
    <EditForm hidden={{ kind: "wineNotes", wineId }}>
      <label className="field">
        <span className="sr-only">Notizen</span>
        <textarea name="notes" rows={6} defaultValue={notes ?? ""} maxLength={10000} placeholder="Notizen zum Wein …" />
      </label>
    </EditForm>
  );
}

export type EditBatch = {
  inventory_item_id: string;
  status: InventoryStatus;
  quantity: number;
  vintage_year: number | null;
  bottle_size_ml: number | null;
  storage_room: string | null;
  purchased_at: string | null;
  vendor_name: string | null;
  is_gift: boolean | null;
  /** Von wem geschenkt (inventory_items.gift_from; nicht in cellar_overview). */
  gift_from?: string | null;
  purchase_price: number | null;
  regular_price: number | null;
  fill_level_percent: number | null;
  date_opened: string | null;
  drunk_at: string | null;
};

/**
 * Eine Charge bzw. offene/getrunkene Flasche als ein Formular (ein „Speichern“): Angaben,
 * Lagerort (auch teilweise), Status-Felder; darunter getrennt „🗑 Flaschen löschen“.
 */
export function BatchForm({ batch: b, vendors }: { batch: EditBatch; vendors: string[] }) {
  const today = todayIso();
  const listId = `vendors-${b.inventory_item_id}`;
  const room = b.storage_room ?? "";

  return (
    <>
      <EditForm
        hidden={{
          kind: "batch",
          itemId: b.inventory_item_id,
          giftField: "1",
          roomBefore: room,
          vintageBefore: yearInput(b.vintage_year),
        }}
      >
        <div className="edit-grid">
          {b.status === "open" && (
            <>
              <label className="field">
                <span>Füllstand (%)</span>
                <input name="fill" type="number" min={1} max={100} step={1} defaultValue={b.fill_level_percent ?? 100} />
              </label>
              <label className="field">
                <span>Geöffnet am</span>
                <input name="openedOn" type="date" max={today} defaultValue={b.date_opened ?? ""} />
              </label>
            </>
          )}
          {b.status === "drunk" && (
            <label className="field">
              <span>Getrunken am</span>
              <input name="drunkOn" type="date" max={today} defaultValue={zurichDate(b.drunk_at) ?? ""} required />
            </label>
          )}
          {b.status === "sealed" && (
            <label className="field">
              <span>Anzahl Flaschen</span>
              <input name="quantity" type="number" min={1} max={999} defaultValue={b.quantity} required />
            </label>
          )}
          {b.status !== "drunk" && (
            <>
              <label className="field">
                <span>Lagerort</span>
                <select name="room" defaultValue={room}>
                  {!room && <option value="">ohne Lagerort</option>}
                  {ROOMS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {b.status === "sealed" && b.quantity > 1 && (
                <label className="field">
                  <span>Davon verschieben</span>
                  <input name="moveCount" type="number" min={1} max={b.quantity} defaultValue={b.quantity} />
                </label>
              )}
            </>
          )}
          <label className="field">
            <span>Bezahlt (CHF/Fl.)</span>
            <input type="text" name="purchasePrice" inputMode="decimal" defaultValue={priceInput(b.purchase_price)} placeholder="leer = unbekannt" autoComplete="off" />
          </label>
          <label className="field">
            <span>Händler</span>
            <input type="text" name="vendor" list={listId} defaultValue={b.vendor_name ?? ""} autoComplete="off" placeholder="leer = keiner" />
            <datalist id={listId}>
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Kaufdatum</span>
            <input name="purchasedAt" type="date" max={today} defaultValue={b.purchased_at ?? ""} />
          </label>
        </div>
        <More>
          <label className="field">
            <span>Normalpreis (CHF/Fl.)</span>
            <input type="text" name="regularPrice" inputMode="decimal" defaultValue={priceInput(b.regular_price)} placeholder="leer = unbekannt" autoComplete="off" />
          </label>
          <label className="field">
            <span>Flaschengrösse (cl)</span>
            <input type="text" name="bottleSize" inputMode="decimal" defaultValue={((b.bottle_size_ml ?? 750) / 10).toString()} required />
          </label>
          <label className="field">
            <span>Jahrgang nur dieser {b.status === "sealed" ? "Charge" : "Flasche"}</span>
            <input type="text" name="vintage" defaultValue={yearInput(b.vintage_year)} inputMode="numeric" autoComplete="off" />
          </label>
          <GiftField isGift={Boolean(b.is_gift)} giftFrom={b.gift_from ?? null} />
          {b.status === "drunk" && (
            <>
              <label className="field field-check">
                <input name="reopen" type="checkbox" />
                <span>Zurück auf offen</span>
              </label>
              <label className="field">
                <span>Füllstand danach (%)</span>
                <input name="reopenFill" type="number" min={1} max={100} defaultValue={50} />
              </label>
            </>
          )}
        </More>
      </EditForm>

      {/* Löschen = falsch erfasst (nicht öffnen/austrinken) – deutlich abgesetzt. */}
      <DeleteBottles
        itemId={b.inventory_item_id}
        bottle={{ status: b.status, quantity: b.quantity, storage_room: b.storage_room, drunk_at: b.drunk_at }}
      />
    </>
  );
}
