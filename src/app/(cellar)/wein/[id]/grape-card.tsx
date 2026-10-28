"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useEditUnit } from "@/components/edit-unit";
import { percentSum, type GrapeShare } from "@/lib/grapes/shares";
import type { ActionState } from "../../actions";
import { researchWineFromPage } from "../../research-actions";

type EditRow = { key: number; grape: string; percent: string };

function toRows(shares: GrapeShare[]): EditRow[] {
  const rows = shares.map((s, i) => ({
    key: i,
    grape: s.grape,
    percent: s.percent == null ? "" : String(s.percent),
  }));
  return rows.length ? rows : [{ key: 0, grape: "", percent: "" }];
}

function Notice({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p className="notice notice-error" role="alert">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p className="notice notice-ok" role="status">
        {state.ok}
      </p>
    );
  return null;
}

/**
 * Rebsorten im Formular „Zum Wein“: Zeilen mit Sorte und %, Summe. Gespeichert wird mit dem
 * ganzen Formular (Felder „shares“ und „sharesBefore“ als JSON; unverändert = nichts).
 */
export function GrapeRowsField({ shares, year }: { shares: GrapeShare[]; year: number | null }) {
  const unit = useEditUnit();
  const [rows, setRows] = useState<EditRow[]>(() => toRows(shares));
  const change = (next: (current: EditRow[]) => EditRow[]) => {
    setRows(next);
    unit?.markDirty();
  };
  const updateRow = (key: number, patch: Partial<EditRow>) =>
    change((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () =>
    change((current) => [...current, { key: Math.max(-1, ...current.map((r) => r.key)) + 1, grape: "", percent: "" }]);
  const removeRow = (key: number) => change((current) => current.filter((r) => r.key !== key));
  const editSum = percentSum(rows.map((r) => ({ grape: r.grape, percent: Number(r.percent.replace(",", ".")) || null })));
  const json = (list: { grape: string; percent: string }[]) => JSON.stringify(list.map(({ grape, percent }) => ({ grape, percent })));

  return (
    <fieldset className="stack-sm grape-field">
      <legend className="field-label">Rebsorten {year != null ? `(Jahrgang ${year})` : "(alle Jahrgänge)"}</legend>
      <input type="hidden" name="shares" value={json(rows)} />
      <input type="hidden" name="sharesBefore" value={json(toRows(shares))} />
      <div className="grape-rows">
        {rows.map((row) => (
          <div key={row.key} className="grape-row">
            <input
              type="text"
              value={row.grape}
              onChange={(e) => updateRow(row.key, { grape: e.target.value })}
              placeholder="Rebsorte"
              aria-label="Rebsorte"
            />
            <input
              type="text"
              inputMode="decimal"
              value={row.percent}
              onChange={(e) => updateRow(row.key, { percent: e.target.value })}
              placeholder="%"
              aria-label={`Anteil ${row.grape || "Rebsorte"} in Prozent`}
              className="grape-percent"
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(row.key)} aria-label={`${row.grape || "Zeile"} entfernen`}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row row-between">
        <button type="button" className="btn btn-sm" onClick={addRow}>
          + Rebsorte
        </button>
        <span className={editSum > 100 ? "sum sum-over" : "sum muted"}>Summe {editSum.toLocaleString("de-CH")} %</span>
      </div>
    </fieldset>
  );
}

/** Recherche in „Zum Wein“: „🔎 Nachrecherchieren“ und „Zuletzt recherchiert am …“. */
export function ResearchBlock({ wineId, researchedOn = null }: { wineId: string; researchedOn?: string | null }) {
  const [researchState, researchAction, researching] = useActionState(researchWineFromPage, undefined);
  return (
    <form action={researchAction} className="stack-sm">
      <input type="hidden" name="wineId" value={wineId} />
      <div className="row row-between">
        <button type="submit" className="btn btn-sm" disabled={researching}>
          {researching ? "Recherchiere …" : "🔎 Nachrecherchieren"}
        </button>
        <Link href="/recherche" className="small link">
          Sammellauf für alle Weine
        </Link>
      </div>
      {researching && (
        <p className="muted small" role="status">
          Ich ergänze alle leeren Angaben dieses Weins (Herkunft, Alkohol, Trinkfenster, Rebsorten mit %) – das kann ein bis
          zwei Minuten dauern.
        </p>
      )}
      {!researching && <Notice state={researchState} />}
      {!researching && <p className="muted small">{researchedOn ? `Zuletzt recherchiert am ${researchedOn}` : "Noch nie recherchiert"}</p>}
    </form>
  );
}
