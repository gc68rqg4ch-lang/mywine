import Link from "next/link";
import type { ReactNode } from "react";
import { PhotoThumb, type ViewerPhoto } from "@/components/photo-viewer";
import { WineTypeIcon } from "@/components/wine-type-icon";
import { drinkStatusHref, type DrinkBadge } from "@/lib/cellar/overview";
import type { WineType } from "@/lib/format";
import { MEDIA_KIND_LABELS } from "@/lib/media/pick";
import type { LabelPair, ViewPhoto } from "@/lib/media/store";

export const viewerPhoto = (p: ViewPhoto): ViewPhoto & ViewerPhoto => ({ ...p, label: MEDIA_KIND_LABELS[p.kind] });

/**
 * Karte eines Weins in Bestand, Offen, Getrunken und Verkostet. Der Titel-Link deckt die ganze
 * Karte ab (::after); Foto und Trinkreife liegen darüber und sind eigene Ziele – so gibt es
 * keine verschachtelten Links. Inhalt oben ausgerichtet; ohne Foto steht das Trauben-Symbol
 * in einem Platzhalter von der Grösse eines Vorschaubilds.
 */
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
  producer: string | null;
  title: string;
  /** Kleine Zeile unter dem Titel, Teile werden mit „·“ verbunden. */
  meta: (string | null | undefined | false)[];
  /** Optionale zweite kleine Zeile (z. B. Bewertungen). */
  extra?: ReactNode;
  /** Rechte Seite (Flaschenzahl, Füllstand …). */
  aside?: ReactNode;
  /** Etikett statt Trauben-Symbol; Antippen öffnet das Overlay (Vorder-/Rückseite). */
  photo?: LabelPair | null;
  /** Trinkreife (eine Zeile je Jahrgang, falls verschieden); Antippen öffnet den Bestand nach Trinkreife gruppiert. */
  drink?: DrinkBadge[];
}) {
  return (
    <li className="item-wrap">
      <div className="item">
        <span className="item-thumb-slot">
          {photo ? (
            <PhotoThumb
              className="item-thumb"
              photos={[photo.front, ...(photo.back ? [photo.back] : [])].map(viewerPhoto)}
              alt={producer ? `${producer} ${title}` : title}
            />
          ) : (
            <WineTypeIcon type={type} size={30} />
          )}
        </span>
        <div className="item-main">
          {producer && <span className="item-producer">{producer}</span>}
          <Link href={href} className="item-title item-link">
            {title}
          </Link>
          <span className="item-meta">{meta.filter(Boolean).join(" · ")}</span>
          {extra && <span className="item-meta item-extra">{extra}</span>}
          {drink?.map((b, i) => (
            <span key={b.year ?? i} className="item-meta item-drink">
              <Link href={drinkStatusHref(b.status)} className={`drink-link drink-${b.status}`}>
                {b.year !== undefined ? `${b.year ?? "o. J."}: ` : ""}
                {b.text}
              </Link>
            </span>
          ))}
        </div>
        {aside}
      </div>
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
