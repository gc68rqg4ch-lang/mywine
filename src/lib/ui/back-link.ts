// „← Bestand“ & Co. auf der Weinseite (rein, ohne DOM – auch für Tests): Ziel aus dem
// Listen-Gedächtnis (sessionStorage) und Rückfall auf eine harte Navigation, falls die
// App-Navigation hängt (z. B. hinter einer noch laufenden Server Action).

/** So lange darf die App-Navigation dauern, bevor die Seite hart neu geladen wird. */
export const BACK_FALLBACK_MS = 1500;

/**
 * Ziel des Zurück-Links: die zuletzt gezeigte URL dieser Liste („/bestand?gruppe=land“), aber nur,
 * wenn sie wirklich zu dieser Liste gehört (gleicher Pfad, keine fremde oder alte Adresse wie
 * „/?…“ aus der Zeit, als der Bestand noch auf „/“ lag); sonst die Liste selbst.
 */
export function backHref(base: string, stored: string | null | undefined) {
  if (!stored || !stored.startsWith("/") || stored.startsWith("//")) return base;
  const path = stored.split(/[?#]/)[0];
  return path === base ? stored : base;
}

/** Steht die Seite nach dem Antippen noch auf derselben Adresse? Dann hängt die Navigation. */
export function navigationStuck(before: string, now: string) {
  return before === now;
}

/** Gewöhnlicher Klick/Tipp (kein neuer Tab, kein Mittelklick): nur dann greift der Rückfall. */
export function plainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
