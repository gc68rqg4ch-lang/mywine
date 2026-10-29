import "server-only";

// Login mit Code von Antoine – serverseitig, mit dem Service-Key (login_codes hat keine Policy).
// Gesucht wird nur unter Mitgliedern (app_members) mit verknüpfter Person (persons.user_id) und
// Telegram-ID; unbekannte Adressen bekommen dieselbe Antwort. Die Sitzung entsteht ohne Mail:
// auth.admin.generateLink (magiclink) für genau dieses Mitglied, den hashed_token sofort mit
// verifyOtp im SSR-Client einlösen (setzt die Cookies). Logs ohne Codes und ohne E-Mail-Adressen.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { T } from "@/lib/bot/texts";
import { CODE_TTL_MS, MAX_ATTEMPTS, checkCode, cleanEmail, checkMessage, generateCode, hashCode, rateLimited, type CodeRow } from "./code";

type Db = SupabaseClient<Database>;

export type Member = { userId: string; email: string; telegramId: number };

/** Tabelle fehlt (Migration noch nicht eingespielt). */
const missingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (["PGRST205", "42P01"].includes(error.code ?? "") || /login_codes/.test(error.message ?? ""));

/** Mitglied mit Telegram zu dieser E-Mail (Gross/Klein egal) – sonst null. */
export async function findMember(admin: Db, email: string): Promise<Member | null> {
  const wanted = cleanEmail(email);
  if (!wanted) return null;
  const { data: persons, error } = await admin.from("persons").select("user_id, telegram_user_id").not("user_id", "is", null).not("telegram_user_id", "is", null);
  if (error) throw error;
  const ids = (persons ?? []).map((p) => p.user_id!).filter(Boolean);
  if (!ids.length) return null;
  const { data: members, error: memberError } = await admin.from("app_members").select("user_id").in("user_id", ids);
  if (memberError) throw memberError;
  for (const m of members ?? []) {
    const { data, error: userError } = await admin.auth.admin.getUserById(m.user_id);
    if (userError || !data.user?.email) continue;
    if (cleanEmail(data.user.email) === wanted) {
      const person = (persons ?? []).find((p) => p.user_id === m.user_id)!;
      return { userId: m.user_id, email: data.user.email, telegramId: Number(person.telegram_user_id) };
    }
  }
  return null;
}

export type RequestResult = "sent" | "unknown" | "limited" | "unavailable";

/**
 * Code anfordern: neuen Code erzeugen (alte ungültig), als Hash speichern, per Telegram
 * schicken. Die Seite zeigt bei sent/unknown/limited dieselbe Antwort.
 */
export async function requestLoginCode(
  admin: Db,
  email: string,
  options: { secret: string; now?: number; send: (telegramId: number, html: string) => Promise<unknown>; code?: string },
): Promise<RequestResult> {
  const now = options.now ?? Date.now();
  const member = await findMember(admin, email);
  if (!member) {
    console.warn("login code requested: unknown address");
    return "unknown";
  }
  const { data: recent, error } = await admin
    .from("login_codes")
    .select("created_at")
    .eq("user_id", member.userId)
    .gte("created_at", new Date(now - 15 * 60 * 1000).toISOString());
  if (missingTable(error)) return "unavailable";
  if (error) throw error;
  if (rateLimited((recent ?? []).map((r) => r.created_at), now)) {
    console.warn("login code requested: rate limit", member.userId);
    return "limited";
  }
  // Neuer Code macht alle bisherigen ungültig.
  const { error: invalidError } = await admin
    .from("login_codes")
    .update({ invalidated_at: new Date(now).toISOString() })
    .eq("user_id", member.userId)
    .is("used_at", null)
    .is("invalidated_at", null);
  if (invalidError) throw invalidError;
  const code = options.code ?? generateCode();
  const { error: insertError } = await admin.from("login_codes").insert({
    user_id: member.userId,
    code_hash: hashCode(options.secret, member.userId, code),
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    created_at: new Date(now).toISOString(),
  });
  if (insertError) throw insertError;
  // Direkt über die Bot-API – nicht ins Gesprächsgedächtnis (telegram_chat_messages).
  await options.send(member.telegramId, T.loginCode(code));
  return "sent";
}

export type VerifyResult = { ok: true; member: Member } | { ok: false; error: string };

/** Code prüfen: neuster gültiger Code, höchstens 5 Versuche, einmalig. */
export async function verifyLoginCode(admin: Db, email: string, code: string, options: { secret: string; now?: number }): Promise<VerifyResult> {
  const now = options.now ?? Date.now();
  const generic = { ok: false as const, error: checkMessage("none", 0) };
  const member = await findMember(admin, email);
  if (!member) return generic;
  const { data, error } = await admin
    .from("login_codes")
    .select("id, user_id, code_hash, expires_at, attempts, used_at, invalidated_at")
    .eq("user_id", member.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (missingTable(error)) return generic;
  if (error) throw error;
  const row = (data as CodeRow | null) ?? null;
  const result = checkCode(row, { userId: member.userId, code, secret: options.secret, now });
  if (result === "ok") {
    // Einmalig: nur wer used_at setzt, darf sich anmelden (zwei gleichzeitige Versuche).
    const { data: used, error: useError } = await admin.from("login_codes").update({ used_at: new Date(now).toISOString() }).eq("id", row!.id).is("used_at", null).select("id");
    if (useError) throw useError;
    return used?.length ? { ok: true, member } : generic;
  }
  if (result === "wrong") {
    const attempts = row!.attempts + 1;
    const { error: countError } = await admin
      .from("login_codes")
      .update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { invalidated_at: new Date(now).toISOString() } : {}) })
      .eq("id", row!.id);
    if (countError) throw countError;
    console.warn("login code wrong", member.userId, attempts);
    return { ok: false, error: checkMessage("wrong", MAX_ATTEMPTS - attempts) };
  }
  return { ok: false, error: checkMessage(result, 0) };
}

/** Echte Sitzung ohne Mail: Magic-Link-Token erzeugen und sofort im SSR-Client einlösen (Cookies). */
export async function startSession(admin: Db, ssr: Db, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("login code: generateLink failed", error?.message ?? "ohne Token");
    return false;
  }
  const { error: verifyError } = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verifyError) {
    console.error("login code: verifyOtp failed", verifyError.message);
    return false;
  }
  return true;
}
