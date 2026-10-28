"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import {
  APPEARANCE_FIELDS,
  AROMA_SUBTITLE,
  COLOURS,
  CONCLUSION_FIELDS,
  NOSE_FIELDS,
  PALATE_FIELDS,
  SAT_TYPES,
  SCORE_FIELDS,
  aromaBlocksForType,
  autoEvaluate,
  currentScore,
  freshData,
  manualScoresFromData,
  mousseVisible,
  normalizeData,
  qualityForScore,
  switchType,
  tanninVisible,
  toText,
  toggleAroma,
  toggleField,
  type FieldDef,
  type SatData,
  type SatType,
} from "@/lib/tasting/sat";
import { deleteTasting, saveTasting, type TastingTarget } from "../../../tasting-actions";

type Person = { id: string; name: string };

const META_FIELDS: { key: keyof SatData["meta"]; label: string; type?: string }[] = [
  { key: "name", label: "Wein-Name" },
  { key: "producer", label: "Produzent" },
  { key: "region", label: "Region / Land" },
  { key: "vintage", label: "Jahrgang" },
  { key: "grape", label: "Rebsorte(n)" },
  { key: "date", label: "Datum", type: "date" },
];

// Entwurf im Browser (wie im Tool), damit beim Verkosten nichts verloren geht.
const noopSubscribe = () => () => {};
function readDraft(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, data: SatData) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Speicher nicht verfügbar – ohne Entwurf weiterarbeiten.
  }
}
function removeDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignorieren
  }
}

export function SatForm({
  target,
  doneHref,
  cancelHref,
  tastingId,
  initial,
  initialManual,
  persons,
  initialPersonId,
  today,
  draftKey,
}: {
  /** Flasche oder Eintrag „Verkostet“ */
  target: TastingTarget;
  /** Nach dem Speichern bzw. Löschen */
  doneHref: string;
  cancelHref: string;
  tastingId: string | null;
  initial: SatData;
  initialManual: string[];
  persons: Person[];
  initialPersonId: string | null;
  today: string;
  draftKey: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<SatData>(initial);
  const [manual, setManual] = useState<Set<string>>(() => new Set(initialManual));
  const [personId, setPersonId] = useState<string>(initialPersonId ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [draftHandled, setDraftHandled] = useState(false);
  const [pending, startTransition] = useTransition();

  const storedDraft = useSyncExternalStore(noopSubscribe, () => readDraft(draftKey), () => null);
  const showDraftOffer = !draftHandled && storedDraft != null && storedDraft !== JSON.stringify(initial);

  /** Änderung anwenden, neu bewerten (autoEvaluate) und Entwurf sichern. */
  function apply(mutate: (d: SatData) => SatData, nextManual: Set<string> = manual) {
    const evaluated = autoEvaluate(mutate(data), nextManual).data;
    setData(evaluated);
    setManual(nextManual);
    writeDraft(draftKey, evaluated);
    setDraftHandled(true);
  }

  const onPill = (field: FieldDef, option: string) => {
    let nextManual = manual;
    if (field.score) nextManual = new Set(manual).add(field.key);
    apply((d) => toggleField(d, field, option), nextManual);
  };

  const onType = (t: SatType) => apply((d) => switchType(d, t));

  const onMeta = (key: keyof SatData["meta"], value: string) =>
    apply((d) => ({ ...d, meta: { ...d.meta, [key]: value } }));

  const restoreDraft = () => {
    try {
      const restored = normalizeData(JSON.parse(storedDraft ?? "null"), today);
      const restoredManual = manualScoresFromData(restored);
      setManual(restoredManual);
      setData(autoEvaluate(restored, restoredManual).data);
      setMessage({ kind: "ok", text: "Entwurf wiederhergestellt" });
    } catch {
      removeDraft(draftKey);
    }
    setDraftHandled(true);
  };

  const discardDraft = () => {
    removeDraft(draftKey);
    setDraftHandled(true);
  };

  // Abweichung vom Tool: Die Wein-Angaben bleiben beim Leeren erhalten, weil die
  // Verkostung immer zu dieser Flasche gehört.
  const clearForm = () => {
    if (!confirm("Formular wirklich leeren?")) return;
    const fresh = freshData(today);
    const cleared = switchType({ ...fresh, meta: { ...data.meta, date: today } }, data.type);
    const nextManual = new Set<string>();
    const evaluated = autoEvaluate(cleared, nextManual).data;
    setData(evaluated);
    setManual(nextManual);
    writeDraft(draftKey, evaluated);
    setMessage({ kind: "ok", text: "Formular geleert" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(toText(data));
      setMessage({ kind: "ok", text: "In Zwischenablage kopiert" });
    } catch {
      setMessage({ kind: "error", text: "Kopieren nicht möglich" });
    }
  };

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await saveTasting({ target, tastingId, personId: personId || null, sat: data });
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      removeDraft(draftKey);
      router.push(doneHref);
    });

  const remove = () => {
    if (!tastingId || !confirm("Verkostung wirklich löschen?")) return;
    startTransition(async () => {
      const result = await deleteTasting(target, tastingId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      removeDraft(draftKey);
      router.push(cancelHref);
    });
  };

  const score = currentScore(data);
  const isSelected = (key: string, option: string) => {
    const v = data.fields[key];
    return Array.isArray(v) ? v.includes(option) : v === option;
  };

  const pillRow = (field: FieldDef, options = field.options) => (
    <div className="sat-row" key={field.key}>
      <div className="sat-label">
        {field.label}
        {field.hint && <span className="sat-hint">{field.hint}</span>}
      </div>
      <div className="chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={isSelected(field.key, option) ? "chip active" : "chip"}
            aria-pressed={isSelected(field.key, option)}
            onClick={() => onPill(field, option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );

  const subtitle =
    data.type === "schaum" ? AROMA_SUBTITLE.schaum : data.type === "suess" ? AROMA_SUBTITLE.suess : AROMA_SUBTITLE.default;

  return (
    <div className="stack sat" data-type={data.type}>
      <div className="sat-toolbar">
        <div className="row">
          {SAT_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              className={type === data.type ? "chip active" : "chip"}
              aria-pressed={type === data.type}
              onClick={() => onType(type)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={pending}>
            {pending ? "Speichert …" : "Speichern"}
          </button>
          <button type="button" className="btn btn-sm" onClick={clearForm} disabled={pending}>
            Formular leeren
          </button>
          <button type="button" className="btn btn-sm" onClick={copyText}>
            Als Text kopieren
          </button>
          {tastingId && (
            <button type="button" className="btn btn-sm" onClick={remove} disabled={pending}>
              Löschen
            </button>
          )}
          <Link href={cancelHref} className="btn btn-ghost btn-sm">
            Abbrechen
          </Link>
        </div>
        {message && (
          <p className={message.kind === "ok" ? "notice notice-ok" : "notice notice-error"} role="status">
            {message.text}
          </p>
        )}
      </div>

      {showDraftOffer && (
        <div className="notice notice-ok row row-between">
          <span>Es gibt einen ungespeicherten Entwurf für dieses Formular.</span>
          <span className="row">
            <button type="button" className="btn btn-sm" onClick={restoreDraft}>
              Wiederherstellen
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardDraft}>
              Verwerfen
            </button>
          </span>
        </div>
      )}

      <section className="card stack">
        <h2 className="section-title">Wein</h2>
        <div className="sat-meta">
          {META_FIELDS.map(({ key, label, type }) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                type={type ?? "text"}
                value={data.meta[key] ?? ""}
                onChange={(e) => onMeta(key, e.target.value)}
              />
            </label>
          ))}
          <label className="field">
            <span>Verkostet von</span>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">–</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Optischer Eindruck</h2>
        {APPEARANCE_FIELDS.map((f) => pillRow(f))}
        {pillRow({ key: "farbton", label: "Farbton", options: COLOURS[data.type] })}
        <div className="sat-row">
          <div className="sat-label">
            Andere Eindrücke
            <span className="sat-hint">z. B. Schlieren/Tränen, Depot, Perlage, Bläschen</span>
          </div>
          <textarea
            value={data.appearanceOther}
            onChange={(e) => apply((d) => ({ ...d, appearanceOther: e.target.value }))}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Geruch</h2>
        {NOSE_FIELDS.map((f) => pillRow(f))}
      </section>

      <section className="card">
        <h2 className="section-title">Aromen und Geschmacksnoten</h2>
        <p className="muted small">{subtitle}</p>
        {aromaBlocksForType(data.type).map((block) => (
          <details key={block.key} className="sat-aromas" open>
            <summary>{block.title}</summary>
            <p className="muted small">{block.sub}</p>
            {block.groups.map(([group, options]) => (
              <div className="sat-row" key={group}>
                <div className="sat-label">{group}</div>
                <div className="chips">
                  {options.map((option) => {
                    const selected = data.aromas[group]?.includes(option) ?? false;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={selected ? "chip active" : "chip"}
                        aria-pressed={selected}
                        onClick={() => apply((d) => toggleAroma(d, group, option))}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </details>
        ))}
      </section>

      <section className="card">
        <h2 className="section-title">Geschmack</h2>
        {PALATE_FIELDS.filter(
          (f) => (f.key !== "tannin" || tanninVisible(data.type)) && (f.key !== "mousse" || mousseVisible(data.type)),
        ).map((f) => pillRow(f))}
      </section>

      <section className="card">
        <h2 className="section-title">Gesamteindruck – Qualitätsbeurteilung</h2>
        <p className="muted small">
          Die Qualitätsbeurteilung erfolgt nach Balance, Länge, Intensität und Komplexität. Die Punkte sind eine
          Lernhilfe, keine offizielle WSET-Rechenformel.
        </p>
        {SCORE_FIELDS.map((f) => pillRow(f))}
        <div className="sat-score">
          <span className="sat-score-value">{score != null ? score.toLocaleString("de-CH") : "—"}</span>
          <span> / 4</span>
          <span className="sat-score-quality">
            {score != null ? `→ ${qualityForScore(score)}` : "Bitte Länge, Intensität und Aromen erfassen"}
          </span>
        </div>
        {CONCLUSION_FIELDS.map((f) => pillRow(f))}
      </section>

      <section className="card stack">
        <h2 className="section-title">Notizen</h2>
        <textarea
          value={data.notes}
          placeholder="Begründung der Qualität, genaue Aromen, Identifikation, Speisenbegleitung usw."
          onChange={(e) => apply((d) => ({ ...d, notes: e.target.value }))}
        />
      </section>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? "Speichert …" : "Verkostung speichern"}
        </button>
        <Link href={cancelHref} className="btn btn-ghost">
          Abbrechen
        </Link>
      </div>
    </div>
  );
}
