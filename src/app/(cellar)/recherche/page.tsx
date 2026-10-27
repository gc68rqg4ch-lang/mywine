import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { BatchResearch, type BatchCandidate } from "./batch-research";

export const metadata: Metadata = { title: "Rebsorten nachrecherchieren" };

// Jeder Schritt des Sammellaufs ist eine Server Action mit Websuche.
export const maxDuration = 300;

const scopeKey = (wineId: string, vintage: number | null) => `${wineId}:${vintage ?? "nv"}`;

export default async function ResearchPage({ searchParams }: PageProps<"/recherche">) {
  const params = await searchParams;
  const includeDrunk = params.alle === "1";
  const { supabase } = await getSession();

  const [{ data: items, error: itemsError }, { data: shares, error: sharesError }] =
    await Promise.all([
      supabase
        .from("inventory_items")
        .select("wine_id, vintage_year, status, wine:wines(name, producer)")
        .in("status", includeDrunk ? ["sealed", "open", "drunk"] : ["sealed", "open"]),
      supabase.from("wine_grape_shares").select("wine_id, vintage_year, percent, source"),
    ]);
  if (itemsError) throw itemsError;
  if (sharesError) throw sharesError;

  // Erledigt: Jahrgang hat schon Prozentangaben oder wurde manuell gepflegt.
  const done = new Set(
    (shares ?? [])
      .filter((s) => s.percent != null || s.source === "manual")
      .map((s) => scopeKey(s.wine_id, s.vintage_year)),
  );

  const candidates = new Map<string, BatchCandidate>();
  for (const item of items ?? []) {
    const key = scopeKey(item.wine_id, item.vintage_year);
    if (!item.wine || done.has(key) || candidates.has(key)) continue;
    candidates.set(key, {
      key,
      wineId: item.wine_id,
      vintageYear: item.vintage_year,
      producer: item.wine.producer,
      name: item.wine.name,
    });
  }
  const list = [...candidates.values()].sort(
    (a, b) =>
      a.producer.localeCompare(b.producer, "de-CH") ||
      a.name.localeCompare(b.name, "de-CH") ||
      (a.vintageYear ?? 0) - (b.vintageYear ?? 0),
  );

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h1 className="page-title">Rebsorten nachrecherchieren</h1>
        <p className="muted">
          Sucht für jeden Wein und Jahrgang ohne Prozentangaben die Rebsortenanteile im Web – mit derselben
          Recherche wie der Telegram-Bot. Manuell gepflegte Angaben bleiben unverändert.
        </p>
        <p className="small">
          {includeDrunk ? (
            <Link href="/recherche" className="link">
              Nur Weine im Keller (ungeöffnet und offen)
            </Link>
          ) : (
            <Link href="/recherche?alle=1" className="link">
              Auch getrunkene Weine einbeziehen
            </Link>
          )}
        </p>
      </div>
      {/* key: bei Filterwechsel frisch starten */}
      <BatchResearch key={String(includeDrunk)} candidates={list} />
    </div>
  );
}
