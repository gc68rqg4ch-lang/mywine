import type { Metadata } from "next";
import Link from "next/link";
import { getMemberSession } from "@/lib/auth";
import { parseVintageParam } from "@/lib/cellar/wine-page";
import { loadPlaces } from "@/lib/edit/encounters";
import { asWineType, todayIso } from "@/lib/format";
import { NewEncounterForm } from "./new-encounter-form";

export const metadata: Metadata = { title: "Verkostet erfassen" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?wein=<id>&jahrgang=2019: von der Weinseite aus mit diesem Wein und Jahrgang. */
export default async function NewEncounterPage({ searchParams }: PageProps<"/verkostet/neu">) {
  const params = await searchParams;
  const { supabase, person } = await getMemberSession();
  const [wines, places, persons] = await Promise.all([
    supabase.from("wines").select("id, name, producer, type, country").order("producer").order("name"),
    loadPlaces(supabase),
    supabase.from("persons").select("id, name").order("sort_order"),
  ]);
  if (wines.error) throw wines.error;
  const preselected = typeof params.wein === "string" && UUID_RE.test(params.wein) && wines.data?.some((w) => w.id === params.wein) ? params.wein : null;
  const year = parseVintageParam(params.jahrgang);

  return (
    <div className="stack-lg">
      <Link href="/verkostet" className="back">
        ← Verkostet
      </Link>
      <h1 className="page-title">Verkostet erfassen</h1>
      <NewEncounterForm
        wines={(wines.data ?? []).map((w) => ({ ...w, type: asWineType(w.type) }))}
        places={places}
        persons={persons.data ?? []}
        ownPersonId={person?.id ?? null}
        today={todayIso()}
        preselected={preselected}
        preselectedYear={preselected && year !== undefined ? year : "unset"}
      />
    </div>
  );
}
