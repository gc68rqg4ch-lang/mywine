import type { NextRequest } from "next/server";
import { MEDIA_CACHE_CONTROL, parseMediaPath } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";

/**
 * Foto aus dem privaten Bucket, nur für Angemeldete (Storage-RLS: Mitglieder). Mit langem
 * privatem Cache – der Browser lädt dasselbe Vorschaubild nur einmal.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/media/[bucket]/[...path]">) {
  const { bucket, path } = await ctx.params;
  const target = parseMediaPath(bucket, path);
  if (!target) return new Response("Nicht gefunden", { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return new Response("Nicht angemeldet", { status: 401, headers: { "Cache-Control": "no-store" } });

  const { data, error } = await supabase.storage.from(target.bucket).download(target.path);
  if (error || !data) return new Response("Nicht gefunden", { status: 404, headers: { "Cache-Control": "no-store" } });
  // Nur Bilder als Bild ausliefern; alles andere als Download (nie als Seite im Browser).
  const image = /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(data.type);
  return new Response(data, {
    headers: {
      "Content-Type": image ? data.type : "application/octet-stream",
      ...(image ? {} : { "Content-Disposition": "attachment" }),
      "Content-Length": String(data.size),
      "Cache-Control": MEDIA_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
