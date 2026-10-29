import Link from "next/link";
import type { NoteSegment } from "@/lib/home/note";
import { Greeting } from "./greeting";

/**
 * Kopf der Startseite: Antoines Foto (rund, oben links) und sein Text, der um das Foto herum fliesst. Weine im Text sind Links auf die
 * Weinseite; Weine, die nicht mehr im Bestand sind, stehen als reiner Text. Ohne Foto ein
 * Platzhalter (Weinrot, Creme-Initiale „A“). Die Begrüssung setzt die App nach der Uhrzeit davor.
 */
export function AntoineNote({
  photo,
  segments,
  person,
  greeting,
}: {
  photo: string | null;
  segments: NoteSegment[];
  /** Vorname für die Begrüssung (null: ohne Namen). */
  person: string | null;
  /** Begrüssung nach der Uhrzeit beim Laden (der Browser bestimmt sie neu). */
  greeting: string;
}) {
  return (
    <section className="antoine" aria-label="Antoine">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- eigenes Bild aus /media (privat, lange gecacht)
        <img src={photo} alt="Antoine" className="antoine-photo" width={176} height={176} />
      ) : (
        <span className="antoine-photo antoine-placeholder" role="img" aria-label="Antoine">
          A
        </span>
      )}
      <div className="antoine-body">
        <p className="antoine-text">
          <Greeting person={person} initial={greeting} />{" "}
          {segments.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.text}</span>
            ) : s.href ? (
              <Link key={i} href={s.href} className="antoine-wine">
                {s.label}
              </Link>
            ) : (
              <span key={i}>{s.label}</span>
            ),
          )}
        </p>
      </div>
    </section>
  );
}
