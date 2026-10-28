// Angehängte PDFs als zusätzliche Quelle für Recherche und Geschmacksprofil: nur der gesuchte
// Jahrgang (PDF ohne Jahrgang nur bei eindeutigem Jahrgang im Text), zu grosse/lange PDFs
// übersprungen, Quelle „Dokument: <Dateiname>“, neues PDF startet die Profilsuche (auch
// innerhalb von 12 Monaten), Sammellauf überspringt nicht, Fehler → Log, Recherche läuft weiter.
// Supabase, Storage und Claude per fetch-Stub. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeTool, installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchAndFillWine } from "@/lib/research/wine";
import { autoTasteProfile } from "@/lib/research/taste-auto";
import { runLater } from "@/lib/later";
import { DOCUMENT_BUCKET, insertDocumentRow } from "@/lib/media/documents";
import { MAX_RESEARCH_DOC_BYTES } from "@/lib/research/documents";
import { pdfPageCount, pdfText, vintageInPdfText } from "@/lib/research/pdf-text";
import { UNKNOWN } from "@/lib/taste/profile";

const W = "11111111-1111-4111-8111-111111111111";
type Row = Record<string, unknown>;
const monthsAgo = (m: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString();
};

/** Kleines unkomprimiertes PDF mit Text (Tj) und Seitenzahl; pad = Füllbytes. */
function pdf(text: string, pages = 1, pad = 0) {
  const pageObjs = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join("\n");
  const content = `BT /F1 12 Tf (${text}) Tj ET`;
  const body = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${pageObjs}\n9 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n%${"x".repeat(pad)}\n%%EOF`;
  return new TextEncoder().encode(body);
}

type Call = { tool: string; docs: string[]; text: string };
const calls: Call[] = [];
let tasteReply: (docs: string[]) => Record<string, unknown> = () => claudeTool("report_taste_profile", noMatch);
const noMatch = { matches_wine: false, same_vintage: false, sources: [], fields: {}, aromas: [], evidence: [], contradictions: [], style_summary: "", food_pairing: [] };
const net: Net = {
  tables: {}, telegram: [], rpc: {}, storage: new Map(),
  claude: (body) => {
    const tools = ((body.tools as { name: string }[]) ?? []).map((t) => t.name);
    const content = (body.messages as { content: unknown }[])[0].content;
    const blocks = Array.isArray(content) ? (content as Row[]) : [{ type: "text", text: content }];
    const docs = blocks.filter((b) => b.type === "document").map((b) => String(b.title));
    for (const b of blocks.filter((b) => b.type === "document")) assert.equal((b.source as Row).media_type, "application/pdf");
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
    if (tools.includes("report_taste_profile")) {
      calls.push({ tool: "taste", docs, text });
      return tasteReply(docs);
    }
    calls.push({ tool: "wine", docs, text });
    return claudeTool("report_wine_details", { producer: null, country: null, region: null, appellation: null, type: null, alcohol_content: null, vintages: [], sources: [] });
  },
};
net.rpc.replace_grape_shares = () => [];
installNet(net);
const db = createAdminClient();

/** Pintia mit Flaschen 2018 und 2019, beide vor 2 Monaten ohne Fund gesucht. */
function reset(docs: { name: string; year: number | null; bytes?: Uint8Array; created?: string; missing?: boolean }[] = []) {
  net.storage!.clear();
  net.tables = {
    wines: [{ id: W, name: "Pintia", producer: "Vega Sicilia", country: "Spanien", region: "Toro", appellation: "DO Toro", type: "red", alcohol_content: 14.5, grapes: ["Tinta de Toro"], researched_at: monthsAgo(3) }],
    inventory_items: [2018, 2019].map((y) => ({ wine_id: W, vintage_year: y, status: "sealed" })),
    wine_encounters: [],
    wine_vintages: [2018, 2019].map((y) => ({ id: `v${y}`, wine_id: W, vintage_year: y, drink_from_year: 2022, drink_until_year: 2032, taste_profile_checked_at: monthsAgo(2) })),
    wine_grape_shares: [], research_suggestions: [], wine_taste_profiles: [],
    wine_media: docs.map((d, i) => {
      const path = `app/${W}/doc${i}.pdf`;
      if (!d.missing) net.storage!.set(`${DOCUMENT_BUCKET}/${path}`, { bytes: d.bytes ?? pdf("Datenblatt"), type: "application/pdf" });
      return { id: `m${i}`, wine_id: W, vintage_year: d.year, kind: "document", storage_bucket: DOCUMENT_BUCKET, storage_path: path, file_name: d.name, mime_type: "application/pdf", created_at: d.created ?? monthsAgo(6) };
    }),
  };
  calls.length = 0;
  tasteReply = () => claudeTool("report_taste_profile", noMatch);
}

/** Console-Ausgaben mitschreiben (error und warn). */
async function capture(fn: () => Promise<unknown>) {
  const logged: string[] = [];
  const { error, warn } = console;
  console.error = console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    Object.assign(console, { error, warn });
  }
  return logged;
}

test("PDF-Prüfung: Seiten zählen, Text aus Tj, Jahrgang nur eindeutig", () => {
  assert.equal(pdfPageCount(pdf("x", 3)), 3);
  assert.equal(pdfText(pdf("Pintia Jahrgang 2019 \\(Toro\\)")), "Pintia Jahrgang 2019 (Toro)");
  assert.equal(vintageInPdfText("Ficha técnica – Añada 2019", "Pintia"), 2019);
  assert.equal(vintageInPdfText("Pintia 2019 – Toro", "Pintia"), 2019);
  assert.equal(vintageInPdfText("Vintage 2018 und Vintage 2019 im Vergleich", "Pintia"), null, "zwei Jahrgänge → unklar");
  assert.equal(vintageInPdfText("Gegründet 1997, Toro", "Pintia"), null);
});

test("Profil: PDF mit passendem Jahrgang geht mit, anderer Jahrgang nicht; ohne Jahrgang nur bei eindeutigem Text", async () => {
  reset([
    { name: "ficha-2019.pdf", year: 2019 },
    { name: "ficha-2018.pdf", year: 2018 },
    { name: "allgemein.pdf", year: null, bytes: pdf("Bodega Pintia, Toro") },
    { name: "technik.pdf", year: null, bytes: pdf("Ficha tecnica Pintia Jahrgang 2019") },
    { name: "andere.pdf", year: null, bytes: pdf("Vintage 2018") },
  ]);
  const outcome = await researchAndFillWine(db, W, "all", { taste: "always", year: 2019 });
  const taste = calls.find((c) => c.tool === "taste")!;
  assert.deepEqual(taste.docs.sort(), ["ficha-2019.pdf", "technik.pdf"]);
  assert.match(taste.text, /„ficha-2019\.pdf“ – Jahrgang 2019; als Quelle mit url "dokument:ficha-2019\.pdf"/);
  assert.match(taste.text, /„technik\.pdf“ – Jahrgang 2019/);
  // Recherche der Weindaten: je Jahrgang der Recherche (2018 und 2019); „andere.pdf“ nennt eindeutig 2018
  const wine = calls.find((c) => c.tool === "wine")!;
  assert.deepEqual(wine.docs.sort(), ["andere.pdf", "ficha-2018.pdf", "ficha-2019.pdf", "technik.pdf"]);
  assert.match(wine.text, /„andere\.pdf“ – Jahrgang 2018/);
  assert.ok(!wine.docs.includes("allgemein.pdf"));
  assert.ok(calls.every((c) => !c.docs.includes("allgemein.pdf")), "PDF ohne Jahrgang und ohne Jahrgang im Text: nie");
  assert.equal(outcome.taste, "none");
});

test("Zu grosses bzw. zu langes PDF wird übersprungen, die Recherche läuft weiter", async () => {
  reset([
    { name: "gross.pdf", year: 2019, bytes: pdf("Jahrgang 2019", 1, MAX_RESEARCH_DOC_BYTES) },
    { name: "lang.pdf", year: 2019, bytes: pdf("Jahrgang 2019", 11) },
    { name: "ok.pdf", year: 2019, bytes: pdf("Jahrgang 2019", 10) },
  ]);
  const logged = await capture(() => researchAndFillWine(db, W, "all", { taste: "only", year: 2019, skipRecent: false }));
  assert.deepEqual(calls.map((c) => c.docs), [["ok.pdf"]]);
  assert.ok(logged.some((l) => /skipped.*gross\.pdf/.test(l)) && logged.some((l) => /skipped.*lang\.pdf/.test(l)), logged.join("\n"));
});

test("Profilwert aus dem PDF: mit Zitat, Quelle „Dokument: <Dateiname>“", async () => {
  reset([{ name: "ficha-2019.pdf", year: 2019 }]);
  const ref = "dokument:ficha-2019.pdf";
  tasteReply = () =>
    claudeTool("report_taste_profile", {
      matches_wine: true, same_vintage: true,
      sources: [{ url: ref, title: "Ficha", kind: "document", vintage: 2019 }, { url: "dokument:fremd.pdf", title: "x", kind: "document", vintage: 2019 }],
      fields: { sweetness: "trocken", acidity: UNKNOWN, tannin: "hoch", alcohol: UNKNOWN, body: "voll", flavour_intensity: UNKNOWN, finish: UNKNOWN },
      aromas: [], contradictions: [], style_summary: "", food_pairing: [],
      // tannin ohne Beleg → unbekannt; Beleg aus einem nicht beigelegten Dokument zählt nicht
      evidence: [{ field: "body", source_url: ref, quote: "cuerpo pleno" }, { field: "sweetness", source_url: ref, quote: "seco" }, { field: "tannin", source_url: "dokument:fremd.pdf", quote: "taninos firmes" }],
    });
  const outcome = await researchAndFillWine(db, W, "all", { taste: "only", year: 2019, skipRecent: false });
  assert.equal(outcome.taste, "saved");
  const p = net.tables.wine_taste_profiles[0];
  assert.deepEqual([p.vintage_year, p.body, p.sweetness, p.tannin], [2019, "voll", "trocken", UNKNOWN]);
  assert.deepEqual(p.sources, [{ url: null, document: "ficha-2019.pdf", title: "Dokument: ficha-2019.pdf", kind: "document", vintage: 2019 }]);
  assert.deepEqual((p.evidence as Record<string, unknown>).body, [{ source_url: ref, quote: "cuerpo pleno" }]);
});

test("Neues Dokument ohne Profil → Suche startet, auch wenn der Jahrgang vor kurzem ohne Fund gesucht wurde", async () => {
  reset();
  // Ohne neues Dokument gilt die 12-Monats-Regel
  assert.equal(await autoTasteProfile(db, W, 2019), "recent");
  assert.equal(calls.length, 0);
  // Upload (gemeinsam für App und Bot)
  const path = `app/${W}/neu.pdf`;
  net.storage!.set(`${DOCUMENT_BUCKET}/${path}`, { bytes: pdf("Jahrgang 2019"), type: "application/pdf" });
  await insertDocumentRow(db, { wineId: W, vintageYear: 2019, path, fileName: "neu.pdf" }, async () => {});
  assert.equal(calls.length, 0, "läuft im Hintergrund");
  await runLater();
  assert.deepEqual(calls.map((c) => [c.tool, c.docs]), [["taste", ["neu.pdf"]]]);
  // Profil schon vorhanden → keine Suche
  net.tables.wine_taste_profiles.push({ id: "p18", wine_id: W, vintage_year: 2018, source: "manual", aromas: {}, food_pairing: [], sources: [], evidence: {} });
  net.storage!.set(`${DOCUMENT_BUCKET}/${path}2`, { bytes: pdf("x"), type: "application/pdf" });
  await insertDocumentRow(db, { wineId: W, vintageYear: 2018, path: `${path}2`, fileName: "b.pdf" }, async () => {});
  await runLater();
  assert.equal(calls.length, 1);
  // Ohne Jahrgang (NV-Dokument): keine automatische Suche
  await insertDocumentRow(db, { wineId: W, vintageYear: null, path: `${path}3`, fileName: "c.pdf" }, async () => {});
  await runLater();
  assert.equal(calls.length, 1);
});

test("Sammellauf „Geschmacksprofil fehlt“: nach der letzten Suche angehängtes PDF → nicht überspringen", async () => {
  reset([{ name: "alt.pdf", year: 2018, created: monthsAgo(6) }]);
  // Beide Jahrgänge vor 2 Monaten gesucht, PDF älter → überspringen
  assert.equal((await researchAndFillWine(db, W, "all", { taste: "only" })).taste, "skipped");
  assert.equal(calls.length, 0);
  reset([{ name: "neu-2018.pdf", year: 2018, created: monthsAgo(1) }]);
  const outcome = await researchAndFillWine(db, W, "all", { taste: "only" });
  assert.equal(outcome.tasteYear, 2018);
  assert.deepEqual(calls.map((c) => c.docs), [["neu-2018.pdf"]]);
  // Automatische Suche (ohne force) beachtet die gleiche Regel
  reset([{ name: "neu-2018.pdf", year: 2018, created: monthsAgo(1) }]);
  assert.equal(await autoTasteProfile(db, W, 2018), "none");
  assert.equal(await autoTasteProfile(db, W, 2019), "recent");
});

test("PDF lässt sich nicht laden → Log „research document failed“, Recherche läuft ohne PDF weiter", async () => {
  reset([{ name: "weg.pdf", year: 2019, missing: true }, { name: "da.pdf", year: 2019 }]);
  const logged = await capture(() => researchAndFillWine(db, W, "all", { taste: "always", year: 2019 }));
  assert.ok(logged.some((l) => l.startsWith("research document failed") && l.includes("weg.pdf")), logged.join("\n"));
  assert.deepEqual(calls.map((c) => [c.tool, c.docs]), [["wine", ["da.pdf"]], ["taste", ["da.pdf"]]]);
  // Auch die Liste der Dokumente scheitert → ohne PDFs weiter
  reset([{ name: "da.pdf", year: 2019 }]);
  net.fail = (method, table) => (method === "GET" && table === "wine_media" ? { status: 500, body: { message: "kaputt" } } : null);
  try {
    const logs = await capture(() => autoTasteProfile(db, W, 2019, { force: true }));
    assert.ok(logs.some((l) => l.startsWith("research document failed")), logs.join("\n"));
  } finally {
    net.fail = undefined;
  }
  assert.deepEqual(calls.map((c) => c.docs), [[]]);
});
