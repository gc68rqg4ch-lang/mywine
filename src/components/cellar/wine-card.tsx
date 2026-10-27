import Link from "next/link";
import type { ReactNode } from "react";
import { PhotoThumb, type ViewerPhoto } from "@/components/photo-viewer";
import { WineTypeIcon } from "@/components/wine-type-icon";
import type { WineType } from "@/lib/format";
import { MEDIA_KIND_LABELS } from "@/lib/media/pick";
import type { LabelPair, ViewPhoto } from "@/lib/media/store";

export const viewerPhoto = (p: ViewPhoto): ViewerPhoto => ({ ...p, label: MEDIA_KIND_LABELS[p.kind] });

/** Karte eines Weins in Bestand, Offen und Getrunken. */
export function WineCard({
  href,
  type,
  producer,
  title,
  meta,
  extra,
  aside,
  photo,
}: {
  href: string;
  type: WineType | null;
  producer: string;
  title: string;
  /** Kleine Zeile unter dem Titel, Teile werden mit „·“ verbunden. */
  meta: (string | null | undefined | false)[];
  /** Optionale zweite kleine Zeile (z. B. Bewertungen). */
  extra?: ReactNode;
  /** Rechte Seite (Flaschenzahl, Füllstand …). */
  aside?: ReactNode;
  /** Etikett links statt Trauben-Symbol; Antippen öffnet das Overlay (Vorder-/Rückseite). */
  photo?: LabelPair | null;
}) {
  // Das Bild ist ein eigener Knopf über dem Platzhalter in der Karte – nicht im Link,
  // damit ein Tipp aufs Bild nicht die Weinseite öffnet.
  return (
    <li className="item-wrap">
      <Link href={href} className="item">
        {photo ? <span className="item-thumb-slot" aria-hidden /> : <WineTypeIcon type={type} />}
        <div className="item-main">
          <span className="item-producer">{producer}</span>
          <span className="item-title">{title}</span>
          <span className="item-meta">{meta.filter(Boolean).join(" · ")}</span>
          {extra && <span className="item-meta item-extra">{extra}</span>}
        </div>
        {aside}
      </Link>
      {photo && (
        <PhotoThumb
          className="item-thumb"
          photos={[photo.front, ...(photo.back ? [photo.back] : [])].map(viewerPhoto)}
          alt={`${producer} ${title}`}
        />
      )}
    </li>
  );
}

/** Flaschenzahl rechts auf der Karte. */
export function BottleCount({ bottles, note }: { bottles: number; note?: string | null }) {
  return (
    <span className="item-qty">
      {bottles} <span className="unit">Fl.</span>
      {note && <span className="item-open">{note}</span>}
    </span>
  );
}
