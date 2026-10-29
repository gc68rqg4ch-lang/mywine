// Notizen zum Wein (rein, auch im Browser nutzbar): gleiche Regeln für App, Bot und das
// automatische Speichern auf der Weinseite.

/** Höchstlänge der Notizen zum Wein. */
export const MAX_WINE_NOTES = 10_000;

/** Notizen: getrimmt, Zeilenumbrüche bleiben (CRLF → LF); leer → NULL (DB-Check: nie leer). */
export const cleanNotes = (text: string | null | undefined) => {
  const t = (text ?? "").replace(/\r\n?/g, "\n").trim();
  return t ? t : null;
};
