import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handleUpdate } from "@/lib/ingest/bot";
import { telegramConfig } from "@/lib/telegram/config";
import type { TgUpdate } from "@/lib/telegram/types";

// Erkennung inkl. Websuche läuft nach der Antwort per after() weiter.
export const maxDuration = 300;

function secretMatches(received: string | null, expected: string) {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook für Telegram. */
export async function POST(request: NextRequest) {
  const { webhookSecret } = telegramConfig();
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  if (update) {
    try {
      await handleUpdate(update);
    } catch (error) {
      // Immer 200 antworten: sonst wiederholt Telegram dasselbe Update endlos.
      console.error("telegram update failed", update.update_id, error);
    }
  }
  return NextResponse.json({ ok: true });
}
