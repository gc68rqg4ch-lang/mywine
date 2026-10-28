// Kleine HTML-Helfer für die Händler-Shops (rein, ohne DB und Netz).

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ss",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", ccedil: "ç", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", icirc: "î", iuml: "ï", ntilde: "ñ", oacute: "ó", ocirc: "ô", otilde: "õ", uacute: "ú", ucirc: "û",
  Eacute: "É", deg: "°", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", hellip: "…", euro: "€", middot: "·", times: "×",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code] ?? all;
  });
}

/** HTML-Ausschnitt → Text (Absätze und Zeilenumbrüche bleiben als Leerzeichen). */
export function htmlToText(html: string) {
  const text = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** Inhalt eines meta-Tags (name oder property). */
export function metaContent(html: string, key: string) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    html.match(new RegExp(`<meta[^>]+(?:name|property)="${esc}"[^>]*content="([^"]*)"`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:name|property)="${esc}"`, "i"));
  return m ? decodeEntities(m[1]).trim() : null;
}

/** href aller <a>, deren class das Stichwort enthält. */
export function linksWithClass(html: string, cls: string) {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    const klass = tag.match(/class="([^"]*)"/i)?.[1] ?? "";
    const href = tag.match(/href="([^"]*)"/i)?.[1];
    if (href && klass.split(/\s+/).includes(cls)) out.push(decodeEntities(href));
  }
  return [...new Set(out)];
}

/** Text auf höchstens max Zeichen kürzen (an einer Wortgrenze). */
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.8 ? space : max)} …`;
}
