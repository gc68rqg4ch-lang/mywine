"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { LOCATION_COOKIE } from "@/lib/location";

/** Lagerort-Auswahl speichern („“ = Alle). Bleibt ein Jahr im Cookie. */
export async function setLocation(key: string) {
  const { isMember } = await getSession();
  if (!isMember) return;
  const store = await cookies();
  if (!key || key.length > 200) {
    store.delete(LOCATION_COOKIE);
  } else {
    store.set(LOCATION_COOKIE, key, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }
  revalidatePath("/", "layout");
}
