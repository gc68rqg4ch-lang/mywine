import type { Metadata } from "next";
import Link from "next/link";
import { getMemberSession } from "@/lib/auth";
import {
  GAP_KEYS,
  GAP_LABELS,
  RECENT_DAYS,
  gapCounts,
  needsResearch,
  researchedRecently,
  wineGaps,
  type ResearchScope,
} from "@/lib/research/gaps";
import { ResearchSuggestions } from "@/components/research-suggestions";
import { wineHref } from "@/lib/cellar/wine-page";
import { compareWineNames, wineName } from "@/lib/format";
import { loadPendingSuggestions, type Suggestion } from "@/lib/research/suggestions";
import { loadGapData } from "@/lib/research/wine";
import { BatchResearch, type BatchCandidate } from "./batch-research";

export const metadata: Metadata = { title: "Recherche" };

// Jeder Schritt des Sammellaufs ist eine Server Action mit Websuche.
export const maxDuration = 300;

/**
 * Übersicht zuerst: welche Angaben bei wie vielen Weinen fehlen (im Bestand / alle, auch ausgetrunkene).
 * Gestartet wird nur mit Bestätigung; diese Seite startet von sich aus nie etwas.
 */
export default async function ResearchPage({ searchParams }: PageProps<"/recherche">) {
  const params = await searchParams;
  const scope: ResearchScope = params.alle === "1" ? "all" : "cellar";
  // „Auch vollständige Weine prüfen“: alle Weine der Auswahl, Abweichungen werden Vorschläge.
  const complete = params.vollstaendig === "1";
  // „In den letzten 7 Tagen geprüfte überspringen“ – Standard an; ?kuerzlich=1 schaltet es aus.
  const skipRecent = params.kuerzlich !== "1";
  const href = (next: { alle?: boolean; vollstaendig?: boolean; skipRecent?: boolean }) => {
    const q = new URLSearchParams();
    if (next.alle ?? scope === "all") q.set("alle", "1");
    if (next.vollstaendig ?? complete) q.set("vollstaendig", "1");
    if (!(next.skipRecent ?? skipRecent)) q.set("kuerzlich", "1");
    const query = q.toString();
    return `/recherche${query ? `?${query}` : ""}`;
  };
  const { supabase } = await getMemberSession();
  const [data, suggestions] = await Promise.all([loadGapData(supabase), loadPendingSuggestions(supabase)]);
  const byWine = new Map<string, Suggestion[]>();
  for (const s of suggestions) byWine.set(s.wineId, [...(byWine.get(s.wineId) ?? []), s]);

  const inScope = (s: ResearchScope) => data.wines.flatMap((w) => wineGaps(w, data, s) ?? []);
  const cellar = inScope("cellar").filter(needsResearch);
  const all = inScope("all").filter(needsResearch);
  const counts = { cellar: gapCounts(cellar), all: gapCounts(all) };
  const chosen = complete ? inScope(scope) : scope === "all" ? all : cellar;
  const recent = chosen.filter((g) => researchedRecently(g.wine));
  const selected = skipRecent ? chosen.filter((g) => !researchedRecently(g.wine)) : chosen;
  const completeCount = selected.filter((g) => !needsResearch(g)).length;
  const list = selected.sort(
    (a, b) => compareWineNames(a.wine, b.wine),
  );
  const candidates: BatchCandidate[] = list.map((g) => ({
    wineId: g.wine.id,
    producer: g.wine.producer,
    name: g.wine.name,
    years: g.vintages.map((v) => v.year),
    gaps: [...g.gaps.map((k) => GAP_LABELS[k]), ...(g.basics ? ["Land/Typ"] : [])],
    complete: !needsResearch(g),
  }));

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h1 className="page-title">Recherche</h1>
        <p className="muted">
          Ich suche pro Wein alle leeren Angaben im Web und ergänze sie in einem Durchgang: Produzent, Land, Region,
          Appellation, Typ, Alkohol, Trinkfenster je Jahrgang und Rebsorten mit %. Vorhandene Angaben überschreibe ich
          nie.
        </p>
      </div>

      {suggestions.length > 0 && (
        <section className="card stack" aria-labelledby="vorschlaege">
          <h2 className="section-title" id="vorschlaege">
            Offene Vorschläge ({suggestions.length})
          </h2>
          <p className="muted small">
            Hier weicht die Recherche von deinen Angaben ab. Ich habe nichts überschrieben – du entscheidest pro Zeile.
          </p>
          {[...byWine.entries()].map(([wineId, list]) => (
            <div key={wineId} className="stack-sm">
              <Link href={wineHref(wineId)} className="link">
                <strong>
                  {list[0].wine ? wineName(list[0].wine) : ""}
                </strong>
              </Link>
              <ResearchSuggestions suggestions={list} title={list.length === 1 ? "1 Abweichung" : `${list.length} Abweichungen`} />
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h2 className="section-title">Was fehlt?</h2>
        <table className="gap-table">
          <thead>
            <tr>
              <th scope="col">Lücke</th>
              <th scope="col">im Bestand</th>
              <th scope="col">alle</th>
            </tr>
          </thead>
          <tbody>
            {GAP_KEYS.map((k) => (
              <tr key={k}>
                <th scope="row">{GAP_LABELS[k]}</th>
                <td>{counts.cellar[k]}</td>
                <td>{counts.all[k]}</td>
              </tr>
            ))}
            <tr className="gap-total">
              <th scope="row">Weine mit Lücken</th>
              <td>{cellar.length}</td>
              <td>{all.length}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">„Im Bestand“ = Weine mit ungeöffneten oder offenen Flaschen, egal an welchem Lagerort; „alle“ = auch ausgetrunkene.</p>
      </section>

      <nav className="segmented" aria-label="Umfang">
        <Link href={href({ alle: false })} className={scope === "cellar" ? "segment active" : "segment"} aria-current={scope === "cellar" ? "page" : undefined}>
          Nur Weine im Bestand ({cellar.length})
        </Link>
        <Link href={href({ alle: true })} className={scope === "all" ? "segment active" : "segment"} aria-current={scope === "all" ? "page" : undefined}>
          Alle Weine, auch ausgetrunkene ({all.length})
        </Link>
      </nav>

      <Link
        href={href({ vollstaendig: !complete })}
        className="check-toggle"
        role="switch"
        aria-checked={complete}
      >
        <span className="check-box" aria-hidden>
          {complete ? "✓" : ""}
        </span>
        <span>
          Auch vollständige Weine prüfen
          <span className="muted small">
            {" "}
            – {complete ? `${completeCount} ohne Lücken zur Kontrolle dabei` : "dann suche ich bei allen Weinen nach Abweichungen"}
          </span>
        </span>
      </Link>

      <Link href={href({ skipRecent: !skipRecent })} className="check-toggle" role="switch" aria-checked={skipRecent}>
        <span className="check-box" aria-hidden>
          {skipRecent ? "✓" : ""}
        </span>
        <span>
          In den letzten {RECENT_DAYS} Tagen geprüfte überspringen
          <span className="muted small">
            {" "}
            – {recent.length === 1 ? "1 Wein betroffen" : `${recent.length} Weine betroffen`}
          </span>
        </span>
      </Link>

      {/* key: bei Wechsel von Umfang oder Optionen frisch beginnen */}
      <BatchResearch
        key={`${scope}:${complete}:${skipRecent}`}
        candidates={candidates}
        scope={scope}
        skipped={skipRecent ? recent.length : 0}
      />
    </div>
  );
}
