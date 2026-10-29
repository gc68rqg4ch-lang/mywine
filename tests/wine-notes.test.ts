// Notizen pro Wein (wines.notes): Karte „Notizen“ auf der Weinseite (immer ein Freitextfeld,
// speichert automatisch, getrimmt, leer → NULL), Suche in den Listen über den Notiztext, Bot zeigt
// die Notiz unter „ℹ️ Details“ (kein Bearbeiten). tasting_notes wird nirgends mehr verwendet.
import "./env";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyEdit, cleanNotes } from "@/lib/edit/edit";
import { editsFromForm } from "@/lib/edit/form";
import { matchesQuery } from "@/lib/cellar/overview";
import { loadWineNotes } from "@/lib/cellar/notes";
import { wineDetailsText } from "@/lib/chat/details";

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

test("Karte „Notizen“: immer ein Freitextfeld (kein ✏️), nach „Zum Wein“, vor Bewertungen", () => {
  const page = readFileSync("src/app/(cellar)/wein/[id]/page.tsx", "utf8");
  const main = page.slice(page.indexOf('<div className="wine-col wine-col-main">'), page.indexOf('className="wine-col wine-col-taste"'));
  assert.ok(main.indexOf("WINE_SECTIONS.map") < main.indexOf('id="notes"'), "nach „Zum Wein“");
  assert.ok(main.includes("<NotesField key={wine.id} wineId={wine.id} notes={wine.notes} />"));
  const card = main.slice(main.indexOf('id="notes"'), main.indexOf("</section>", main.indexOf('id="notes"')));
  assert.ok(!card.includes("EditUnit"), "keine ✏️-Bearbeitung – zählt nicht als offene Bearbeitung");
  assert.ok(page.indexOf('id="notes"') < page.indexOf('id="ratings"'), "vor Bewertungen");
  const field = readFileSync("src/app/(cellar)/wein/[id]/notes-field.tsx", "utf8");
  assert.match(field, /placeholder="Notiz zum Wein …"/);
  assert.match(field, /el\.style\.height = `\$\{el\.scrollHeight\}px`/, "wächst mit dem Text");
  assert.match(field, /onBlur=\{\(\) => void saver\.flush\(\)\}/, "speichert beim Verlassen");
  assert.match(field, /"beforeunload"/, "Seite verlassen: speichern bzw. nachfragen");
  assert.ok(!/router\.refresh|revalidatePath/.test(field), "kein Neuladen der Seite");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.notes-field textarea \{[^}]*resize: none;[^}]*overflow: hidden;/, "keine Scrollbox");
});

test("Suche in den Listen findet den Wein über den Notiztext", async () => {
  reset();
  const wine = { name: "Alion", producer: "Vega Sicilia", country: "Spanien", region: null, type: "red" as const, grapes: [], vintages: [2021], units: [] };
  assert.equal(matchesQuery(wine, "dekantieren"), false, "ohne Notizen nicht");
  assert.equal(matchesQuery(wine, "wild dekantieren", "2021: zu Wild dekantieren"), true);
  const loaded = await loadWineNotes(db, [W, W2]);
  assert.deepEqual([...loaded], [[W2, "2021: zu Wild dekantieren"]], "nur Weine mit Notizen");
  for (const f of ["src/app/(cellar)/bestand/page.tsx", "src/app/(cellar)/getrunken/page.tsx", "src/app/(cellar)/offen/page.tsx", "src/app/(cellar)/verkostet/page.tsx"]) {
    // Suche im Browser: die Notizen gehen als Suchtext an die Liste.
    assert.match(readFileSync(f, "utf8"), /notes=\{\(e\) => notes\.get\(e\.wine_id\)\}/, f);
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
