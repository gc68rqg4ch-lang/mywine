import Link from "next/link";
import type { ReactNode } from "react";
import { WineTypeIcon } from "@/components/wine-type-icon";
import type { WineType } from "@/lib/format";

/** Karte eines Weins in Bestand, Offen und Getrunken. */
export function WineCard({
  href,
  type,
  producer,
  title,
  meta,
  extra,
  aside,
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
}) {
  return (
    <li>
      <Link href={href} className="item">
        <WineTypeIcon type={type} />
        <div className="item-main">
          <span className="item-producer">{producer}</span>
          <span className="item-title">{title}</span>
          <span className="item-meta">{meta.filter(Boolean).join(" · ")}</span>
          {extra && <span className="item-meta item-extra">{extra}</span>}
        </div>
        {aside}
      </Link>
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
