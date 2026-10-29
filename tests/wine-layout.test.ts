// Weinseite umplatziert: Geschmacksprofil iPad quer zuoberst in Spalte 3 (über „Bewertungen“),
// sonst direkt nach „Zum Wein“; Recherche als 🔎 im Kopf neben dem Weinnamen mit kleinem Feld
// („Nachrecherchieren“, „Zuletzt recherchiert am …“, drehendes 🔎, kurze Meldung).
// Geprüft am Quelltext und CSS (die Seite braucht eine Anmeldung). Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { researchSummary } from "@/lib/research/summary";

const page = readFileSync("src/app/(cellar)/wein/[id]/page.tsx", "utf8");
const head = readFileSync("src/app/(cellar)/wein/[id]/research-head.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const media = (min: number | null) => {
  if (min == null) return css.slice(css.indexOf(".wine-columns {"), css.indexOf("@media (min-width: 700px)", css.indexOf(".wine-columns {")));
  const start = css.indexOf(`@media (min-width: ${min}px) {\n  /* iPad`);
  return css.slice(start, css.indexOf("\n}\n", start));
};

test("Position: iPhone und iPad hochkant Zum Wein → Geschmacksprofil → Bewertungen; iPad quer Geschmacksprofil über Bewertungen in Spalte 3", () => {
  // Im DOM: Geschmacksprofil direkt nach der Karte „Zum Wein“, im selben Spalten-Container.
  const wineCol = page.slice(page.indexOf('<div className="wine-col wine-col-wine">'), page.indexOf("// Spalte 3"));
  assert.ok(wineCol.indexOf("</section>") < wineCol.indexOf('className="wine-col wine-col-taste"'));
  assert.ok(wineCol.includes("<TasteCard "), "Karte (auch ohne Profil mit „🔎 Geschmacksprofil recherchieren“) an derselben Stelle");
  assert.equal(page.match(/<TasteCard /g)?.length, 1, "nur einmal auf der Seite");
  assert.ok(page.indexOf("{wineColumn}") < page.indexOf("{ratingsColumn}"));
  // iPhone: eine Spalte
  assert.match(media(null), /grid-template-areas: "open" "wine" "ratings";/);
  // iPad hochkant: rechts Zum Wein mit Geschmacksprofil, links Bestand und Bewertungen; Bestand bleibt oben links
  assert.match(media(700), /grid-template-areas: "open wine" "ratings wine";/);
  // iPad quer: Spalte 2 nur Zum Wein, Spalte 3 Geschmacksprofil über Bewertungen
  const wide = media(1000);
  assert.match(wide, /grid-template-areas: "open wine taste" "open wine ratings";/);
  assert.match(wide, /\.wine-col-wine \{\s*display: contents;/);
  assert.match(wide, /\.wine-col-main \{\s*grid-area: wine;/);
  assert.match(wide, /\.wine-col-taste \{\s*grid-area: taste;/);
});

test("Recherche im Kopf: 🔎 neben dem Weinnamen, kein Block in „Zum Wein“, kein Link zum Sammellauf", () => {
  const title = page.slice(page.indexOf('<div className="title-row">'), page.indexOf("</h1>") + 200);
  assert.ok(title.includes("<ResearchHead wineId={wine.id} year={year}"), "für den gewählten Jahrgang");
  assert.ok(!page.includes("ResearchBlock") && !page.includes('subsection-title">Recherche'));
  assert.ok(!page.includes("Sammellauf für alle Weine"));
  assert.ok(!readFileSync("src/app/(cellar)/wein/[id]/grape-card.tsx", "utf8").includes("Sammellauf"));
  assert.match(css, /\.research-head-btn \{[^}]*height: 1\.8rem;/, "dezent, etwa Titelhöhe");
});

test("Ablauf im 🔎-Feld: Nachrecherchieren, Zuletzt recherchiert, drehendes 🔎, Meldung bleibt sichtbar", () => {
  assert.ok(head.includes("useActionState(") && head.includes("researchWineFromHeader"));
  assert.match(head, /aria-expanded=\{open\}/);
  assert.match(head, /pending \? "research-head-btn is-spinning" : "research-head-btn"/);
  assert.match(css, /\.research-head-btn\.is-spinning > span \{[^}]*animation: research-spin/);
  assert.ok(head.includes('"Nachrecherchieren"') && head.includes("Zuletzt recherchiert am ${researchedOn}") && head.includes('"Noch nie recherchiert"'));
  assert.ok(head.includes('name="year"') && head.includes('value={year == null ? "nv" : String(year)}'), "gewählter Jahrgang");
  assert.ok(head.includes("hidden={!open}"), "Feld bleibt im DOM – das Ergebnis geht nicht verloren");
  assert.ok(head.includes("!submitting && setOpen"), "während des Absendens nicht schliessbar");
  // Im Hintergrund: läuft ein Auftrag, dreht das 🔎 auch nach dem Wiederöffnen der Seite
  assert.ok(head.includes("const pending = submitting || running;") && head.includes("Recherche läuft im Hintergrund"));
  const action = readFileSync("src/app/(cellar)/research-actions.ts", "utf8");
  assert.match(action, /enqueueRun\(session\.supabase, \[\{ wineId, kind: "page", params: year === undefined \? \{\} : \{ year \} \}\]/, "Auftrag mit gewähltem Jahrgang");
  assert.match(action, /researchWine\(wineId, "all", "always", year\)/, "ohne Migration wie bisher: inkl. Geschmacksprofil, gewählter Jahrgang");
  assert.match(action, /revalidatePath\(`\/wein\/\$\{wineId\}`\)/, "„Zuletzt recherchiert am“ wird aktualisiert");
});

test("Kurze Meldung nach der Recherche", () => {
  const base = { status: "filled" as const, filled: ["Region", "Alkohol", "Geschmacksprofil"], suggested: 0 };
  assert.deepEqual(researchSummary(base), { ok: "3 Angaben ergänzt" });
  assert.deepEqual(researchSummary({ ...base, filled: [], suggested: 1 }), { ok: "1 Abweichung zum Prüfen" });
  assert.deepEqual(researchSummary({ ...base, filled: ["Region"], suggested: 2 }), { ok: "1 Angabe ergänzt · 2 Abweichungen zum Prüfen" });
  assert.deepEqual(researchSummary({ status: "nothing", filled: [], suggested: 0 }), { ok: "Nichts Neues gefunden" });
  assert.deepEqual(researchSummary({ status: "error", filled: [], suggested: 0, error: { kind: "usage_limit", message: "Das monatliche API-Limit ist erreicht." } }), { error: "Das monatliche API-Limit ist erreicht." });
});
