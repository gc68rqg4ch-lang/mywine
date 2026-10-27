import "server-only";

import { DRINK_STATUS_LABELS, formatVintages, type DrinkStatus } from "@/lib/cellar/overview";
import { daysSince, formatBottleSize } from "@/lib/format";
import type { AdminClient } from "@/lib/supabase/admin";
import { answerCallback, editMessage, escapeHtml, sendMessage, tg } from "@/lib/telegram/api";
import { appBaseUrl } from "@/lib/telegram/config";
import type { TgCallbackQuery, TgInlineButton, TgInlineKeyboard } from "@/lib/telegram/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeProposal } from "./execute";
import {
  FILL_STEPS,
  MAIN_KEYBOARD,
  PAGE_SIZE,
  TYPE_CODES,
  backRow,
  btn,
  daysLabel,
  decodeMenu,
  formatStars,
  openBottleLine,
  pageButtons,
  ratingKeyboard,
  shortNames,
  typeCode,
  typeEmoji,
  typeInfo,
  uniqueNames,
  type ListRef,
  type MenuAction,
  type OpenBottleRow,
  type Subject,
  type TypeCode,
} from "./menu-view";
import { fillAfterGlasses, personKey } from "./proposals";
import { loadCellar } from "./tools";

type Screen = { text: string; keyboard: TgInlineKeyboard };

const e = escapeHtml;
const withStatus = (status: string | undefined, text: string) => (status ? `${e(status)}\n\n${text}` : text);
const yearLabel = (year: number | null) => (year == null ? "o. J." : String(year));
const winesLabel = (n: number) => (n === 1 ? "1 Wein" : `${n} Weine`);

function appButton(path: string): TgInlineButton[][] {
  const base = appBaseUrl();
  return base ? [[{ text: "📱 In der App öffnen", url: `${base}${path}` }]] : [];
}

// ---------------------------------------------------------------------------
// Daten

async function loadOpenBottles(db: AdminClient): Promise<OpenBottleRow[]> {
  const { data, error } = await db
    .from("cellar_overview")
    .select("inventory_item_id, wine_id, producer, name, vintage_year, type, fill_level_percent, date_opened, storage_room")
    .eq("status", "open")
    .order("date_opened", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.inventory_item_id && r.wine_id)
    .map((r) => ({
      itemId: r.inventory_item_id!,
      wineId: r.wine_id!,
      producer: r.producer ?? "",
      name: r.name ?? "",
      year: r.vintage_year,
      type: r.type,
      fill: r.fill_level_percent,
      days: daysSince(r.date_opened),
      room: r.storage_room,
    }));
}

async function loadItem(db: AdminClient, itemId: string) {
  const { data, error } = await db
    .from("cellar_overview")
    .select("inventory_item_id, wine_id, producer, name, vintage_year, type, status, fill_level_percent, date_opened, bottle_size_ml")
    .eq("inventory_item_id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ratingsLine(db: AdminClient, wineId: string, year: number | null) {
  let q = db.from("latest_wine_ratings").select("person_id, rating").eq("wine_id", wineId);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const [{ data: persons, error: pErr }, { data: ratings, error: rErr }] = await Promise.all([
    db.from("persons").select("id, name").order("sort_order"),
    q,
  ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const list = persons ?? [];
  const line = list
    .map((p) => {
      const r = ratings?.find((x) => x.person_id === p.id)?.rating;
      return `${p.name} ${r != null ? `${formatStars(r)} ★` : "–"}`;
    })
    .join(" · ");
  return { persons: list, line: list.length ? `⭐ ${line}` : "" };
}

function ratingButtons(persons: { id: string; name: string }[], subject: Subject, back: ListRef) {
  return persons.length
    ? [persons.map((p) => btn(`⭐ Bewertung ${p.name}`, { op: "ratePicker", subject, personKey: personKey(p.id), back }))]
    : [];
}

// ---------------------------------------------------------------------------
// Listen

async function openListScreen(db: AdminClient, offset: number, status?: string): Promise<Screen> {
  const rows = await loadOpenBottles(db);
  if (!rows.length) return { text: withStatus(status, "🍷 Gerade ist keine Flasche offen."), keyboard: { inline_keyboard: [] } };
  const names = shortNames(rows);
  const entries = rows.map((r, i) => ({ row: r, name: names[i] }));
  const page = entries.slice(offset, offset + PAGE_SIZE);
  const text = [
    `<b>🍷 Offene Flaschen (${rows.length})</b>`,
    ...page.map((x) => e(openBottleLine(x.row, x.name))),
  ].join("\n");
  return {
    text: withStatus(status, text),
    keyboard: {
      inline_keyboard: pageButtons(
        entries,
        offset,
        (x) => btn(`${typeEmoji(x.row.type)} ${x.name}`, { op: "item", itemId: x.row.itemId, back: { kind: "open" } }),
        { op: "list", list: { kind: "open" }, offset: offset + PAGE_SIZE },
      ),
    },
  };
}

async function stockScreen(db: AdminClient, status?: string): Promise<Screen> {
  const wines = (await loadCellar(db, null)).filter((w) => w.sealed > 0);
  const counts = new Map<TypeCode, number>();
  for (const w of wines) counts.set(typeCode(w.type), (counts.get(typeCode(w.type)) ?? 0) + w.sealed);
  const codes = TYPE_CODES.filter((c) => counts.get(c));
  const total = wines.reduce((s, w) => s + w.sealed, 0);
  const text = [
    `<b>📦 Bestand</b> · ${total} Fl. · ${winesLabel(wines.length)}`,
    ...codes.map((c) => `${typeInfo(c).emoji} ${typeInfo(c).label} · ${counts.get(c)} Fl.`),
  ].join("\n");
  const buttons = codes.map((c) =>
    btn(`${typeInfo(c).emoji} ${typeInfo(c).label} (${counts.get(c)})`, { op: "list", list: { kind: "type", code: c }, offset: 0 }),
  );
  const rows: TgInlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return { text: withStatus(status, wines.length ? text : "📦 Der Bestand ist leer."), keyboard: { inline_keyboard: rows } };
}

async function typeListScreen(db: AdminClient, code: TypeCode, offset: number, status?: string): Promise<Screen> {
  const wines = (await loadCellar(db, null)).filter((w) => w.sealed > 0 && typeCode(w.type) === code);
  const info = typeInfo(code);
  const names = uniqueNames(wines);
  const entries = wines.map((w, i) => ({ wine: w, name: names[i] }));
  const list: ListRef = { kind: "type", code };
  const lines = entries
    .slice(offset, offset + PAGE_SIZE)
    .map((x) => e(`${info.emoji} ${x.name} ${formatVintages(x.wine.vintages)} · ${x.wine.sealed} Fl.`));
  const total = wines.reduce((s, w) => s + w.sealed, 0);
  return {
    text: withStatus(status, [`<b>${info.emoji} ${info.label}</b> · ${total} Fl. · ${winesLabel(wines.length)}`, ...lines].join("\n")),
    keyboard: {
      inline_keyboard: [
        ...pageButtons(
          entries,
          offset,
          (x) => btn(`${info.emoji} ${x.name}${x.wine.vintages.length === 1 ? ` ${yearLabel(x.wine.vintages[0])}` : ""}`, {
            op: "wine",
            wineId: x.wine.wine_id,
            back: list,
          }),
          { op: "list", list, offset: offset + PAGE_SIZE },
        ),
        ...backRow({ kind: "stock" }),
      ],
    },
  };
}

const READY_ORDER: DrinkStatus[] = ["overdue", "ready", "wait"];
const READY_EMOJI: Record<DrinkStatus, string> = { overdue: "⏰", ready: "✅", wait: "⏳", unknown: "❔" };

async function readyScreen(db: AdminClient, offset: number, status?: string): Promise<Screen> {
  const wines = await loadCellar(db, null);
  const counts: Record<DrinkStatus, number> = { overdue: 0, ready: 0, wait: 0, unknown: 0 };
  const entries: { wineId: string; type: OpenBottleRow["type"]; producer: string; name: string; year: number | null; status: DrinkStatus; window: string; sealed: number }[] = [];
  for (const w of wines) {
    for (const r of w.rows) {
      if (r.sealed === 0) continue;
      counts[r.drink_status] += r.sealed;
      if (r.drink_status === "unknown") continue;
      entries.push({
        wineId: w.wine_id,
        type: w.type,
        producer: w.producer,
        name: w.name,
        year: r.vintage_year,
        status: r.drink_status,
        window: r.drink_from_year || r.drink_until_year ? `${r.drink_from_year ?? "?"}–${r.drink_until_year ?? "?"}` : "",
        sealed: r.sealed,
      });
    }
  }
  entries.sort((a, b) => READY_ORDER.indexOf(a.status) - READY_ORDER.indexOf(b.status));
  const summary = (["overdue", "ready", "wait", "unknown"] as DrinkStatus[])
    .map((s) => `${READY_EMOJI[s]} ${DRINK_STATUS_LABELS[s]} ${counts[s]}`)
    .join(" · ");
  const names = shortNames(entries);
  const lines = entries
    .slice(offset, offset + PAGE_SIZE)
    .map((x, i) => e(`${READY_EMOJI[x.status]} ${typeEmoji(x.type)} ${names[offset + i]}${x.window ? ` · ${x.window}` : ""} · ${x.sealed} Fl.`));
  const text = [
    `<b>⏰ Trinkreife</b> (Flaschen)`,
    summary,
    ...(entries.length ? ["", ...lines] : ["", "Für keinen Wein ist ein Trinkfenster erfasst."]),
  ].join("\n");
  return {
    text: withStatus(status, text),
    keyboard: {
      inline_keyboard: pageButtons(
        entries.map((x, i) => ({ ...x, label: names[i] })),
        offset,
        (x) => btn(`${READY_EMOJI[x.status]} ${x.label}`, { op: "vintage", wineId: x.wineId, year: x.year, back: { kind: "ready" } }),
        { op: "list", list: { kind: "ready" }, offset: offset + PAGE_SIZE },
      ),
    },
  };
}

function listScreen(db: AdminClient, list: ListRef, offset: number, status?: string): Promise<Screen> | Screen {
  switch (list.kind) {
    case "open":
      return openListScreen(db, offset, status);
    case "ready":
      return readyScreen(db, offset, status);
    case "stock":
      return stockScreen(db, status);
    case "type":
      return typeListScreen(db, list.code, offset, status);
    case "none":
      return { text: e(status ?? "Erledigt."), keyboard: { inline_keyboard: [] } };
  }
}

// ---------------------------------------------------------------------------
// Wein, Jahrgang, offene Flasche

async function wineScreen(db: AdminClient, wineId: string, back: ListRef): Promise<Screen> {
  const wine = (await loadCellar(db, null)).find((w) => w.wine_id === wineId);
  const years = [...new Set((wine?.rows ?? []).filter((r) => r.sealed > 0).map((r) => r.vintage_year))];
  if (!wine || years.length <= 1) return vintageScreen(db, wineId, years[0] ?? wine?.rows[0]?.vintage_year ?? null, back);
  const byYear = (y: number | null) => wine.rows.filter((r) => r.vintage_year === y).reduce((s, r) => s + r.sealed, 0);
  return {
    text: `<b>${typeEmoji(wine.type)} ${e(wine.producer)} – ${e(wine.name)}</b>\nWelcher Jahrgang?`,
    keyboard: {
      inline_keyboard: [
        ...years.map((y) => [btn(`${yearLabel(y)} · ${byYear(y)} Fl.`, { op: "vintage", wineId, year: y, back })]),
        ...backRow(back),
      ],
    },
  };
}

async function vintageScreen(db: AdminClient, wineId: string, year: number | null, back: ListRef, status?: string): Promise<Screen> {
  let q = db.from("cellar_wines").select("sealed_bottles, open_bottles, drink_status, drink_from_year, drink_until_year").eq("wine_id", wineId);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const [{ data: rows, error }, { data: wine, error: wErr }, ratings] = await Promise.all([
    q,
    db.from("wines").select("producer, name, type").eq("id", wineId).maybeSingle(),
    ratingsLine(db, wineId, year),
  ]);
  if (error) throw error;
  if (wErr) throw wErr;
  if (!wine) return { text: "Diesen Wein gibt es nicht mehr.", keyboard: { inline_keyboard: backRow(back) } };

  const sealed = (rows ?? []).reduce((s, r) => s + (r.sealed_bottles ?? 0), 0);
  const open = (rows ?? []).reduce((s, r) => s + (r.open_bottles ?? 0), 0);
  const drink = rows?.find((r) => r.drink_status && r.drink_status !== "unknown");
  const subject: Subject = { kind: "vintage", wineId, year };
  const lines = [
    `<b>${typeEmoji(wine.type)} ${e(wine.producer)} – ${e(wine.name)} ${yearLabel(year)}</b>`,
    sealed || open ? [sealed ? `${sealed} Fl. ungeöffnet` : null, open ? `${open} offen` : null].filter(Boolean).join(" · ") : "Keine Flasche mehr im Bestand.",
    drink
      ? `${READY_EMOJI[drink.drink_status as DrinkStatus] ?? ""} ${DRINK_STATUS_LABELS[drink.drink_status as DrinkStatus] ?? drink.drink_status} ${drink.drink_from_year ?? "?"}–${drink.drink_until_year ?? "?"}`
      : null,
    ratings.line ? e(ratings.line) : null,
  ].filter(Boolean);
  return {
    text: withStatus(status, lines.join("\n")),
    keyboard: {
      inline_keyboard: [
        ...(sealed ? [[btn("🍾 Öffnen", { op: "open", wineId, year, back })]] : []),
        ...ratingButtons(ratings.persons, subject, back),
        ...appButton(`/wein/${wineId}`),
        ...backRow(back),
      ],
    },
  };
}

type Item = NonNullable<Awaited<ReturnType<typeof loadItem>>>;

function itemHeader(item: Item) {
  return `<b>${typeEmoji(item.type)} ${e(item.producer ?? "")} – ${e(item.name ?? "")} ${yearLabel(item.vintage_year)}</b>`;
}

async function itemScreen(db: AdminClient, itemId: string, back: ListRef, status?: string): Promise<Screen> {
  const item = await loadItem(db, itemId);
  if (!item || !item.wine_id) return { text: withStatus(status, "Diese Flasche gibt es nicht mehr."), keyboard: { inline_keyboard: backRow(back) } };
  if (item.status === "sealed") return vintageScreen(db, item.wine_id, item.vintage_year, back, status);
  if (item.status !== "open") {
    return { text: withStatus(status, `${itemHeader(item)}\nAusgetrunken.`), keyboard: { inline_keyboard: backRow(back) } };
  }
  const ratings = await ratingsLine(db, item.wine_id, item.vintage_year);
  const size = item.bottle_size_ml && item.bottle_size_ml !== 750 ? formatBottleSize(item.bottle_size_ml) : null;
  const facts = [item.fill_level_percent != null ? `${item.fill_level_percent} %` : null, daysLabel(daysSince(item.date_opened)), size]
    .filter(Boolean)
    .join(" · ");
  const subject: Subject = { kind: "item", itemId };
  return {
    text: withStatus(status, [itemHeader(item), facts, ratings.line ? e(ratings.line) : null].filter(Boolean).join("\n")),
    keyboard: {
      inline_keyboard: [
        [btn("🥃 1 Glas", { op: "glasses", itemId, glasses: 1, back }), btn("🥃🥃 2 Gläser", { op: "glasses", itemId, glasses: 2, back })],
        [btn("Füllstand %", { op: "fillPicker", itemId, back }), btn("✅ Ausgetrunken", { op: "drunkAsk", itemId, back })],
        ...ratingButtons(ratings.persons, subject, back),
        ...appButton(`/flasche/${itemId}`),
        ...backRow(back),
      ],
    },
  };
}

async function fillPickerScreen(db: AdminClient, itemId: string, back: ListRef): Promise<Screen> {
  const item = await loadItem(db, itemId);
  if (item?.status !== "open") return itemScreen(db, itemId, back);
  const buttons = FILL_STEPS.map((p) => btn(`${p} %`, { op: "fill", itemId, percent: p, back }));
  return {
    text: `${itemHeader(item)}\nJetzt ${item.fill_level_percent ?? "?"} % – neuer Füllstand?`,
    keyboard: {
      inline_keyboard: [buttons.slice(0, 3), buttons.slice(3, 6), buttons.slice(6), [btn("‹ Zurück", { op: "item", itemId, back })]],
    },
  };
}

async function drunkAskScreen(db: AdminClient, itemId: string, back: ListRef, note?: string): Promise<Screen> {
  const item = await loadItem(db, itemId);
  if (item?.status !== "open") return itemScreen(db, itemId, back);
  return {
    text: [itemHeader(item), note ? e(note) : null, "Als ausgetrunken markieren?"].filter(Boolean).join("\n"),
    keyboard: {
      inline_keyboard: [[btn("✅ Ja, ausgetrunken", { op: "drunk", itemId, back }), btn("‹ Zurück", { op: "item", itemId, back })]],
    },
  };
}

function subjectAction(subject: Subject, back: ListRef): MenuAction {
  return subject.kind === "item"
    ? { op: "item", itemId: subject.itemId, back }
    : { op: "vintage", wineId: subject.wineId, year: subject.year, back };
}

function subjectScreen(db: AdminClient, subject: Subject, back: ListRef, status?: string) {
  return subject.kind === "item"
    ? itemScreen(db, subject.itemId, back, status)
    : vintageScreen(db, subject.wineId, subject.year, back, status);
}

async function ratePickerScreen(db: AdminClient, subject: Subject, key: string, back: ListRef): Promise<Screen> {
  const { data: persons } = await db.from("persons").select("id, name");
  const person = persons?.find((p) => p.id.startsWith(key));
  const base = await subjectScreen(db, subject, back);
  const header = base.text.split("\n").find((l) => l.startsWith("<b>")) ?? "";
  return {
    text: `${header}\n⭐ Bewertung von ${e(person?.name ?? "?")}?`,
    keyboard: ratingKeyboard(subject, key, back, subjectAction(subject, back)),
  };
}

// ---------------------------------------------------------------------------
// Öffnen

async function sealedBatches(db: AdminClient, wineId: string, year: number | null) {
  let q = db
    .from("inventory_items")
    .select("id, quantity, bottle_size_ml, storage_room, storage_house, purchased_at")
    .eq("wine_id", wineId)
    .eq("status", "sealed")
    .gt("quantity", 0);
  q = year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);
  const { data, error } = await q.order("purchased_at", { ascending: true, nullsFirst: true });
  if (error) throw error;
  // Pro Lagerort und Grösse die älteste Charge zuerst.
  const groups = new Map<string, { batchId: string; label: string; bottles: number }>();
  for (const b of data ?? []) {
    const size = b.bottle_size_ml ?? 750;
    const key = `${b.storage_house ?? ""}|${b.storage_room ?? ""}|${size}`;
    const g = groups.get(key);
    if (g) g.bottles += b.quantity;
    else {
      groups.set(key, {
        batchId: b.id,
        label: [b.storage_room ?? "ohne Lagerort", size !== 750 ? formatBottleSize(size) : null].filter(Boolean).join(" · "),
        bottles: b.quantity,
      });
    }
  }
  return [...groups.values()];
}

async function openBatch(db: AdminClient, batchId: string, back: ListRef): Promise<Screen> {
  const result = await executeProposal(db, { kind: "open", itemId: batchId });
  if (!result.ok || !result.itemId) return { text: e(result.text), keyboard: { inline_keyboard: backRow(back) } };
  return itemScreen(db, result.itemId, back, "✅ Geöffnet.");
}

// ---------------------------------------------------------------------------
// Einstieg

/** Buttons beanspruchen (vor Aktionen): ein zweiter, gleichzeitiger Klick läuft so nicht doppelt. */
async function claim(chatId: number, messageId: number) {
  return tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).then(
    () => true,
    () => false,
  );
}

const CLAIMED_OPS = new Set<MenuAction["op"]>(["glasses", "drunk", "open", "openBatch"]);

/** Nächstes Menü zu einem Knopf (führt Aktionen aus); exportiert für Tests. */
export async function screenFor(db: AdminClient, a: MenuAction): Promise<{ screen: Screen; toast?: string }> {
  switch (a.op) {
    case "list":
      return { screen: await listScreen(db, a.list, a.offset) };
    case "wine":
      return { screen: await wineScreen(db, a.wineId, a.back) };
    case "vintage":
      return { screen: await vintageScreen(db, a.wineId, a.year, a.back) };
    case "item":
      return { screen: await itemScreen(db, a.itemId, a.back) };
    case "fillPicker":
      return { screen: await fillPickerScreen(db, a.itemId, a.back) };
    case "drunkAsk":
      return { screen: await drunkAskScreen(db, a.itemId, a.back) };
    case "ratePicker":
      return { screen: await ratePickerScreen(db, a.subject, a.personKey, a.back) };
    case "glasses":
    case "fill": {
      const item = await loadItem(db, a.itemId);
      if (item?.status !== "open") return { screen: await itemScreen(db, a.itemId, a.back, "Diese Flasche ist nicht mehr offen.") };
      const before = item.fill_level_percent ?? 100;
      const next = a.op === "fill" ? a.percent : fillAfterGlasses(before, a.glasses, item.bottle_size_ml ?? 750);
      const what = a.op === "glasses" ? (a.glasses === 1 ? "1 Glas" : `${a.glasses} Gläser`) : "Füllstand";
      if (next === 0) {
        return { screen: await drunkAskScreen(db, a.itemId, a.back, a.op === "glasses" ? `Nach ${a.glasses === 1 ? "1 Glas" : `${a.glasses} Gläsern`} ist die Flasche leer.` : undefined) };
      }
      await executeProposal(db, { kind: "fill", itemId: a.itemId, percent: next });
      return { screen: await itemScreen(db, a.itemId, a.back, `✅ ${what}: ${before} % → ${next} %`), toast: `${next} %` };
    }
    case "drunk": {
      const result = await executeProposal(db, { kind: "drunk", itemId: a.itemId });
      return { screen: await listScreen(db, a.back, 0, `${result.ok ? "✅" : "⚠️"} ${result.text}`) };
    }
    case "open": {
      const batches = await sealedBatches(db, a.wineId, a.year);
      if (!batches.length) return { screen: await vintageScreen(db, a.wineId, a.year, a.back, "Keine ungeöffnete Flasche mehr da.") };
      if (batches.length === 1) return { screen: await openBatch(db, batches[0].batchId, a.back) };
      const base = await vintageScreen(db, a.wineId, a.year, a.back);
      const header = base.text.split("\n").find((l) => l.startsWith("<b>")) ?? "";
      return {
        screen: {
          text: `${header}\n🍾 Aus welchem Lagerort?`,
          keyboard: {
            inline_keyboard: [
              ...batches.map((b) => [btn(`${b.label} (${b.bottles})`, { op: "openBatch", batchId: b.batchId, back: a.back })]),
              [btn("‹ Zurück", { op: "vintage", wineId: a.wineId, year: a.year, back: a.back })],
            ],
          },
        },
      };
    }
    case "openBatch":
      return { screen: await openBatch(db, a.batchId, a.back) };
    case "rate": {
      const wine =
        a.subject.kind === "vintage"
          ? { wineId: a.subject.wineId, year: a.subject.year }
          : await loadItem(db, a.subject.itemId).then((i) => (i?.wine_id ? { wineId: i.wine_id, year: i.vintage_year } : null));
      if (!wine) return { screen: await subjectScreen(db, a.subject, a.back, "Wein nicht gefunden.") };
      const result = await executeProposal(db, {
        kind: "rate",
        wineId: wine.wineId,
        vintageYear: wine.year,
        personKey: a.personKey,
        rating: a.rating,
      });
      const { data: persons } = await db.from("persons").select("id, name");
      const name = persons?.find((p) => p.id.startsWith(a.personKey))?.name ?? "";
      const status = result.ok ? `⭐ Gespeichert: ${name} ${formatStars(a.rating)} ★` : `⚠️ ${result.text}`;
      return { screen: await subjectScreen(db, a.subject, a.back, status), toast: result.ok ? status : undefined };
    }
  }
}

/** Antippen eines Menü-Knopfs: die Nachricht wird zum nächsten Menü. */
export async function handleMenuCallback(cb: TgCallbackQuery) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const action = decodeMenu(cb.data);
  if (chatId == null || messageId == null || !action) {
    await answerCallback(cb.id, "Dieser Knopf ist nicht mehr gültig.");
    return;
  }
  if (CLAIMED_OPS.has(action.op) && !(await claim(chatId, messageId))) {
    await answerCallback(cb.id, "Schon erledigt.");
    return;
  }
  const db = createAdminClient();
  try {
    const { screen, toast } = await screenFor(db, action);
    await answerCallback(cb.id, toast);
    await editMessage(chatId, messageId, screen.text, screen.keyboard);
  } catch (error) {
    console.error("menu callback failed", cb.data, error);
    await answerCallback(cb.id, "Das hat nicht geklappt.");
    const back = "back" in action ? action.back : { kind: "none" as const };
    await editMessage(chatId, messageId, "❌ Das hat nicht geklappt – bitte nochmals versuchen.", {
      inline_keyboard: backRow(back),
    }).catch(() => undefined);
  }
}

export const NEW_WINE_TEXT =
  "📷 Schick mir <b>Vorder- und Rückseite</b> der Flasche als Album (beide Fotos zusammen auswählen).";

/** Tippen auf die feste Menüleiste: neues Menü als Nachricht. */
export async function sendMainMenu(chatId: number, key: "open" | "stock" | "ready" | "newWine") {
  if (key === "newWine") {
    await sendMessage(chatId, NEW_WINE_TEXT, MAIN_KEYBOARD);
    return;
  }
  const db = createAdminClient();
  const screen = key === "open" ? await openListScreen(db, 0) : key === "stock" ? await stockScreen(db) : await readyScreen(db, 0);
  await sendMessage(chatId, screen.text, screen.keyboard.inline_keyboard.length ? screen.keyboard : MAIN_KEYBOARD);
}

export type WineRef = { itemId: string } | { wineId: string; year: number | null };

/** Knöpfe zu den Weinen einer Chat-Antwort (max. 8, sonst „Mehr…“). */
export async function wineButtons(db: AdminClient, refs: WineRef[]): Promise<TgInlineKeyboard | null> {
  const unique = refs.filter(
    (r, i) => refs.findIndex((x) => JSON.stringify(x) === JSON.stringify(r)) === i,
  );
  if (!unique.length) return null;
  const itemIds = unique.flatMap((r) => ("itemId" in r ? [r.itemId] : []));
  const wineIds = unique.flatMap((r) => ("wineId" in r ? [r.wineId] : []));
  const [items, wines] = await Promise.all([
    itemIds.length
      ? db.from("cellar_overview").select("inventory_item_id, producer, name, vintage_year, type, storage_room").in("inventory_item_id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    wineIds.length ? db.from("wines").select("id, producer, name, type").in("id", wineIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (items.error) throw items.error;
  if (wines.error) throw wines.error;

  const entries = unique.flatMap((r) => {
    if ("itemId" in r) {
      const i = items.data?.find((x) => x.inventory_item_id === r.itemId);
      return i
        ? [{ type: i.type, producer: i.producer ?? "", name: i.name ?? "", year: i.vintage_year, room: i.storage_room, action: { op: "item", itemId: r.itemId, back: { kind: "none" } } as MenuAction }]
        : [];
    }
    const w = wines.data?.find((x) => x.id === r.wineId);
    return w
      ? [{ type: w.type, producer: w.producer, name: w.name, year: r.year, room: null, action: { op: "vintage", wineId: r.wineId, year: r.year, back: { kind: "none" } } as MenuAction }]
      : [];
  });
  if (!entries.length) return null;
  const names = shortNames(entries);
  const allOpen = entries.every((x) => x.action.op === "item");
  const rows = entries.slice(0, PAGE_SIZE).map((x, i) => [btn(`${typeEmoji(x.type)} ${names[i]}`, x.action)]);
  if (entries.length > PAGE_SIZE) {
    rows.push([btn("Mehr…", { op: "list", list: allOpen ? { kind: "open" } : { kind: "stock" }, offset: allOpen ? PAGE_SIZE : 0 })]);
  }
  return { inline_keyboard: rows };
}
