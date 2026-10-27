import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSED_ON = ["geoeffnet", "ausgetrunken", "verkostung", "von"] as const;

/**
 * Eine Flasche hat keine eigene Seite mehr: weiter zur Weinseite mit ihrem Jahrgang
 * (Links aus dem Telegram-Bot und alte Lesezeichen funktionieren so weiter).
 */
export default async function BottleRedirect({ params, searchParams }: PageProps<"/flasche/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase } = await getSession();
  const { data: item } = await supabase.from("inventory_items").select("wine_id, vintage_year").eq("id", id).maybeSingle();
  if (!item) notFound();
  const query = await searchParams;
  const extra = Object.fromEntries(
    PASSED_ON.flatMap((k) => (typeof query[k] === "string" ? [[k, query[k] as string]] : [])),
  );
  redirect(wineHref(item.wine_id, item.vintage_year, extra));
}
