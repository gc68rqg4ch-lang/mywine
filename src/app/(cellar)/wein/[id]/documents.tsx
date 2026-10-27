"use client";

import { useRef, useState, useTransition } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { ActionState } from "../../actions";
import { deleteDocument, prepareDocumentUpload, registerDocument } from "../../document-actions";

const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "wine-documents";

export type DocumentItem = { id: string; name: string; url: string | null; vintageYear: number | null };

/**
 * Dokumente (PDF) in „Zum Wein“: Antippen öffnet das PDF in einem neuen Tab. Im
 * Bearbeiten-Modus hochladen (direkt in den privaten Bucket, max. 10 MB) und löschen.
 */
export function WineDocuments({
  docs,
  editing,
  wineId,
  vintageYear,
}: {
  docs: DocumentItem[];
  editing: boolean;
  wineId: string;
  vintageYear: number | null;
}) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

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
    <div className="stack-sm">
      {docs.length > 0 ? (
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
              {editing && (
                <button type="button" className="link-btn link-danger" disabled={pending} onClick={() => remove(d)}>
                  Löschen
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Noch keine Dokumente.</p>
      )}
      {editing && (
        <>
          <button type="button" className="btn btn-sm upload-btn" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Einen Moment …" : "📄 PDF hochladen"}
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
          <p className="muted small">Max. 10 MB, gilt für {vintageYear != null ? `Jahrgang ${vintageYear}` : "„ohne Jahrgang“"}.</p>
        </>
      )}
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
  );
}
