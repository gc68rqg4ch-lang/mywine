"use client";

import { useEffect, useRef, useState } from "react";

export type ViewerPhoto = { id: string; thumb: string; full: string; label: string };

/**
 * Grosses Bild über der Seite: wischen zwischen den Fotos (Vorder-, Rückseite …),
 * schliessen per Tippen, X oder Escape. Natives <dialog> – liegt über allem und
 * hält den Fokus.
 */
function Viewer({ photos, start, alt, onClose }: { photos: ViewerPhoto[]; start: number; alt: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  useEffect(() => {
    const d = dialog.current;
    // Kein close() beim Aufräumen: das close-Ereignis käme verspätet und würde ein
    // neu geöffnetes Overlay wieder schliessen. Beim Entfernen verschwindet es ohnehin.
    if (!d || d.open) return;
    d.showModal();
    // Ohne Animation zum angetippten Foto springen.
    if (track.current) track.current.scrollLeft = start * track.current.clientWidth;
  }, [start]);

  const onScroll = () => {
    const t = track.current;
    if (t && t.clientWidth) setIndex(Math.round(t.scrollLeft / t.clientWidth));
  };

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={alt}
      onClose={onClose}
      // Jeder Tipp schliesst; Wischen ist Scrollen und löst keinen Klick aus.
      onClick={onClose}
    >
      <div ref={track} className="viewer-track" onScroll={onScroll}>
        {photos.map((p) => (
          <figure key={p.id} className="viewer-slide">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.full} alt={`${alt} – ${p.label}`} />
            <figcaption>{p.label}</figcaption>
          </figure>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="viewer-dots" aria-hidden>
          {photos.map((p, i) => (
            <span key={p.id} className={i === index ? "active" : undefined} />
          ))}
        </div>
      )}
      <button type="button" className="viewer-close" aria-label="Schliessen" onClick={onClose}>
        ×
      </button>
    </dialog>
  );
}

/** Kleines Vorschaubild; Antippen öffnet das Overlay ab diesem Foto. */
export function PhotoThumb({
  photos,
  start = 0,
  alt,
  className,
}: {
  photos: ViewerPhoto[];
  start?: number;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const photo = photos[start];
  if (!photo) return null;
  return (
    <>
      <button
        type="button"
        className={`photo-thumb${className ? ` ${className}` : ""}`}
        aria-label={`${photo.label} von ${alt} gross anzeigen`}
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.thumb} alt="" loading="lazy" decoding="async" />
      </button>
      {open && <Viewer photos={photos} start={start} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Raster aller Fotos (Weinseite); jedes öffnet das gemeinsame Overlay. */
export function PhotoGallery({ photos, alt }: { photos: ViewerPhoto[]; alt: string }) {
  if (!photos.length) return null;
  return (
    <ul className="photo-gallery">
      {photos.map((p, i) => (
        <li key={p.id}>
          <PhotoThumb photos={photos} start={i} alt={alt} />
          <span className="photo-label">{p.label}</span>
        </li>
      ))}
    </ul>
  );
}
