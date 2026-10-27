// Menüs des Telegram-Bots: Callback-Format, Emojis, Zeilen und Knöpfe (rein, ohne DB).
//
// callback_data (max. 64 Bytes), Felder mit ":" getrennt, `<l>` = Liste für „Zurück“:
//   L:<l>[:<offset>]          Liste: o = offen, r = trinkreif, b = Bestand (Weintypen), t<typ> = Weine eines Typs
//   W:<wine>:<l>              Wein (Jahrgang wählen)      V:<wine>:<jahr|->:<l>   Jahrgang (ungeöffnet)
//   O:<item>:<l>              offene Flasche              G:<item>:<n>:<l>        n Gläser getrunken
//   F:<item>:<l>              Füllstand wählen            P:<item>:<prozent>:<l>  Füllstand setzen
//   D:<item>:<l>              Ausgetrunken? (Rückfrage)   X:<item>:<l>            als ausgetrunken markieren
//   N:<wine>:<jahr|->:<l>     Öffnen (ggf. Ort wählen)    Q:<charge>:<l>          diese Charge öffnen
//   R:<subj>:<person>:<l>     Sterne wählen               S:<subj>:<person>:<halbe>:<l>  Bewertung speichern
// subj = o<item> oder v<wine>.<jahr|->; person = Anfang der Personen-UUID (8 Zeichen).

import type { WineType } from "@/lib/format";
import type { TgInlineButton, TgInlineKeyboard, TgReplyKeyboard } from "@/lib/telegram/types";

export const PAGE_SIZE = 8;

// ---------------------------------------------------------------------------
// Weintypen

export type TypeCode = "r" | "w" | "p" | "s" | "y" | "o" | "u";

export const TYPE_CODES: TypeCode[] = ["r", "w", "p", "s", "y", "o", "u"];

const TYPE_INFO: Record<TypeCode, { emoji: string; label: string }> = {
  r: { emoji: "🍷", label: "Rot" },
  w: { emoji: "🥂", label: "Weiss" },
  p: { emoji: "🌸", label: "Rosé" },
  s: { emoji: "🍾", label: "Schaumwein" },
  y: { emoji: "🍯", label: "Süss/Likör" },
  o: { emoji: "🟠", label: "Orange" },
  u: { emoji: "🍇", label: "Unbekannt" },
};

export function typeCode(type: WineType | null | undefined): TypeCode {
  switch (type) {
    case "red":
      return "r";
    case "white":
      return "w";
    case "rose":
      return "p";
    case "sparkling":
      return "s";
    case "sweet":
    case "fortified":
      return "y";
    case "orange":
      return "o";
    default:
      return "u";
  }
}

export const typeEmoji = (type: WineType | null | undefined) => TYPE_INFO[typeCode(type)].emoji;
export const typeInfo = (code: TypeCode) => TYPE_INFO[code];

// ---------------------------------------------------------------------------
// Callback-Daten

export type ListRef =
  | { kind: "open" }
  | { kind: "ready" }
  | { kind: "stock" }
  | { kind: "type"; code: TypeCode }
  | { kind: "none" };

export type Subject = { kind: "item"; itemId: string } | { kind: "vintage"; wineId: string; year: number | null };

export type MenuAction =
  | { op: "list"; list: ListRef; offset: number }
  | { op: "wine"; wineId: string; back: ListRef }
  | { op: "vintage"; wineId: string; year: number | null; back: ListRef }
  | { op: "item"; itemId: string; back: ListRef }
  | { op: "glasses"; itemId: string; glasses: number; back: ListRef }
  | { op: "fillPicker"; itemId: string; back: ListRef }
  | { op: "fill"; itemId: string; percent: number; back: ListRef }
  | { op: "drunkAsk"; itemId: string; back: ListRef }
  | { op: "drunk"; itemId: string; back: ListRef }
  | { op: "open"; wineId: string; year: number | null; back: ListRef }
  | { op: "openBatch"; batchId: string; back: ListRef }
  | { op: "ratePicker"; subject: Subject; personKey: string; back: ListRef }
  | { op: "rate"; subject: Subject; personKey: string; rating: number; back: ListRef };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[0-9a-f]{8}$/;

export function encodeList(list: ListRef) {
  switch (list.kind) {
    case "open":
      return "o";
    case "ready":
      return "r";
    case "stock":
      return "b";
    case "type":
      return `t${list.code}`;
    case "none":
      return "-";
  }
}

function decodeList(s: string | undefined): ListRef | null {
  if (s === "o") return { kind: "open" };
  if (s === "r") return { kind: "ready" };
  if (s === "b") return { kind: "stock" };
  if (s === "-") return { kind: "none" };
  if (s?.length === 2 && s[0] === "t" && TYPE_CODES.includes(s[1] as TypeCode)) {
    return { kind: "type", code: s[1] as TypeCode };
  }
  return null;
}

const encodeYear = (year: number | null) => (year == null ? "-" : String(year));

function decodeYear(s: string | undefined): number | null | undefined {
  if (s === "-") return null;
  const year = Number(s);
  return Number.isInteger(year) && year > 1800 && year < 2200 ? year : undefined;
}

function encodeSubject(subject: Subject) {
  return subject.kind === "item" ? `o${subject.itemId}` : `v${subject.wineId}.${encodeYear(subject.year)}`;
}

function decodeSubject(s: string | undefined): Subject | null {
  if (!s) return null;
  if (s[0] === "o" && UUID_RE.test(s.slice(1))) return { kind: "item", itemId: s.slice(1) };
  if (s[0] === "v") {
    const [wineId, yearPart] = s.slice(1).split(".");
    const year = decodeYear(yearPart);
    if (UUID_RE.test(wineId ?? "") && year !== undefined) return { kind: "vintage", wineId, year };
  }
  return null;
}

export function encodeMenu(a: MenuAction): string {
  const l = "back" in a ? encodeList(a.back) : "";
  switch (a.op) {
    case "list":
      return a.offset ? `L:${encodeList(a.list)}:${a.offset}` : `L:${encodeList(a.list)}`;
    case "wine":
      return `W:${a.wineId}:${l}`;
    case "vintage":
      return `V:${a.wineId}:${encodeYear(a.year)}:${l}`;
    case "item":
      return `O:${a.itemId}:${l}`;
    case "glasses":
      return `G:${a.itemId}:${a.glasses}:${l}`;
    case "fillPicker":
      return `F:${a.itemId}:${l}`;
    case "fill":
      return `P:${a.itemId}:${a.percent}:${l}`;
    case "drunkAsk":
      return `D:${a.itemId}:${l}`;
    case "drunk":
      return `X:${a.itemId}:${l}`;
    case "open":
      return `N:${a.wineId}:${encodeYear(a.year)}:${l}`;
    case "openBatch":
      return `Q:${a.batchId}:${l}`;
    case "ratePicker":
      return `R:${encodeSubject(a.subject)}:${a.personKey}:${l}`;
    case "rate":
      return `S:${encodeSubject(a.subject)}:${a.personKey}:${Math.round(a.rating * 2)}:${l}`;
  }
}

export function isMenuCallback(data: string | undefined) {
  return /^[LWVOGFPDXNQRS]:/.test(data ?? "");
}

export function decodeMenu(data: string | undefined): MenuAction | null {
  const [op, ...f] = (data ?? "").split(":");
  const id = f[0] ?? "";
  const back = (i: number) => (f.length === i + 1 ? decodeList(f[i]) : null);
  switch (op) {
    case "L": {
      const list = decodeList(f[0]);
      const offset = f[1] == null ? 0 : Number(f[1]);
      if (!list || f.length > 2 || !Number.isInteger(offset) || offset < 0 || offset > 10_000) return null;
      return { op: "list", list, offset };
    }
    case "W":
    case "O":
    case "F":
    case "D":
    case "X":
    case "Q": {
      const b = back(1);
      if (!UUID_RE.test(id) || !b) return null;
      if (op === "W") return { op: "wine", wineId: id, back: b };
      if (op === "O") return { op: "item", itemId: id, back: b };
      if (op === "F") return { op: "fillPicker", itemId: id, back: b };
      if (op === "D") return { op: "drunkAsk", itemId: id, back: b };
      if (op === "X") return { op: "drunk", itemId: id, back: b };
      return { op: "openBatch", batchId: id, back: b };
    }
    case "V":
    case "N": {
      const year = decodeYear(f[1]);
      const b = back(2);
      if (!UUID_RE.test(id) || year === undefined || !b) return null;
      return op === "V" ? { op: "vintage", wineId: id, year, back: b } : { op: "open", wineId: id, year, back: b };
    }
    case "G":
    case "P": {
      const n = Number(f[1]);
      const b = back(2);
      if (!UUID_RE.test(id) || !b || !Number.isInteger(n)) return null;
      if (op === "G") return n >= 1 && n <= 5 ? { op: "glasses", itemId: id, glasses: n, back: b } : null;
      return n >= 0 && n <= 100 ? { op: "fill", itemId: id, percent: n, back: b } : null;
    }
    case "R": {
      const subject = decodeSubject(f[0]);
      const b = back(2);
      if (!subject || !KEY_RE.test(f[1] ?? "") || !b) return null;
      return { op: "ratePicker", subject, personKey: f[1], back: b };
    }
    case "S": {
      const subject = decodeSubject(f[0]);
      const halves = Number(f[2]);
      const b = back(3);
      if (!subject || !KEY_RE.test(f[1] ?? "") || !b || !Number.isInteger(halves) || halves < 0 || halves > 10) {
        return null;
      }
      return { op: "rate", subject, personKey: f[1], rating: halves / 2, back: b };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Texte

/** 4.5 → „4½“, 4 → „4“. */
export function formatStars(rating: number) {
  const whole = Math.floor(rating);
  const half = rating - whole >= 0.5;
  return half ? (whole ? `${whole}½` : "½") : String(whole);
}

export function daysLabel(days: number | null) {
  if (days == null) return null;
  return days <= 0 ? "seit heute" : `seit ${days} T.`;
}

export type OpenBottleRow = {
  itemId: string;
  wineId: string;
  producer: string;
  name: string;
  year: number | null;
  type: WineType | null;
  fill: number | null;
  days: number | null;
  room: string | null;
};

/**
 * Kurze Namen für eine Liste: normalerweise „Name Jahrgang“; ist das doppelt,
 * kommt der Produzent dazu, und erst wenn es dann noch doppelt ist, der Lagerort.
 */
export function shortNames<T extends { producer: string; name: string; year: number | null; room?: string | null }>(
  rows: T[],
) {
  const base = (r: T) => [r.name, r.year ?? "o. J."].join(" ");
  const withProducer = (r: T) => `${r.producer} ${base(r)}`;
  const count = (f: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return m;
  };
  const baseCount = count(base);
  const producerCount = count(withProducer);
  return rows.map((r) => {
    if ((baseCount.get(base(r)) ?? 0) < 2) return base(r);
    const p = withProducer(r);
    return (producerCount.get(p) ?? 0) < 2 || !r.room ? p : `${p} · ${r.room}`;
  });
}

/** Weinnamen für eine Liste; bei gleichem Namen mit Produzent. */
export function uniqueNames(rows: { producer: string; name: string }[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return rows.map((r) => ((counts.get(r.name) ?? 0) > 1 ? `${r.producer} ${r.name}` : r.name));
}

export function openBottleLine(row: OpenBottleRow, name: string) {
  return [
    `${typeEmoji(row.type)} ${name}`,
    row.fill != null ? `${row.fill} %` : null,
    daysLabel(row.days),
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Knöpfe

export const btn = (text: string, action: MenuAction): TgInlineButton => ({ text, callback_data: encodeMenu(action) });

/** Eine Seite Knöpfe (je eine Zeile) und bei Bedarf „Mehr…“. */
export function pageButtons<T>(
  items: T[],
  offset: number,
  toButton: (item: T) => TgInlineButton,
  more: MenuAction | null,
): TgInlineButton[][] {
  const page = items.slice(offset, offset + PAGE_SIZE).map((item) => [toButton(item)]);
  if (more && items.length > offset + PAGE_SIZE) page.push([btn("Mehr…", more)]);
  return page;
}

export function backRow(back: ListRef): TgInlineButton[][] {
  return back.kind === "none" ? [] : [[btn("‹ Zurück", { op: "list", list: back, offset: 0 })]];
}

export const RATING_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function ratingKeyboard(subject: Subject, personKey: string, back: ListRef, cancel: MenuAction): TgInlineKeyboard {
  const buttons = RATING_STEPS.map((r) => btn(`${formatStars(r)} ★`, { op: "rate", subject, personKey, rating: r, back }));
  return { inline_keyboard: [buttons.slice(0, 5), buttons.slice(5), [btn("‹ Zurück", cancel)]] };
}

export const FILL_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90];

// ---------------------------------------------------------------------------
// Feste Menüleiste

export const MENU_TEXT = {
  open: "🍷 Offen",
  stock: "📦 Bestand",
  ready: "⏰ Trinkreif",
  newWine: "📷 Neuer Wein",
} as const;

export const MAIN_KEYBOARD: TgReplyKeyboard = {
  keyboard: [
    [{ text: MENU_TEXT.open }, { text: MENU_TEXT.stock }],
    [{ text: MENU_TEXT.ready }, { text: MENU_TEXT.newWine }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function menuKeyFor(text: string): keyof typeof MENU_TEXT | null {
  const entry = Object.entries(MENU_TEXT).find(([, label]) => label === text.trim());
  return entry ? (entry[0] as keyof typeof MENU_TEXT) : null;
}
