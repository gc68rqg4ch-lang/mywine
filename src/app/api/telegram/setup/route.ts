import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { tg } from "@/lib/telegram/api";
import { telegramConfig } from "@/lib/telegram/config";

/**
 * Registriert den Webhook bei Telegram. Nur für angemeldete Mitglieder:
 * im Browser auf der Produktions-URL /api/telegram/setup aufrufen.
 */
export async function GET(request: NextRequest) {
  const { isMember } = await getSession(); // leitet ohne Login auf /login um
  if (!isMember) return NextResponse.json({ ok: false, error: "Kein Zugriff." }, { status: 403 });

  const { webhookSecret } = telegramConfig();
  const url = new URL("/api/telegram", request.nextUrl.origin).toString();
  if (!url.startsWith("https://")) {
    return NextResponse.json(
      { ok: false, error: "Telegram verlangt HTTPS – auf der Vercel-URL aufrufen.", url },
      { status: 400 },
    );
  }

  try {
    await tg("setWebhook", {
      url,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      max_connections: 10,
    });
    const info = await tg<Record<string, unknown>>("getWebhookInfo");
    const me = await tg<{ username?: string }>("getMe");
    return NextResponse.json({
      ok: true,
      bot: me.username ? `@${me.username}` : null,
      webhook: {
        url: info.url,
        pending_update_count: info.pending_update_count,
        last_error_message: info.last_error_message ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
