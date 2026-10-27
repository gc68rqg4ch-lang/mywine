import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Liefert den angemeldeten User samt Mitgliedschaft in app_members.
 * Ohne Session wird auf /login umgeleitet. Pro Request gecacht.
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/login");
  }

  const [{ data: member }, { data: person }] = await Promise.all([
    supabase.from("app_members").select("user_id").eq("user_id", claims.sub).maybeSingle(),
    // Die angemeldete Person (persons.user_id) – Standard für Bewertungen und Verkostungen.
    supabase.from("persons").select("id, name").eq("user_id", claims.sub).maybeSingle(),
  ]);

  return {
    supabase,
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    isMember: Boolean(member),
    person: person ?? null,
  };
});

/**
 * Für Seiten im Keller: wie getSession, aber wer angemeldet ist und nicht in
 * app_members steht, landet auf „Kein Zugang“ (statt einer leeren Seite).
 */
export async function getMemberSession() {
  const session = await getSession();
  if (!session.isMember) redirect("/kein-zugang");
  return session;
}

/** Für Server Actions: wirft, wenn kein Mitglied angemeldet ist. */
export async function requireMember() {
  const session = await getSession();
  if (!session.isMember) {
    throw new Error("Kein Zugriff auf diesen Weinkeller.");
  }
  return session;
}
