"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import type { MediaKind } from "@/lib/media/pick";
import { uploadWinePhoto } from "../../photo-actions";

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

/** Foto zum gewählten Jahrgang hochladen; das Vorschaubild erzeugt der Server. */
export function PhotoUpload({
  wineId,
  vintageYear,
  itemId,
  defaultKind,
}: {
  wineId: string;
  vintageYear: number | null;
  itemId: string | null;
  defaultKind: MediaKind;
}) {
  const [kind, setKind] = useState<MediaKind>(defaultKind);
  const [state, action, pending] = useActionState(uploadWinePhoto, undefined);
  const [preparing, startPreparing] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = pending || preparing;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setClientError(null);
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
      data.set("kind", kind);
      const name = file.name.replace(/\.[^.]+$/, "") || "foto";
      data.set("photo", new File([blob], blob === file ? file.name : `${name}.jpg`, { type: blob.type || "image/jpeg" }));
      // Nach dem await gehört der Aufruf wieder in eine Transition.
      startPreparing(() => action(data));
      if (input.current) input.current.value = "";
    });
  };

  const error = clientError ?? state?.error;
  return (
    <div className="stack-sm photo-upload">
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
      <label className="btn btn-sm upload-btn" aria-disabled={busy || undefined}>
        {busy ? "Wird hochgeladen …" : "📷 Foto hinzufügen"}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
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
    </div>
  );
}
