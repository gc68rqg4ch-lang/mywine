import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberSession } from "@/lib/auth";
import { wineHref } from "@/lib/cellar/wine-page";
import { formatDate, todayIso, wineTitle } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import { autoEvaluate, manualScoresFromData, newTastingData, normalizeData } from "@/lib/tasting/sat";
import { SatForm } from "../../../flasche/[id]/verkostung/sat-form";

export const metadata: Metadata = { title: "Verkostung (WSET)" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WSET-Verkostung aus einem Eintrag „Verkostet“: ohne Flasche, mit encounter_id; Wein,
 * Jahrgang und Datum kommen aus dem Eintrag. ?t=<id> bearbeitet eine bestehende.
 */
export default async function EncounterTastingPage({ params, searchParams }: PageProps<"/verkostet/[id]/wset">) {
  const { id } = await params;
  const { t } = await searchParams;
  const tastingId = typeof t === "string" && UUID_RE.test(t) ? t : null;
  if (!UUID_RE.test(id)) notFound();

  const { supabase, person } = await getMemberSession();
  const { data: encounter } = await supabase
    .from("wine_encounters")
    .select("id, vintage_year, tasted_on, place:places(name), wine:wines(id, name, producer, region, country, type, grapes)")
    .eq("id", id)
    .maybeSingle();
  if (!encounter?.wine) notFound();
  const wine = encounter.wine;

  const [{ data: persons }, grapes, tasting] = await Promise.all([
    supabase.from("persons").select("id, name").order("sort_order").order("name"),
    loadGrapeShares(supabase, wine.id, encounter.vintage_year),
    tastingId
      ? supabase
          .from("wine_tastings")
          .select("id, sat, person_id")
          .eq("id", tastingId)
          .eq("encounter_id", encounter.id)
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
    initial = newTastingData(
      wine,
      encounter.vintage_year,
      grapes ? formatShares(grapes.shares) : wine.grapes.join(", "),
      encounter.tasted_on,
    );
  }
  const back = wineHref(wine.id, encounter.vintage_year, { von: "verkostet" });

  return (
    <div className="stack-lg">
      <Link href={back} className="back">
        ← {wine.producer} · {wineTitle({ name: wine.name, vintage_year: encounter.vintage_year })}
      </Link>
      <div className="stack-sm">
        <h1 className="page-title">WSET Level 3 – Systematisches Verkosten</h1>
        <p className="muted small">
          Verkostet am {formatDate(encounter.tasted_on)}
          {encounter.place ? ` · ${encounter.place.name}` : ""}
        </p>
      </div>
      <SatForm
        target={{ kind: "encounter", id: encounter.id }}
        doneHref={wineHref(wine.id, encounter.vintage_year, { von: "verkostet", verkostung: "gespeichert" })}
        cancelHref={back}
        tastingId={tasting?.id ?? null}
        initial={initial}
        initialManual={manual}
        persons={persons ?? []}
        initialPersonId={tasting ? tasting.person_id : (person?.id ?? null)}
        today={today}
        draftKey={`mywine_sat_draft_${tasting?.id ?? `e${encounter.id}`}`}
      />
    </div>
  );
}
