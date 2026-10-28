"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { docClip } from "@/lib/cellar/wine-units";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { ActionState } from "../../actions";
import { deleteDocument, prepareDocumentUpload, registerDocument } from "../../document-actions";

const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "wine-documents";

export type DocumentItem = { id: string; name: string; url: string | null; vintageYear: number | null };

/**
 * Dokumente (PDF) als Büroklammer im Kopf der Weinseite: „📎 Dateiname“, „📎 2 Dokumente“
 * bzw. nur „📎“. Antippen öffnet ein kleines Feld: Dokument antippen = öffnen (neuer Tab),
 * 🗑 = löschen (Rückfrage), „＋ Dokument hinzufügen“ lädt direkt in den privaten Bucket.
 */
export function DocumentClip({ docs, wineId, vintageYear }: { docs: DocumentItem[]; wineId: string; vintageYear: number | null }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const clip = docClip(docs.map((d) => d.name));

  // Antippen ausserhalb oder Escape schliesst das Feld.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const upload = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return setState({ error: "Nur PDF-Dateien." });
    if (file.size > MAX_BYTES) return setState({ error: "Das PDF ist zu gross (max. 10 MB)." });
    setState(undefined);
    startTransition(async () => {
      const target = await prepareDocumentUpload(wineId);
      if ("error" in target) return setState({ error: target.error });
      const { error } = await createBrowserSupabase()
        .storage.from(BUCKET)
        .upload(target.path, file, { contentType: "application/pdf", upsert: false });
      if (error) return setState({ error: "Hochladen ist fehlgeschlagen." });
      setState(await registerDocument({ wineId, vintageYear, path: target.path, fileName: file.name }));
    });
  };

  const remove = (doc: DocumentItem) => {
    if (!window.confirm(`„${doc.name}“ löschen? Das PDF wird endgültig entfernt.`)) return;
    startTransition(async () => setState(await deleteDocument(doc.id)));
  };

  return (
    <div className="doc-clip" ref={box}>
      <button
        type="button"
        className={docs.length ? "doc-clip-btn" : "doc-clip-btn is-empty"}
        aria-expanded={open}
        aria-label={clip.label}
        title={clip.label}
        onClick={() => setOpen((v) => !v)}
      >
        {clip.text}
      </button>
      {open && (
        <div className="doc-pop stack-sm" role="dialog" aria-label="Dokumente">
          {docs.length > 0 && (
            <ul className="doc-list">
              {docs.map((d) => (
                <li key={d.id}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="doc-link link">
                      📄 {d.name}
                    </a>
                  ) : (
                    <span className="doc-link muted">📄 {d.name}</span>
                  )}
                  {d.vintageYear == null && vintageYear != null && <span className="muted small">alle Jahrgänge</span>}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => remove(d)}
                    aria-label={`${d.name} löschen`}
                    title="Löschen"
                  >
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-sm upload-btn" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Einen Moment …" : "＋ Dokument hinzufügen"}
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <p className="muted small">PDF, max. 10 MB, gilt für {vintageYear != null ? `Jahrgang ${vintageYear}` : "„ohne Jahrgang“"}.</p>
          {state?.error && (
            <p className="notice notice-error" role="alert">
              {state.error}
            </p>
          )}
          {state?.ok && !pending && (
            <p className="muted small" role="status">
              {state.ok}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
