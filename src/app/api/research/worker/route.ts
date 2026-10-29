import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { processQueue } from "@/lib/research/jobs";
import { tickHeldPriceQuestions } from "@/lib/research/price";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretMatches, workerSecretFrom } from "@/lib/secret";

// Worker der Recherche im Hintergrund: jede Minute von pg_cron über pg_net aufgerufen (POST mit
// Header x-research-worker-secret bzw. Authorization: Bearer <RESEARCH_WORKER_SECRET>). Arbeitet
// Aufträge nacheinander ab, solange sicher Zeit bleibt; ein zweiter gleichzeitiger Aufruf macht
// nichts (Sperre in der DB).
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.RESEARCH_WORKER_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: "RESEARCH_WORKER_SECRET ist nicht gesetzt." }, { status: 503 });
  if (!secretMatches(workerSecretFrom(request.headers), expected)) return NextResponse.json({ ok: false }, { status: 401 });

  const db = createAdminClient();
  // Zurückgehaltene Preis-Rückfragen: stellen, sobald frei, bzw. nach 24 Std. verfallen lassen.
  await tickHeldPriceQuestions(db);
  const result = await processQueue(db);
  if (result.status === "ok" && result.processed) {
    try {
      revalidatePath("/", "layout");
    } catch {
      // ausserhalb von Next (Tests)
    }
  }
  return NextResponse.json({ ok: true, ...result });
}
