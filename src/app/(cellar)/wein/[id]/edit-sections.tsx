// Bearbeiten-Ansicht der Weinseite (?bearbeiten=1): Formulare je Bereich, alle über das
// gemeinsame Bearbeiten-Modul (src/lib/edit) – dieselben Prüfungen wie im Bot.

import { ROOMS } from "@/lib/edit/types";
import { WINE_TYPE_LABELS, formatDate, todayIso, zurichDate, type InventoryStatus, type WineType } from "@/lib/format";
import { DeleteBottles } from "./delete-sections";
import { EditForm } from "./edit-form";

const yearInput = (year: number | null) => (year == null ? "NV" : String(year));
const priceInput = (v: number | null) => (v == null ? "" : v.toFixed(2));

export function WineEditForm({
  wine,
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
}) {
  return (
    <EditForm hidden={{ kind: "wine", wineId: wine.id }}>
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
          <span>Alkohol (% vol)</span>
          <input type="text" name="alcohol" inputMode="decimal" defaultValue={wine.alcohol_content?.toString() ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Land</span>
          <input type="text" name="country" defaultValue={wine.country ?? ""} autoComplete="off" />
        </label>
        <label className="field">
          <span>Region</span>
          <input type="text" name="region" defaultValue={wine.region ?? ""} autoComplete="off" />
        </label>
        <label className="field field-wide">
          <span>Appellation</span>
          <input type="text" name="appellation" defaultValue={wine.appellation ?? ""} autoComplete="off" />
        </label>
      </div>
    </EditForm>
  );
}

/** Jahrgang umbenennen (ganzer Jahrgang, ggf. zusammenführen) und Trinkfenster. */
export function VintageEditForm({
  wineId,
  year,
  otherYears,
  drinkFrom,
  drinkUntil,
}: {
  wineId: string;
  year: number | null;
  otherYears: (number | null)[];
  drinkFrom: number | null;
  drinkUntil: number | null;
}) {
  return (
    <EditForm hidden={{ kind: "vintage", wineId, from: yearInput(year) }} mergeYears={otherYears.map(yearInput)}>
      <div className="edit-grid edit-grid-3">
        <label className="field">
          <span>Jahrgang</span>
          <input type="text" name="to" defaultValue={yearInput(year)} inputMode="numeric" autoComplete="off" />
        </label>
        <label className="field">
          <span>Trinkreif ab</span>
          <input type="text" name="drinkFrom" defaultValue={drinkFrom ?? ""} inputMode="numeric" placeholder="Jahr" autoComplete="off" />
        </label>
        <label className="field">
          <span>bis</span>
          <input type="text" name="drinkUntil" defaultValue={drinkUntil ?? ""} inputMode="numeric" placeholder="Jahr" autoComplete="off" />
        </label>
      </div>
      <p className="muted small">
        Gilt für den ganzen Jahrgang samt Bewertungen, Verkostungen und Fotos. „NV“ = ohne Jahrgang. Gibt es den neuen
        Jahrgang schon, werden beide zusammengeführt.
      </p>
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
  purchase_price: number | null;
  regular_price: number | null;
  fill_level_percent: number | null;
  date_opened: string | null;
  drunk_at: string | null;
};

const BATCH_TITLES: Record<InventoryStatus, string> = { sealed: "Charge", open: "Offene Flasche", drunk: "Getrunkene Flasche" };

/** Eine Charge bzw. Flasche: Angaben, Lagerort (auch teilweise), Jahrgang, Status-Felder, Löschen. */
export function BatchEditor({ batch: b, vendors }: { batch: EditBatch; vendors: string[] }) {
  const today = todayIso();
  const listId = `vendors-${b.inventory_item_id}`;
  const room = b.storage_room ?? "";
  const title = [
    BATCH_TITLES[b.status],
    b.status === "sealed" ? `${b.quantity} Fl.` : null,
    b.status !== "drunk" ? (b.storage_room ?? "ohne Lagerort") : formatDate(zurichDate(b.drunk_at)),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="card stack">
      <h2 className="section-title">{title}</h2>
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
          {b.status === "sealed" && (
            <label className="field">
              <span>Anzahl Flaschen</span>
              <input name="quantity" type="number" min={1} max={999} defaultValue={b.quantity} required />
            </label>
          )}
          <label className="field">
            <span>Flaschengrösse (cl)</span>
            <input type="text" name="bottleSize" inputMode="decimal" defaultValue={((b.bottle_size_ml ?? 750) / 10).toString()} required />
          </label>
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
            <span>Kaufdatum</span>
            <input name="purchasedAt" type="date" max={today} defaultValue={b.purchased_at ?? ""} />
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
            <span>Bezahlt (CHF/Fl.)</span>
            <input type="text" name="purchasePrice" inputMode="decimal" defaultValue={priceInput(b.purchase_price)} placeholder="leer = unbekannt" autoComplete="off" />
          </label>
          <label className="field">
            <span>Normalpreis (CHF/Fl.)</span>
            <input type="text" name="regularPrice" inputMode="decimal" defaultValue={priceInput(b.regular_price)} placeholder="leer = unbekannt" autoComplete="off" />
          </label>
          <label className="field">
            <span>Jahrgang nur dieser {b.status === "sealed" ? "Charge" : "Flasche"}</span>
            <input type="text" name="vintage" defaultValue={yearInput(b.vintage_year)} inputMode="numeric" autoComplete="off" />
          </label>
          <label className="field field-check">
            <input name="isGift" type="checkbox" defaultChecked={Boolean(b.is_gift)} />
            <span>Geschenk</span>
          </label>
        </div>
      </EditForm>

      {b.status === "open" && (
        <EditForm hidden={{ kind: "openBottle", itemId: b.inventory_item_id }}>
          <div className="edit-grid">
            <label className="field">
              <span>Füllstand (%)</span>
              <input name="fill" type="number" min={1} max={100} step={1} defaultValue={b.fill_level_percent ?? 100} />
            </label>
            <label className="field">
              <span>Geöffnet am</span>
              <input name="openedOn" type="date" max={today} defaultValue={b.date_opened ?? ""} />
            </label>
          </div>
        </EditForm>
      )}

      {b.status === "drunk" && (
        <>
          <EditForm hidden={{ kind: "drunkBottle", itemId: b.inventory_item_id }}>
            <label className="field">
              <span>Getrunken am</span>
              <input name="drunkOn" type="date" max={today} defaultValue={zurichDate(b.drunk_at) ?? ""} required />
            </label>
          </EditForm>
          <EditForm
            hidden={{ kind: "reopen", itemId: b.inventory_item_id }}
            submitLabel="Zurück auf offen"
            confirm="Diese Flasche wieder als offen führen?"
            cancel={false}
          >
            <label className="field">
              <span>Füllstand danach (%)</span>
              <input name="fill" type="number" min={1} max={100} defaultValue={50} />
            </label>
          </EditForm>
        </>
      )}

      {/* Löschen = falsch erfasst (nicht öffnen/austrinken) – deutlich abgesetzt. */}
      <DeleteBottles
        itemId={b.inventory_item_id}
        bottle={{ status: b.status, quantity: b.quantity, storage_room: b.storage_room, drunk_at: b.drunk_at }}
      />
    </section>
  );
}
