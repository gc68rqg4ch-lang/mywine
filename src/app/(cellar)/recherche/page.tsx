import type { Metadata } from "next";
import Link from "next/link";
import { getMemberSession } from "@/lib/auth";
import {
  GAP_KEYS,
  GAP_LABELS,
  RECENT_MONTHS,
  gapCounts,
  needsResearch,
  researchedRecently,
  tasteTargets,
  windowTargets,
  wineGaps,
  type ResearchScope,
} from "@/lib/research/gaps";
import { ResearchSuggestions } from "@/components/research-suggestions";
import { wineHref } from "@/lib/cellar/wine-page";
import { compareWineNames, wineName } from "@/lib/format";
import { loadPendingSuggestions, type Suggestion } from "@/lib/research/suggestions";
import { loadGapData } from "@/lib/research/wine";
import { BatchResearch, type BatchCandidate } from "./batch-research";
import { BatchProgress } from "./batch-progress";
import { latestBatchRun } from "@/lib/research/jobs";
import { runActive } from "@/lib/research/job-text";

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
  // „In den letzten 12 Monaten recherchierte überspringen“ – Standard an; ?kuerzlich=1 schaltet es aus.
  // Stammdaten: wines.researched_at; Geschmacksprofil: wine_vintages.taste_profile_checked_at je Jahrgang.
  const skipRecent = params.kuerzlich !== "1";
  // „Geschmacksprofil fehlt“: nur Weine ohne Profil, nur das Profil recherchieren.
  // „Trinkfenster fehlt“: Jahrgänge mit Flaschen (ungeöffnet/offen) ohne Trinkfenster – nur dieses suchen.
  const windowMode = params.fenster === "1";
  const profile = !windowMode && params.profil === "1";
  const href = (next: { alle?: boolean; vollstaendig?: boolean; skipRecent?: boolean; profil?: boolean; fenster?: boolean }) => {
    const q = new URLSearchParams();
    if (next.alle ?? scope === "all") q.set("alle", "1");
    if (next.vollstaendig ?? complete) q.set("vollstaendig", "1");
    if (!(next.skipRecent ?? skipRecent)) q.set("kuerzlich", "1");
    if (next.profil ?? profile) q.set("profil", "1");
    if (next.fenster ?? windowMode) q.set("fenster", "1");
    const query = q.toString();
    return `/recherche${query ? `?${query}` : ""}`;
  };
  const { supabase } = await getMemberSession();
  const [data, suggestions, run] = await Promise.all([
    loadGapData(supabase),
    loadPendingSuggestions(supabase),
    // Sammellauf im Hintergrund (ohne Migration: null).
    latestBatchRun(supabase).catch((error) => {
      console.error("loading research run failed", error);
      return null;
    }),
  ]);
  // Läuft bzw. ruht (API-Limit) ein Lauf, zuerst diesen zeigen; neu starten erst danach.
  const runOpen = run != null && (runActive(run.counts) || run.counts.held > 0);
  const byWine = new Map<string, Suggestion[]>();
  for (const s of suggestions) byWine.set(s.wineId, [...(byWine.get(s.wineId) ?? []), s]);

  const inScope = (s: ResearchScope) => data.wines.flatMap((w) => wineGaps(w, data, s) ?? []);
  const cellar = inScope("cellar").filter(needsResearch);
  const all = inScope("all").filter(needsResearch);
  const counts = { cellar: gapCounts(cellar), all: gapCounts(all) };
  // Geschmacksprofil fehlt: Weine mit mindestens einem Jahrgang ohne Profil (Jahrgänge mit Profil nie).
  const missingProfile = (g: (typeof cellar)[number], skip: boolean) => tasteTargets(g, data, { skipRecent: skip });
  const noProfile = (s: ResearchScope) => inScope(s).filter((g) => missingProfile(g, false).length > 0);
  const profileCounts = { cellar: noProfile("cellar").length, all: noProfile("all").length };
  // Trinkfenster fehlt: immer nur Jahrgänge mit ungeöffneten oder offenen Flaschen; ohne 12-Monats-Regel.
  const noWindow = inScope("cellar").filter((g) => windowTargets(g, data).length > 0);
  const windowYearCount = noWindow.reduce((s, g) => s + windowTargets(g, data).length, 0);
  const chosen = windowMode ? noWindow : profile ? noProfile(scope) : complete ? inScope(scope) : scope === "all" ? all : cellar;
  // In den letzten 12 Monaten recherchiert: beim Profil je Jahrgang (alle fehlenden kürzlich gesucht), sonst der Wein.
  const isRecent = (g: (typeof chosen)[number]) => (profile ? missingProfile(g, true).length === 0 : researchedRecently(g.wine));
  const recent = chosen.filter(isRecent);
  const selected = skipRecent && !windowMode ? chosen.filter((g) => !isRecent(g)) : chosen;
  const completeCount = selected.filter((g) => !needsResearch(g)).length;
  const list = selected.sort(
    (a, b) => compareWineNames(a.wine, b.wine),
  );
  const candidates: BatchCandidate[] = list.map((g) => ({
    wineId: g.wine.id,
    producer: g.wine.producer,
    name: g.wine.name,
    years: g.vintages.map((v) => v.year),
    gaps: windowMode
      ? [`Trinkfenster ${windowTargets(g, data).map((y) => y ?? "NV").join(", ")}`]
      : profile
        ? ["Geschmacksprofil"]
        : [...g.gaps.map((k) => GAP_LABELS[k]), ...(g.basics ? ["Land/Typ"] : [])],
    ...(windowMode ? { windowYears: windowTargets(g, data) } : {}),
    // Profil: der neueste Jahrgang ohne Profil (bei eingeschalteter Option: nicht in den letzten 12 Monaten gesucht).
    ...(profile ? { tasteYear: missingProfile(g, skipRecent)[0] ?? null } : {}),
    complete: profile || windowMode ? false : !needsResearch(g),
  }));

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <h1 className="page-title">Recherche</h1>
        <p className="muted">
          Ich suche pro Wein alle leeren Angaben im Web und ergänze sie in einem Durchgang: Produzent, Land, Region,
          Appellation, Typ, Alkohol, Trinkfenster je Jahrgang und Rebsorten mit %. Zuerst schaue ich im Shop des
          Händlers der Flasche nach, dann bei den anderen Schweizer Händlern. Vorhandene Angaben überschreibe ich
          nie. Dazu das Geschmacksprofil – nur mit Belegen aus Quellen zu genau diesem Wein; sonst lasse ich es leer.
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
            <tr>
              <th scope="row">Trinkfenster fehlt (Jahrgänge)</th>
              <td>{windowYearCount}</td>
              <td>–</td>
            </tr>
            <tr>
              <th scope="row">Geschmacksprofil fehlt</th>
              <td>{profileCounts.cellar}</td>
              <td>{profileCounts.all}</td>
            </tr>
            <tr className="gap-total">
              <th scope="row">Weine mit Lücken</th>
              <td>{cellar.length}</td>
              <td>{all.length}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">„Im Bestand“ = Weine mit ungeöffneten oder offenen Flaschen, egal an welchem Lagerort; „alle“ = auch ausgetrunkene und nur verkostete.</p>
      </section>

      <nav className="segmented" aria-label="Umfang">
        <Link href={href({ alle: false })} className={scope === "cellar" ? "segment active" : "segment"} aria-current={scope === "cellar" ? "page" : undefined}>
          Nur Weine im Bestand ({profile ? profileCounts.cellar : cellar.length})
        </Link>
        <Link href={href({ alle: true })} className={scope === "all" ? "segment active" : "segment"} aria-current={scope === "all" ? "page" : undefined}>
          Alle Weine, auch ausgetrunkene ({profile ? profileCounts.all : all.length})
        </Link>
      </nav>

      <Link href={href({ fenster: !windowMode, profil: false })} className="check-toggle" role="switch" aria-checked={windowMode}>
        <span className="check-box" aria-hidden>
          {windowMode ? "✓" : ""}
        </span>
        <span>
          Trinkfenster fehlt
          <span className="muted small">
            {" "}
            – {windowMode
              ? `ich suche nur das Trinkfenster (Quelle, sonst Schätzung) für ${windowYearCount} ${windowYearCount === 1 ? "Jahrgang" : "Jahrgänge"} im Bestand`
              : "nur Jahrgänge im Bestand ohne Trinkfenster, nur das Trinkfenster suchen"}
          </span>
        </span>
      </Link>

      {!windowMode && (
      <Link href={href({ profil: !profile })} className="check-toggle" role="switch" aria-checked={profile}>
        <span className="check-box" aria-hidden>
          {profile ? "✓" : ""}
        </span>
        <span>
          Geschmacksprofil fehlt
          <span className="muted small">
            {" "}
            – {profile ? "ich suche nur das Profil, bei Weinen ohne Profil" : "nur Weine ohne Geschmacksprofil, nur das Profil suchen"}
          </span>
        </span>
      </Link>
      )}

      {!profile && !windowMode && (
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
      )}

      {profile && (
      <Link href={href({ skipRecent: !skipRecent })} className="check-toggle" role="switch" aria-checked={!skipRecent}>
        <span className="check-box" aria-hidden>
          {!skipRecent ? "✓" : ""}
        </span>
        <span>
          Auch kürzlich ohne Fund gesuchte erneut prüfen
          <span className="muted small">
            {" "}
            – {skipRecent
              ? `${recent.length} ${recent.length === 1 ? "Wein wurde" : "Weine wurden"} in den letzten ${RECENT_MONTHS} Monaten ohne Fund gesucht und ${recent.length === 1 ? "wird" : "werden"} übersprungen`
              : `ich suche auch die ${recent.length} in den letzten ${RECENT_MONTHS} Monaten ohne Fund gesuchten nochmals`}
          </span>
        </span>
      </Link>
      )}

      {windowMode && (
        <p className="muted small">Trinkfenster fehlt: Ich suche jedes Mal neu, auch wenn ich schon einmal ohne Fund gesucht habe.</p>
      )}

      {!windowMode && !profile && (
      <Link href={href({ skipRecent: !skipRecent })} className="check-toggle" role="switch" aria-checked={skipRecent}>
        <span className="check-box" aria-hidden>
          {skipRecent ? "✓" : ""}
        </span>
        <span>
          In den letzten {RECENT_MONTHS} Monaten recherchierte überspringen
          <span className="muted small">
            {" "}
            – übersprungen, weil in den letzten {RECENT_MONTHS} Monaten recherchiert:{" "}
            {skipRecent ? recent.length : 0}
            {!skipRecent && recent.length ? ` (ausgeschaltet – ${recent.length} werden nochmals gesucht)` : ""}
          </span>
        </span>
      </Link>
      )}

      {run && <BatchProgress runId={run.runId} counts={run.counts} holdReason={run.holdReason} />}

      {/* key: bei Wechsel von Umfang oder Optionen frisch beginnen */}
      {!runOpen && (
      <BatchResearch
        key={`${scope}:${complete}:${skipRecent}:${profile}:${windowMode}`}
        candidates={candidates}
        scope={scope}
        taste={profile ? "only" : "missing"}
        skipRecent={skipRecent}
        skipped={skipRecent && !windowMode ? recent.length : 0}
        mode={windowMode ? "window" : "research"}
      />
      )}
    </div>
  );
}
