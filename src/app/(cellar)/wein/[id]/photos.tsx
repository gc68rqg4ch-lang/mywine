"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useEditUnit } from "@/components/edit-unit";
import { PhotoGallery, type ViewerPhoto } from "@/components/photo-viewer";
import { MEDIA_KIND_LABELS, type MediaKind } from "@/lib/media/pick";
import { deleteWinePhoto, uploadWinePhoto } from "../../photo-actions";

const MAX_EDGE = 2000;
const KEEP_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Verkleinert im Browser auf höchstens 2000 px (JPEG). Wandelt dabei auch HEIC
 * (iPhone) um, das der Server nicht lesen kann.
 */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && KEEP_TYPES.includes(file.type) && file.size < 2_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

const OPTIONS: { kind: MediaKind; label: string }[] = [
  { kind: "label_front", label: "Vorderseite" },
  { kind: "label_back", label: "Rückseite" },
  { kind: "photo", label: "Weiteres" },
];

export type WinePhoto = ViewerPhoto & { kind: MediaKind; legacy?: boolean };

/** Ziel des nächsten Uploads: Art und ggf. die Fotos, die es ersetzt. */
type Target = { kind: MediaKind; replace: WinePhoto[] };

/**
 * Fotos des gewählten Jahrgangs: Vorschau mit Overlay, je Foto Ersetzen/Löschen
 * (mit Rückfrage), dazu „Foto hinzufügen“. Das Vorschaubild erzeugt der Server.
 */
export function WinePhotos({
  wineId,
  vintageYear,
  itemId,
  photos,
  alt,
  embedded = false,
}: {
  wineId: string;
  vintageYear: number | null;
  itemId: string | null;
  photos: WinePhoto[];
  alt: string;
  /** Im Formular „Zum Wein“: ohne eigenes „Fertig“ (das Formular hat Speichern/Abbrechen). */
  embedded?: boolean;
}) {
  const has = (kind: MediaKind) => photos.some((p) => p.kind === kind && !p.legacy);
  const [kind, setKind] = useState<MediaKind>(
    !has("label_front") ? "label_front" : !has("label_back") ? "label_back" : "photo",
  );
  const [uploadState, upload, uploading] = useActionState(uploadWinePhoto, undefined);
  const [deleteState, remove, deleting] = useActionState(deleteWinePhoto, undefined);
  const [preparing, startPreparing] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  // Letzte Aktion entscheidet, welche Meldung gilt.
  const [last, setLast] = useState<"upload" | "delete">("upload");
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Target>({ kind, replace: [] });
  const busy = uploading || deleting || preparing;
  // Hochladen/Löschen gilt sofort; „Fertig“ schliesst die Einheit.
  const unit = useEditUnit();

  /** Dateiauswahl öffnen – direkt im Tipp, sonst blockiert Safari den Dialog. */
  const pick = (next: Target) => {
    target.current = next;
    input.current?.click();
  };

  const addNew = () => {
    // Vorder- und Rückseite gibt es je Jahrgang nur einmal: eine vorhandene wird ersetzt (Rückfrage nach der Auswahl).
    const replace = kind === "photo" ? [] : photos.filter((p) => p.kind === kind && !p.legacy);
    pick({ kind, replace });
  };

  const onFile = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    const { kind: k, replace } = target.current;
    if (replace.length && !window.confirm(`Die bisherige ${MEDIA_KIND_LABELS[replace[0].kind]} durch das neue Foto ersetzen?`)) {
      return;
    }
    setClientError(null);
    setLast("upload");
    startPreparing(async () => {
      let blob: Blob;
      try {
        blob = await shrink(file);
      } catch {
        setClientError("Dieses Bild kann der Browser nicht lesen. Bitte JPEG oder PNG wählen.");
        return;
      }
      const data = new FormData();
      data.set("wineId", wineId);
      data.set("vintageYear", vintageYear == null ? "" : String(vintageYear));
      if (itemId) data.set("itemId", itemId);
      data.set("kind", k);
      data.set("replaceIds", replace.map((p) => p.id).join(","));
      const name = file.name.replace(/\.[^.]+$/, "") || "foto";
      data.set("photo", new File([blob], blob === file ? file.name : `${name}.jpg`, { type: blob.type || "image/jpeg" }));
      // Nach dem await gehört der Aufruf wieder in eine Transition.
      startPreparing(() => upload(data));
    });
  };

  const onDelete = (photo: WinePhoto) => {
    if (!window.confirm(`${photo.label} löschen? Das Foto wird endgültig entfernt.`)) return;
    const data = new FormData();
    data.set("mediaId", photo.id);
    setClientError(null);
    setLast("delete");
    startPreparing(() => remove(data));
  };

  const state = last === "upload" ? uploadState : deleteState;
  const error = clientError ?? state?.error;
  return (
    <div className="stack">
      <PhotoGallery
        photos={photos}
        alt={alt}
        actions={(p) =>
          p.legacy ? null : (
            <span className="photo-actions">
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() => pick({ kind: p.kind, replace: [p] })}
              >
                Ersetzen
              </button>
              <button type="button" className="link-btn link-danger" disabled={busy} onClick={() => onDelete(p)}>
                Löschen
              </button>
            </span>
          )
        }
      />
      <div className="stack-sm">
        <div className="segmented" role="radiogroup" aria-label="Art des Fotos">
          {OPTIONS.map((o) => (
            <button
              key={o.kind}
              type="button"
              role="radio"
              aria-checked={kind === o.kind}
              className={kind === o.kind ? "segment active" : "segment"}
              onClick={() => setKind(o.kind)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm upload-btn" disabled={busy} onClick={addNew}>
          {preparing || uploading ? "Wird hochgeladen …" : deleting ? "Wird gelöscht …" : "📷 Foto hinzufügen"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {!error && state?.ok && !busy && (
          <p className="muted small" role="status">
            {state.ok}
          </p>
        )}
        {unit && !embedded && (
          <div className="row unit-buttons">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => unit.close()}>
              Fertig
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
