// Notizen direkt schreiben: automatisch speichern nach 1 s Pause und beim Verlassen, nur bei
// Änderung, Fehler ohne Textverlust (nochmals versuchen), getrimmt, leer → NULL, Zeilenumbrüche
// bleiben. Ohne DB, API-Schlüssel und Netz (fetch-Stub). Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyEdit } from "@/lib/edit/edit";
import { createAutosave, type AutosaveStatus } from "@/lib/edit/autosave";
import { cleanNotes } from "@/lib/edit/notes";

const W = "11111111-1111-4111-8111-111111111111";
const net: Net = { tables: {}, telegram: [], rpc: {}, claude: () => ({}) };
installNet(net);
const db = createAdminClient();

/** Autosave mit Protokoll; save schreibt wie die Server Action (cleanNotes) bzw. scheitert. */
function setup(initial: string | null, fail = () => false) {
  const saves: string[] = [];
  const statuses: AutosaveStatus[] = [];
  let stored: string | null = initial;
  const saver = createAutosave({
    initial,
    normalize: cleanNotes,
    onStatus: (s) => statuses.push(s),
    save: async (text) => {
      saves.push(text);
      await Promise.resolve();
      if (fail()) throw new Error("offline");
      stored = cleanNotes(text);
      return stored;
    },
  });
  return { saver, saves, statuses, stored: () => stored };
}

test("Leer bzw. nur Leerzeichen → NULL, vorne/hinten getrimmt, Zeilenumbrüche bleiben", async () => {
  assert.equal(cleanNotes(""), null);
  assert.equal(cleanNotes("  \n\t "), null);
  assert.equal(cleanNotes("  2021: kräftig\r\n2022: noch jung  \n"), "2021: kräftig\n2022: noch jung");
  assert.equal(cleanNotes("Zeile 1\n\nZeile 3"), "Zeile 1\n\nZeile 3", "Leerzeile in der Mitte bleibt");
  // Wie in der DB (über dieselbe Bearbeitung wie bisher)
  net.tables = { wines: [{ id: W, name: "Pintia", producer: null, type: "red", country: null, region: null, appellation: null, alcohol_content: null, grapes: [], notes: "alt" }] };
  assert.ok((await applyEdit(db, { kind: "wineNotes", wineId: W, notes: "  neu\nzweite Zeile  " })).ok);
  assert.equal(net.tables.wines[0].notes, "neu\nzweite Zeile");
  assert.ok((await applyEdit(db, { kind: "wineNotes", wineId: W, notes: "   " })).ok);
  assert.equal(net.tables.wines[0].notes, null);
});

test("Speichern nach 1 s Pause – nicht bei jedem Buchstaben", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { saver, saves, statuses } = setup(null);
    saver.change("W");
    mock.timers.tick(500);
    saver.change("Wi");
    mock.timers.tick(500);
    saver.change("Wild");
    mock.timers.tick(999);
    assert.deepEqual(saves, [], "noch in der Pause");
    assert.equal(saver.dirty(), true);
    mock.timers.tick(1);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(saves, ["Wild"]);
    assert.deepEqual(statuses, ["saving", "saved"]);
    assert.equal(saver.dirty(), false);
  } finally {
    mock.timers.reset();
  }
});

test("Beim Verlassen des Felds sofort speichern; unverändert → kein Aufruf", async () => {
  const { saver, saves, stored } = setup("Alt");
  await saver.flush();
  assert.deepEqual(saves, [], "nichts geändert");
  saver.change("Alt  ");
  await saver.flush();
  assert.deepEqual(saves, [], "nur Leerzeichen hinten – gespeicherte Form gleich");
  saver.change("Alt\nNeu");
  await saver.flush();
  assert.deepEqual(saves, ["Alt\nNeu"]);
  assert.equal(stored(), "Alt\nNeu");
  saver.change("   ");
  await saver.flush();
  assert.equal(stored(), null, "geleert → NULL");
});

test("Fehler: Anzeige „Nicht gespeichert“, Text bleibt; nochmals versuchen speichert ihn", async () => {
  let offline = true;
  const { saver, saves, statuses, stored } = setup(null, () => offline);
  saver.change("Zu Wild dekantieren");
  await saver.flush();
  assert.equal(saver.status(), "error");
  assert.equal(statuses.at(-1), "error");
  assert.equal(saver.dirty(), true, "noch nicht gespeichert – Seite verlassen fragt nach");
  assert.equal(stored(), null);
  offline = false;
  await saver.flush();
  assert.deepEqual(saves, ["Zu Wild dekantieren", "Zu Wild dekantieren"], "derselbe Text, nichts verloren");
  assert.equal(saver.status(), "saved");
  assert.equal(stored(), "Zu Wild dekantieren");
});

test("Während des Speicherns weitergetippt: danach der neuste Text", async () => {
  const { saver, saves, stored } = setup(null);
  saver.change("Erst");
  const first = saver.flush();
  saver.change("Erst und mehr");
  const second = saver.flush();
  await Promise.all([first, second]);
  assert.deepEqual(saves, ["Erst", "Erst und mehr"]);
  assert.equal(stored(), "Erst und mehr");
  assert.equal(saver.dirty(), false);
});
