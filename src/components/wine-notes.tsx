import { Fragment } from "react";

/** Notizen zum Wein (wines.notes) mit den eingegebenen Zeilenumbrüchen; ohne: „Noch keine Notizen“. */
export function WineNotesView({ notes }: { notes: string | null }) {
  if (!notes) return <p className="muted">Noch keine Notizen</p>;
  return (
    <p className="wine-notes">
      {notes.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </p>
  );
}
