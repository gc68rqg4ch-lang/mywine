// Grenze für Dokumente (PDF) – gleich in App, Bot und Speicher (Bucket wine-documents: 20 MB).
// Rein, auch im Browser nutzbar.

export const MAX_DOCUMENT_MB = 20;
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MB * 1024 * 1024;

/** Dieselbe Meldung in App und Bot. */
export const DOCUMENT_TOO_BIG = `Das PDF ist leider zu gross (über ${MAX_DOCUMENT_MB} MB). Magst du es verkleinern und nochmals versuchen?`;
