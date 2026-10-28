// Notizen pro Wein (wines.notes): Karte „Notizen“ auf der Weinseite (✏️, mehrzeilig, getrimmt,
// leer → NULL), Anzeige mit Zeilenumbrüchen, Suche in den Listen über den Notiztext, Bot zeigt
// die Notiz unter „ℹ️ Details“ (kein Bearbeiten). tasting_notes wird nirgends mehr verwendet.
import "./env";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ReactElement } from "react";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyEdit, cleanNotes } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import { matchesQuery } from "@/lib/cellar/overview";
import { loadWineNotes } from "@/lib/cellar/notes";
import { wineDetailsText } from "@/lib/chat/details";
import { WineNotesView } from "@/components/wine-notes";

const W = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const net: Net = {
  tables: {}, telegram: [], rpc: {},
  claude: () => {
    throw new Error("kein Claude erwartet");
  },
};
installNet(net);
const db = createAdminClient();
const reset = () => {
  net.tables = {
    wines: [
      { id: W, name: "Pintia", producer: "Vega Sicilia", type: "red", country: "Spanien", region: "Toro", appellation: null, alcohol_content: null, grapes: [], notes: null },
      { id: W2, name: "Alion", producer: "Vega Sicilia", type: "red", country: "Spanien", region: null, appellation: null, alcohol_content: null, grapes: [], notes: "2021: zu Wild dekantieren" },
    ],
  };
};
const notes = () => net.tables.wines[0].notes;

test("Notiz speichern (getrimmt, Umbrüche bleiben), leeren → NULL", async () => {
  reset();
  assert.equal(cleanNotes("  \r\nErste Zeile\r\nZweite Zeile  \n "), "Erste Zeile\nZweite Zeile");
  assert.equal(cleanNotes("   \n "), null);

  const form = new FormData();
  for (const [k, v] of Object.entries({ kind: "wineNotes", wineId: W, notes: "  Erste Zeile\r\nZweite Zeile\n\n" })) form.set(k, v);
  const edits = editsFromForm(form);
  assert.ok(Array.isArray(edits));
  const saved = await applyEdit(db, edits[0]);
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.equal(notes(), "Erste Zeile\nZweite Zeile");
  assert.match(saved.message, /Notizen gespeichert/);

  assert.equal((await applyEdit(db, { kind: "wineNotes", wineId: W, notes: "Erste Zeile\nZweite Zeile" })).ok, false, "unverändert → nichts zu tun");
  const cleared = await applyEdit(db, { kind: "wineNotes", wineId: W, notes: "   " });
  assert.ok(cleared.ok);
  assert.equal(notes(), null, "leer → NULL (DB erlaubt keine leere Notiz)");
  assert.equal((await applyEdit(db, { kind: "wineNotes", wineId: W, notes: "x".repeat(10_001) })).ok, false, "zu lang");
});

test("Mehrzeilige Notiz wird mit Umbrüchen angezeigt; ohne Notiz „Noch keine Notizen“", () => {
  const el = WineNotesView({ notes: "2021: kräftig\n2022: noch jung" }) as ReactElement<{ className: string; children: ReactElement<{ children: unknown[] }>[] }>;
  assert.equal(el.props.className, "wine-notes");
  const parts = el.props.children.flatMap((f) => f.props.children).filter((c) => c !== false);
  assert.equal(parts.filter((c) => (c as ReactElement).type === "br").length, 1);
  assert.deepEqual(parts.filter((c) => typeof c === "string"), ["2021: kräftig", "2022: noch jung"]);
  const empty = WineNotesView({ notes: null }) as ReactElement<{ children: string }>;
  assert.equal(empty.props.children, "Noch keine Notizen");

  // Karte „Notizen“ nach „Zum Wein“, vor Bewertungen; iPad quer mit „Zum Wein“ in Spalte 2; ✏️ wie die anderen Karten
  const page = readFileSync("src/app/(cellar)/wein/[id]/page.tsx", "utf8");
  const main = page.slice(page.indexOf('<div className="wine-col wine-col-main">'), page.indexOf('className="wine-col wine-col-taste"'));
  assert.ok(main.indexOf("WINE_SECTIONS.map") < main.indexOf('id="notes"'), "nach „Zum Wein“");
  assert.ok(main.includes("<WineNotesForm wineId={wine.id} notes={wine.notes} />") && main.includes("<WineNotesView notes={wine.notes} />"));
  assert.ok(page.indexOf('id="notes"') < page.indexOf('id="ratings"'), "vor Bewertungen");
  const sections = readFileSync("src/app/(cellar)/wein/[id]/edit-sections.tsx", "utf8");
  assert.match(sections, /<textarea name="notes" rows=\{6\}/);
});

test("Suche in den Listen findet den Wein über den Notiztext", async () => {
  reset();
  const wine = { name: "Alion", producer: "Vega Sicilia", country: "Spanien", region: null, type: "red" as const, grapes: [], vintages: [2021], units: [] };
  assert.equal(matchesQuery(wine, "dekantieren"), false, "ohne Notizen nicht");
  assert.equal(matchesQuery(wine, "wild dekantieren", "2021: zu Wild dekantieren"), true);
  const loaded = await loadWineNotes(db, [W, W2]);
  assert.deepEqual([...loaded], [[W2, "2021: zu Wild dekantieren"]], "nur Weine mit Notizen");
  for (const f of ["src/app/(cellar)/page.tsx", "src/app/(cellar)/getrunken/page.tsx", "src/app/(cellar)/offen/page.tsx", "src/app/(cellar)/verkostet/page.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /matchesQuery\(\w, state\.query, notes\?\.get\(\w\.wine_id\)\)/, f);
  }
});

test("Bot-Details zeigen die Notiz (mehrzeilig, ohne Bearbeiten)", () => {
  const text = wineDetailsText({
    name: "Alion", producer: "Vega Sicilia", type: "red", year: 2021, country: null, region: null, appellation: null, alcohol: null,
    grapes: null, drinkFrom: null, drinkUntil: null, bottles: [], ratings: [], lastTasting: null, appUrl: null,
    notes: "2021: zu <Wild>\n2022: jung",
  });
  assert.match(text, /\n🗒 <b>Notizen<\/b>\n2021: zu &lt;Wild&gt;\n2022: jung$/);
  const none = wineDetailsText({ name: "X", producer: null, type: null, year: null, country: null, region: null, appellation: null, alcohol: null, grapes: null, drinkFrom: null, drinkUntil: null, bottles: [], ratings: [], lastTasting: null, appUrl: null, notes: null });
  assert.doesNotMatch(none, /Notizen/);
  const menu = readFileSync("src/lib/chat/menu.ts", "utf8");
  assert.ok(menu.includes("alcohol_content, grapes, notes") && menu.includes("notes: wine.notes"));
});

test("tasting_notes wird im Code nicht mehr verwendet; Migration zum Löschen liegt bereit", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const users = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && f !== join("src", "lib", "database.types.ts") && readFileSync(f, "utf8").includes("tasting_notes"));
  assert.deepEqual(users, []);
  const drop = readFileSync("supabase/migrations/20261028171446_drop_tasting_notes.sql", "utf8");
  assert.match(drop, /drop table public\.tasting_notes;/);
  const fn = drop.slice(drop.indexOf("CREATE OR REPLACE FUNCTION public.change_vintage"), drop.indexOf("drop table"));
  assert.ok(fn.length > 100 && !fn.includes("tasting_notes"), "change_vintage ohne tasting_notes, vor dem Löschen");
});
