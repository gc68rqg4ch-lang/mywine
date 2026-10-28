// Kleine PDF-Prüfung ohne Bibliothek (nur Node zlib): Seitenzahl und Text der Textoperatoren
// (Tj/TJ), um den Jahrgang eines Datenblatts ohne vintage_year zu erkennen. Das eigentliche
// Lesen übernimmt Claude (PDF als Dokument). Was sich nicht lesen lässt (z. B. CID-Schriften),
// ergibt keinen Text – dann gilt der Jahrgang als unklar.

import { inflateSync } from "node:zlib";

/** Rohinhalt plus entpackte Streams (FlateDecode) als latin1-Text. */
function pdfChunks(bytes: Uint8Array) {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const chunks = [raw];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      chunks.push(inflateSync(buf.subarray(start, end)).toString("latin1"));
    } catch {
      // nicht komprimiert oder anderes Verfahren – roher Inhalt ist schon dabei
    }
    re.lastIndex = end;
  }
  return chunks;
}

/** Anzahl Seiten (Objekte „/Type /Page“); 0 = unbekannt. */
export function pdfPageCount(bytes: Uint8Array) {
  return pdfChunks(bytes).reduce((n, c) => n + (c.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0), 0);
}

const unescape = (s: string) =>
  s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e: string) =>
    /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[e],
  );

/**
 * Zeichenkette aus dem PDF lesbar machen: UTF-16BE (mit BOM oder jedes zweite Byte 0, z. B. die
 * Datenblätter von Mövenpick) bzw. latin1. Binärdaten (Bilder, die zufällig wie Text aussehen)
 * → leer.
 */
function decodeString(s: string) {
  let text = s;
  const zeros = [...s].filter((c, i) => i % 2 === 0 && c === "\u0000").length;
  if (s.startsWith("\u00fe\u00ff") || (s.length >= 2 && s.length % 2 === 0 && zeros >= s.length / 4)) {
    const bytes = Buffer.from(s.startsWith("\u00fe\u00ff") ? s.slice(2) : s, "latin1");
    const even = bytes.length - (bytes.length % 2);
    text = Buffer.from(bytes.subarray(0, even)).swap16().toString("utf16le");
  }
  // Steuerzeichen (ausser Leerraum) sprechen für Binärdaten.
  const control = text.match(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\ufffd]/g)?.length ?? 0;
  return control > text.length * 0.05 ? "" : text.replace(/[\u0000-\u001f]/g, " ");
}

/** Text aus den Textoperatoren (Tj, TJ, ', ") – ohne Metadaten wie das Erstelldatum. */
export function pdfText(bytes: Uint8Array) {
  const out: string[] = [];
  for (const chunk of pdfChunks(bytes)) {
    for (const m of chunk.matchAll(/\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g)) {
      // TJ: Zeichenketten mit Abständen dazwischen; ein grosser Abstand (Blocksatz) ist ein Leerzeichen.
      if (m[1] != null) out.push([...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g)].map((x) => (x[2] != null ? (Number(x[2]) <= -150 ? " " : "") : decodeString(unescape(x[1])))).join(""));
      else out.push(decodeString(unescape(m[2])));
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Jahrgang, der im PDF-Text eindeutig steht: nach „Jahrgang/Vintage/Millésime/Añada/Annata“
 * oder direkt nach dem Weinnamen („Pintia 2019“). Mehrere verschiedene → null (unklar).
 */
export function vintageInPdfText(text: string, wineName: string) {
  const years = new Set<number>();
  const max = new Date().getFullYear() + 1;
  const add = (y: string) => {
    const n = Number(y);
    if (n >= 1900 && n <= max) years.add(n);
  };
  for (const m of text.matchAll(/(?:jahrgang|vintage|mill[ée]sime|añada|anada|annata)\s*:?\s*((?:19|20)\d{2})\b/gi)) add(m[1]);
  const name = wineName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (name) for (const m of text.matchAll(new RegExp(`${name}\\s*,?\\s*((?:19|20)\\d{2})\\b`, "gi"))) add(m[1]);
  return years.size === 1 ? [...years][0] : null;
}
