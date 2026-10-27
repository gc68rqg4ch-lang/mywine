import type { Metadata } from "next";
import Link from "next/link";
import { getMemberSession } from "@/lib/auth";
import { GAP_KEYS, GAP_LABELS, gapCounts, needsResearch, wineGaps, type ResearchScope } from "@/lib/research/gaps";
import { loadGapData } from "@/lib/research/wine";
import { BatchResearch, type BatchCandidate } from "./batch-research";

export const metadata: Metadata = { title: "Recherche" };

// Jeder Schritt des Sammellaufs ist eine Server Action mit Websuche.
export const maxDuration = 300;

/**
 * Übersicht zuerst: welche Angaben bei wie vielen Weinen fehlen (im Keller / alle).
 * Gestartet wird nur mit Bestätigung; diese Seite startet von sich aus nie etwas.
 */
export default async function ResearchPage({ searchParams }: PageProps<"/recherche">) {
  const params = await searchParams;
  const scope: ResearchScope = params.alle === "1" ? "all" : "cellar";
  const { supabase } = await getMemberSession();
  const data = await loadGapData(supabase);

  const byScope = (s: ResearchScope) =>
    data.wines.flatMap((w) => {
      const g = wineGaps(w, data, s);
      return g && needsResearch(g) ? [g] : [];
    });
  const cellar = byScope("cellar");
  const all = byScope("all");
  const counts = { cellar: gapCounts(cellar), all: gapCounts(all) };
  const list = (scope === "all" ? all : cellar).sort(
    (a, b) => a.wine.producer.localeCompare(b.wine.producer, "de-CH") || a.wine.name.localeCompare(b.wine.name, "de-CH"),
  );
  const candidates: BatchCandidate[] = list.map((g) => ({
    wineId: g.wine.id,
    producer: g.wine.producer,
    name: g.wine.name,
    years: g.vintages.map((v) => v.year),
    gaps: [...g.gaps.map((k) => GAP_LABELS[k]), ...(g.basics ? ["Land/Typ"] : [])],
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

      <section className="card stack">
        <h2 className="section-title">Was fehlt?</h2>
        <table className="gap-table">
          <thead>
            <tr>
              <th scope="col">Lücke</th>
              <th scope="col">im Keller</th>
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
        <p className="muted small">„Im Keller“ = Weine mit ungeöffneten oder offenen Flaschen; „alle“ = auch getrunkene.</p>
      </section>

      <nav className="segmented" aria-label="Umfang">
        <Link href="/recherche" className={scope === "cellar" ? "segment active" : "segment"} aria-current={scope === "cellar" ? "page" : undefined}>
          Nur im Keller ({cellar.length})
        </Link>
        <Link href="/recherche?alle=1" className={scope === "all" ? "segment active" : "segment"} aria-current={scope === "all" ? "page" : undefined}>
          Alle Weine ({all.length})
        </Link>
      </nav>

      {/* key: bei Wechsel des Umfangs frisch beginnen */}
      <BatchResearch key={scope} candidates={candidates} scope={scope} />
    </div>
  );
}
