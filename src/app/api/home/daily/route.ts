import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { refreshAvatarIfStale } from "@/lib/home/avatar";
import { generateAllDailyNotes } from "@/lib/home/daily";
import { DAILY_SECRET_HEADER, secretMatches, workerSecretFrom } from "@/lib/secret";
import { createAdminClient } from "@/lib/supabase/admin";

// Antoines Tagestexte für die Startseite: jeden Morgen um 05:00 (Europe/Zurich) von pg_cron über
// pg_net aufgerufen (POST mit Header x-daily-notes-secret bzw. Authorization: Bearer
// <DAILY_NOTES_SECRET>). Schreibt für jede Person mit Login den Text des Tages (schon erledigte
// bleiben), holt Antoines Foto, wenn es älter als eine Woche ist, und räumt Texte älter als 60
// Tage weg.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.DAILY_NOTES_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "DAILY_NOTES_SECRET ist nicht gesetzt." }, { status: 503 });
  if (!secretMatches(workerSecretFrom(request.headers, DAILY_SECRET_HEADER), expected)) return NextResponse.json({ ok: false }, { status: 401 });

  const db = createAdminClient();
  const [notes, avatar] = await Promise.all([generateAllDailyNotes(db), refreshAvatarIfStale(db)]);
  const { error: cleanupError } = await db.rpc("cleanup_daily_notes");
  if (cleanupError) console.warn("daily notes: cleanup failed", cleanupError.message);
  try {
    revalidatePath("/");
  } catch {
    // ausserhalb von Next (Tests)
  }
  return NextResponse.json({ ok: true, notes, avatar });
}
