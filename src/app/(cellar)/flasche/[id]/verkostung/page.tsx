import type { Metadata } from "next";
import { FallbackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { getMemberSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { todayIso, wineTitle } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import { autoEvaluate, manualScoresFromData, newTastingData, normalizeData } from "@/lib/tasting/sat";
import { SatForm } from "./sat-form";

export const metadata: Metadata = { title: "Verkostung (WSET)" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TastingPage({ params, searchParams }: PageProps<"/flasche/[id]/verkostung">) {
  const { id } = await params;
  const { t } = await searchParams;
  const tastingId = typeof t === "string" && UUID_RE.test(t) ? t : null;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, person } = await getMemberSession();
  const { data: item } = await supabase
    .from("inventory_items")
    .select("id, vintage_year, wine:wines(id, name, producer, region, country, type, grapes)")
    .eq("id", id)
    .maybeSingle();
  if (!item?.wine) notFound();
  const wine = item.wine;

  const [{ data: persons }, grapes, tasting] = await Promise.all([
    supabase.from("persons").select("id, name, user_id").order("sort_order").order("name"),
    loadGrapeShares(supabase, wine.id, item.vintage_year),
    tastingId
      ? supabase
          .from("wine_tastings")
          .select("id, sat, person_id, wine_id")
          .eq("id", tastingId)
          .eq("wine_id", wine.id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (tastingId && !tasting) notFound();

  const today = todayIso();
  let initial;
  let manual: string[] = [];
  if (tasting) {
    const loaded = normalizeData(tasting.sat, today);
    const manualSet = manualScoresFromData(loaded);
    manual = [...manualSet];
    initial = autoEvaluate(loaded, manualSet).data;
  } else {
    // Neue Verkostung: Wein und Jahrgang aus der Flasche vorausfüllen.
    initial = newTastingData(
      wine,
      item.vintage_year,
      grapes ? formatShares(grapes.shares) : wine.grapes.join(", "),
      today,
    );
  }

  // Neue Verkostungen sind für die angemeldete Person vorausgewählt (andere wählbar).
  const ownPerson = person?.id ?? null;

  return (
    <div className="stack-lg">
      <FallbackLink href={wineHref(wine.id, item.vintage_year)}>
        ← {wine.producer ? `${wine.producer} · ` : ""}{wineTitle({ name: wine.name, vintage_year: item.vintage_year })}
      </FallbackLink>
      <div className="stack-sm">
        <h1 className="page-title">WSET Level 3 – Systematisches Verkosten</h1>
        <p className="muted small">
          Vollständige SAT-Struktur für Stillwein, Schaumwein sowie gespritete und süsse Weine.
        </p>
      </div>
      <SatForm
        target={{ kind: "item", id: item.id }}
        doneHref={`/flasche/${item.id}?verkostung=gespeichert`}
        cancelHref={`/flasche/${item.id}`}
        tastingId={tasting?.id ?? null}
        initial={initial}
        initialManual={manual}
        persons={(persons ?? []).map(({ id, name }) => ({ id, name }))}
        initialPersonId={tasting ? tasting.person_id : ownPerson}
        today={today}
        draftKey={`mywine_sat_draft_${tasting?.id ?? item.id}`}
      />
    </div>
  );
}
