"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CODE_SENT_TEXT, cleanEmail, loginCodeSecret, normalizeCode } from "@/lib/login/code";
import { requestLoginCode, startSession, verifyLoginCode } from "@/lib/login/service";
import { safeNextPath } from "@/lib/safe-next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/telegram/api";

export type LoginState = { error?: string; sentTo?: string } | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = cleanEmail(String(formData.get("email") ?? ""));
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!EMAIL_RE.test(email)) {
    return { error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  }

  const supabase = await createClient();
  const redirectTo = new URL("/auth/confirm", await siteUrl());
  redirectTo.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo.toString() },
  });

  if (error) {
    // Ohne E-Mail-Adresse im Log.
    console.error("signInWithOtp failed", error.status, error.code ?? error.message);
    return {
      error:
        error.status === 429
          ? "Zu viele Anfragen – bitte kurz warten und erneut versuchen."
          : "Der Login-Link konnte nicht versendet werden.",
    };
  }

  return { sentTo: email };
}

export type CodeRequestState = { ok: true; message: string } | { ok: false; error: string };

/**
 * Code per Telegram anfordern. Antwort immer gleich (bekannt/unbekannt/zu oft), damit nicht
 * herauskommt, welche Adressen es gibt. Ohne Secret bzw. ohne Migration: Hinweis auf den Link.
 */
export async function requestCodeAction(email: string): Promise<CodeRequestState> {
  const address = cleanEmail(email);
  if (!EMAIL_RE.test(address)) return { ok: false, error: "Bitte eine gültige E-Mail-Adresse eingeben." };
  const secret = loginCodeSecret();
  if (!secret) return { ok: false, error: "Der Code per Telegram ist gerade nicht verfügbar – bitte den Link per E-Mail nutzen." };
  try {
    const result = await requestLoginCode(createAdminClient(), address, { secret, send: (chatId, html) => sendMessage(chatId, html) });
    if (result === "unavailable") return { ok: false, error: "Der Code per Telegram ist gerade nicht verfügbar – bitte den Link per E-Mail nutzen." };
    return { ok: true, message: CODE_SENT_TEXT };
  } catch (error) {
    console.error("login code request failed", error instanceof Error ? error.message : "unbekannt");
    // Auch bei Fehlern (z. B. Telegram nicht erreichbar) gleiche Antwort – nichts verraten.
    return { ok: true, message: CODE_SENT_TEXT };
  }
}

export type CodeVerifyState = { error: string } | undefined;

/** Code prüfen; richtig → Sitzung (Cookies) und weiter wie beim Link (next). */
export async function verifyCodeAction(email: string, code: string, nextPath: string): Promise<CodeVerifyState> {
  const address = cleanEmail(email);
  const digits = normalizeCode(String(code ?? ""));
  if (!digits) return { error: "Bitte die 6 Ziffern aus der Nachricht von Antoine eingeben." };
  const secret = loginCodeSecret();
  if (!secret || !EMAIL_RE.test(address)) return { error: "Der Code ist nicht mehr gültig – bitte einen neuen Code senden." };
  let ok = false;
  try {
    const admin = createAdminClient();
    const result = await verifyLoginCode(admin, address, digits, { secret });
    if (!result.ok) return { error: result.error };
    ok = await startSession(admin, await createClient(), result.member.email);
  } catch (error) {
    console.error("login code verify failed", error instanceof Error ? error.message : "unbekannt");
  }
  if (!ok) return { error: "Die Anmeldung hat nicht geklappt – bitte nochmals versuchen oder den Link per E-Mail nutzen." };
  redirect(safeNextPath(nextPath));
}
