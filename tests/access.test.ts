// Bot-Zugang: nur bekannte Telegram-IDs (persons.telegram_user_id bzw. die Owner-ID), Unbekannte
// erfahren nur ihre ID, in Gruppen gar nichts; /id und /start. Telegram/Supabase per fetch-Stub.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleUpdate } from "@/lib/ingest/bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveActor } from "@/lib/telegram/actor";

const MICHEL = { id: "86c222d0-3a8c-4d5f-9564-f5654769ecd6", name: "Michel", sort_order: 0, telegram_user_id: null };
const SARA = { id: "c7690541-4e68-4051-aa8f-6a2920fea55b", name: "Sara", sort_order: 1, telegram_user_id: 222 };
const calls: { method: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.host === "api.telegram.org") {
    calls.push({ method: url.pathname.split("/").pop()!, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }
  if (url.pathname.endsWith("/rest/v1/persons")) {
    const tg = url.searchParams.get("telegram_user_id");
    const rows = tg ? [MICHEL, SARA].filter((p) => `eq.${p.telegram_user_id}` === tg) : [MICHEL, SARA];
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const msg = (from: number, text: string, type = "private") => ({
  update_id: 1, message: { message_id: 5, from: { id: from, is_bot: false, first_name: "x" }, chat: { id: from, type }, date: 0, text },
});

test("resolveActor: eigene ID, Owner-ID als Michel, sonst niemand", async () => {
  const db = createAdminClient();
  assert.deepEqual(await resolveActor(db, 222), { telegramUserId: 222, personId: SARA.id, name: "Sara" });
  assert.deepEqual(await resolveActor(db, 111), { telegramUserId: 111, personId: MICHEL.id, name: "Michel" }, "Owner-ID → Michel");
  assert.equal(await resolveActor(db, 999), null);
});

test("Unbekannte: nur die eigene ID, in Gruppen nichts, Knöpfe abgewiesen", async () => {
  calls.length = 0;
  await handleUpdate(msg(999, "Hallo, zeig mir den Bestand") as never);
  assert.deepEqual(calls.map((c) => [c.method, c.body.text]), [["sendMessage", "Ich kenne dich noch nicht – deine Telegram-ID ist <code>999</code>."]]);
  calls.length = 0;
  await handleUpdate(msg(999, "hi", "group") as never);
  assert.equal(calls.length, 0, "in Gruppen gar nichts");
  await handleUpdate({ update_id: 2, callback_query: { id: "cb", from: { id: 999, is_bot: false, first_name: "x" }, data: "L:o" } } as never);
  assert.deepEqual(calls.map((c) => [c.method, c.body.text]), [["answerCallbackQuery", "Ich kenne dich noch nicht – deine Telegram-ID ist 999."]]);
});

test("/id nennt ID und Person, /start begrüsst mit Menüleiste", async () => {
  calls.length = 0;
  await handleUpdate(msg(222, "/id") as never);
  assert.match(String(calls[0].body.text), /Deine Telegram-ID ist <code>222<\/code> \(Sara\)/);
  calls.length = 0;
  await handleUpdate(msg(111, "/start") as never);
  assert.match(String(calls[0].body.text), /^Hallo Michel!/);
  assert.ok((calls[0].body.reply_markup as { keyboard?: unknown }).keyboard, "Menüleiste");
});
