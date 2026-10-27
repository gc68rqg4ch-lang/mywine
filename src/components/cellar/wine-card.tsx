import Link from "next/link";
import type { ReactNode } from "react";
import { PhotoThumb, type ViewerPhoto } from "@/components/photo-viewer";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { drinkStatusHref, type DrinkBadge } from "@/lib/cellar/overview";
import type { WineType } from "@/lib/format";
import { MEDIA_KIND_LABELS } from "@/lib/media/pick";
import type { LabelPair, ViewPhoto } from "@/lib/media/store";

export const viewerPhoto = (p: ViewPhoto): ViewPhoto & ViewerPhoto => ({ ...p, label: MEDIA_KIND_LABELS[p.kind] });

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
  drink,
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
  /** Trinkreife (eine Zeile je Jahrgang, falls verschieden); Antippen öffnet den Bestand nach Trinkreife gruppiert. */
  drink?: DrinkBadge[];
}) {
  // Bild und Trinkreife liegen über Platzhaltern in der Karte – nicht im Link, damit ein Tipp
  // darauf nicht die Weinseite öffnet (Links dürfen nicht verschachtelt sein).
  return (
    <li className="item-wrap">
      <Link href={href} className="item">
        {photo ? <span className="item-thumb-slot" aria-hidden /> : <WineTypeIcon type={type} />}
        <div className="item-main">
          <span className="item-producer">{producer}</span>
          <span className="item-title">{title}</span>
          <span className="item-meta">{meta.filter(Boolean).join(" · ")}</span>
          {extra && <span className="item-meta item-extra">{extra}</span>}
          {drink?.map((b, i) => (
            <span key={b.year ?? i} className="item-meta" aria-hidden>
              {"\u00a0"}
            </span>
          ))}
        </div>
        {aside}
      </Link>
      {drink?.length ? (
        <div className="item-drink-layer">
          {photo ? <span className="item-thumb-slot" /> : <span className="item-drink-spacer" />}
          <span className="item-drink">
            {drink.map((b, i) => (
              <span key={b.year ?? i} className="item-meta">
                <Link href={drinkStatusHref(b.status)} className={`drink-link drink-${b.status}`}>
                  {b.year !== undefined ? `${b.year ?? "o. J."}: ` : ""}
                  {b.text}
                </Link>
              </span>
            ))}
          </span>
        </div>
      ) : null}
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
