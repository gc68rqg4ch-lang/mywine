"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { UnitButtons, useEditUnit } from "@/components/edit-unit";
import {
  GRAPE_SOURCE_LABELS,
  percentSum,
  type GrapeShare,
  type GrapeSource,
} from "@/lib/grapes/shares";
import type { ActionState } from "../../actions";
import { saveGrapeShares } from "../../grape-actions";
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

/** Rebsorten in „Zum Wein“ (Anzeige): Sorten mit %, Geltungsbereich und Quelle. */
export function GrapeList({
  shares,
  sharesVintage,
  itemVintage,
  sources,
}: {
  shares: GrapeShare[];
  /** Jahrgang der angezeigten Angaben; null = gilt für alle Jahrgänge. */
  sharesVintage: number | null;
  itemVintage: number | null;
  sources: GrapeSource[];
}) {
  const scopeLabel = sharesVintage != null ? `Jahrgang ${sharesVintage}` : shares.length ? "alle Jahrgänge" : null;
  return (
    <>
      {shares.length ? (
        <ul className="grape-list">
          {shares.map((share) => (
            <li key={share.grape}>
              <span>{share.grape}</span>
              {share.percent != null && (
                <span className="grape-bar" aria-hidden>
                  <span style={{ width: `${share.percent}%` }} />
                </span>
              )}
              <span className="grape-value">{share.percent != null ? `${share.percent.toLocaleString("de-CH")} %` : "–"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Keine Rebsorten erfasst.</p>
      )}
      {(scopeLabel || sources.length > 0) && (
        <p className="muted small">
          {[scopeLabel, sources.map((s) => GRAPE_SOURCE_LABELS[s]).join(", ")].filter(Boolean).join(" · ")}
          {sharesVintage == null && itemVintage != null && shares.length > 0
            ? " – noch keine Angaben speziell für diesen Jahrgang"
            : ""}
        </p>
      )}
    </>
  );
}

/** Rebsorten bearbeiten (nach ✏️): Zeilen mit Sorte und %, Summe; „Speichern“ / „Abbrechen“. */
export function GrapeForm({ itemId, itemVintage, shares }: { itemId: string; itemVintage: number | null; shares: GrapeShare[] }) {
  const unit = useEditUnit();
  const [rows, setRows] = useState<EditRow[]>(() => toRows(shares));
  const [saveState, saveAction, saving] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveGrapeShares(prev, formData);
    if (result?.ok) unit?.close(result.ok);
    return result;
  }, undefined);

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

  return (
    <form action={saveAction} className="stack">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="shares" value={JSON.stringify(rows.map(({ grape, percent }) => ({ grape, percent })))} />
      <p className="muted small">
        Gilt für {itemVintage != null ? `Jahrgang ${itemVintage}` : "alle Jahrgänge"}. Anteil leer lassen, wenn unbekannt.
      </p>
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
      <Notice state={saveState} />
      <UnitButtons pending={saving} />
    </form>
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
