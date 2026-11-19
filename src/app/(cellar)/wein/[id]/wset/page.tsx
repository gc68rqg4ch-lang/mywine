import type { Metadata } from "next";
import Link from "next/link";
import { FallbackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { getMemberSession } from "@/lib/auth";
import { parseVintageParam, wineHref } from "@/lib/cellar/wine-page";
import { formatDate, todayIso, wineTitle } from "@/lib/format";
import { formatShares } from "@/lib/grapes/shares";
import { loadGrapeShares } from "@/lib/grapes/store";
import { encounterWsetHref, preselectedPerson, wineWsetHref } from "@/lib/tasting/links";
import { autoEvaluate, manualScoresFromData, newTastingData, normalizeData } from "@/lib/tasting/sat";
import { SatForm } from "../../../flasche/[id]/verkostung/sat-form";

export const metadata: Metadata = { title: "WSET-Bewertung" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WSET-Bewertung für Wein + Jahrgang ohne Flasche (z. B. nur verkostet, nichts im Bestand).
 * Gibt es Verkostungen dieses Jahrgangs: zuerst die Auswahl (Datum + Ort) – die Bewertung
 * hängt dann am Eintrag; „ohne Verkostung“ (frei=1) speichert ohne Eintrag, Datum heute.
 * ?t=<id> bearbeitet eine bestehende Bewertung ohne Flasche und Eintrag.
 */
export default async function WineTastingPage({ params, searchParams }: PageProps<"/wein/[id]/wset">) {
  const { id } = await params;
  const query = await searchParams;
  const tastingId = typeof query.t === "string" && UUID_RE.test(query.t) ? query.t : null;
  const year = parseVintageParam(query.jahrgang);
  if (!UUID_RE.test(id) || year === undefined) notFound();

  const { supabase, person } = await getMemberSession();
  const { data: wine } = await supabase
    .from("wines")
    .select("id, name, producer, region, country, type, grapes")
    .eq("id", id)
    .maybeSingle();
  if (!wine || wine.type === "spirit") notFound();

  const sameYear = <Q extends { eq: (c: "vintage_year", v: number) => Q; is: (c: "vintage_year", v: null) => Q }>(q: Q) =>
    year == null ? q.is("vintage_year", null) : q.eq("vintage_year", year);

  const [{ data: persons }, { data: encounters }, grapes, tasting] = await Promise.all([
    supabase.from("persons").select("id, name").order("sort_order").order("name"),
    sameYear(supabase.from("wine_encounters").select("id, tasted_on, vintage_year, place:places(name)").eq("wine_id", wine.id))
      .order("tasted_on", { ascending: false })
      .order("created_at", { ascending: false }),
    loadGrapeShares(supabase, wine.id, year),
    tastingId
      ? supabase
          .from("wine_tastings")
          .select("id, sat, person_id")
          .eq("id", tastingId)
          .eq("wine_id", wine.id)
          .is("inventory_item_id", null)
          .is("encounter_id", null)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (tastingId && !tasting) notFound();

  const back = wineHref(wine.id, year);
  const title = `${wine.producer ? `${wine.producer} · ` : ""}${wineTitle({ name: wine.name, vintage_year: year })}`;
  const personParam = typeof query.person === "string" ? query.person : null;

  // Nachträglich zuordnen: welche Verkostung? (bzw. ohne)
  if (!tasting && query.frei !== "1" && (encounters ?? []).length > 0) {
    return (
      <div className="stack-lg">
        <FallbackLink href={back}>← {title}</FallbackLink>
        <div className="stack-sm">
          <h1 className="page-title">WSET-Bewertung</h1>
          <p className="muted small">Zu welcher Verkostung gehört die Bewertung?</p>
        </div>
        <ul className="tasting-list">
          {(encounters ?? []).map((e) => (
            <li key={e.id}>
              <Link href={encounterWsetHref(e.id, { personId: personParam })}>
                <span className="tasting-result">{formatDate(e.tasted_on)}</span>
                <span className="tasting-meta">{e.place?.name ?? "ohne Ort"}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href={wineWsetHref(wine.id, year, { free: true })}>
              <span className="tasting-result">Ohne Verkostung</span>
              <span className="tasting-meta">neue Bewertung, Datum heute (änderbar)</span>
            </Link>
          </li>
        </ul>
      </div>
    );
  }

  const today = todayIso();
  let initial;
  let manual: string[] = [];
  if (tasting) {
    const loaded = normalizeData(tasting.sat, today);
    const manualSet = manualScoresFromData(loaded);
    manual = [...manualSet];
    initial = autoEvaluate(loaded, manualSet).data;
  } else {
    initial = newTastingData(wine, year, grapes ? formatShares(grapes.shares) : wine.grapes.join(", "), today);
  }

  return (
    <div className="stack-lg">
      <FallbackLink href={back}>← {title}</FallbackLink>
      <div className="stack-sm">
        <h1 className="page-title">WSET Level 3 – Systematisches Verkosten</h1>
        <p className="muted small">Ohne Flasche im Bestand – die Bewertung gilt für Wein und Jahrgang.</p>
      </div>
      <SatForm
        target={{ kind: "wine", id: wine.id, year }}
        doneHref={wineHref(wine.id, year, { verkostung: "gespeichert" })}
        cancelHref={back}
        tastingId={tasting?.id ?? null}
        initial={initial}
        initialManual={manual}
        persons={persons ?? []}
        initialPersonId={tasting ? tasting.person_id : preselectedPerson(personParam, persons ?? [], person?.id ?? null)}
        today={today}
        draftKey={`mywine_sat_draft_${tasting?.id ?? `w${wine.id}-${year ?? "ohne"}`}`}
      />
    </div>
  );
}
