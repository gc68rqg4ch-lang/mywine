"use server";

import { headers } from "next/headers";
import { safeNextPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

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
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
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
    console.error("signInWithOtp failed", error);
    return {
      error:
        error.status === 429
          ? "Zu viele Anfragen – bitte kurz warten und erneut versuchen."
          : "Der Login-Link konnte nicht versendet werden.",
    };
  }

  return { sentTo: email };
}
