import Link from "next/link";
import type { NoteSegment } from "@/lib/home/note";

/**
 * Kopf der Startseite: Antoines Foto (rund) und sein Text. Weine im Text sind Links auf die
 * Weinseite; Weine, die nicht mehr im Bestand sind, stehen als reiner Text. Ohne Foto ein
 * Platzhalter (Weinrot, Creme-Initiale „A“).
 */
export function AntoineNote({ photo, segments }: { photo: string | null; segments: NoteSegment[] }) {
  return (
    <section className="antoine" aria-label="Antoine">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- eigenes Bild aus /media (privat, lange gecacht)
        <img src={photo} alt="Antoine" className="antoine-photo" width={112} height={112} />
      ) : (
        <span className="antoine-photo antoine-placeholder" role="img" aria-label="Antoine">
          A
        </span>
      )}
      <div className="antoine-body">
        <p className="antoine-text">
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
