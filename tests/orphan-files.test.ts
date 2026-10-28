// Verwaiste Dateien (scripts/cleanup-orphan-files.ts): Trockenlauf listet nur, --apply löscht nur
// Dateien ohne Verweis. Verweise: wine_media (Datei und Vorschaubild), Fotos offener Erfassungen,
// inventory_items.photo_urls; frische Dateien bleiben. Supabase und Storage per Stub.
import "./env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupOrphanFiles } from "@/lib/media/orphans";

const W = "11111111-1111-4111-8111-111111111111";
const old = "2026-10-01T10:00:00.000Z";
const net: Net = { tables: {}, telegram: [], rpc: {}, storage: new Map(), claude: () => { throw new Error("kein Claude"); } };
installNet(net);
const db = createAdminClient();
const file = (createdAt = old) => ({ bytes: new Uint8Array([1, 2, 3]), type: "application/octet-stream", createdAt });

function reset() {
  net.storage = new Map([
    // mit Verweis
    [`wine-photos/wines/${W}/front.jpg`, file()],
    [`wine-photos/wines/${W}/front.thumb.webp`, file()],
    [`wine-documents/app/${W}/datenblatt.pdf`, file()],
    [`wine-photos/telegram/job-open/10.jpg`, file()],
    [`wine-photos/legacy/item.jpg`, file()],
    // ohne Verweis
    [`wine-photos/telegram/job-done/190.jpg`, file()],
    [`wine-documents/app/${W}/0464b738.pdf`, file()],
    // ohne Verweis, aber frisch (Upload läuft vielleicht noch)
    [`wine-documents/app/${W}/neu.pdf`, file(new Date().toISOString())],
  ]);
  net.tables = {
    wine_media: [
      { id: "m1", wine_id: W, storage_bucket: "wine-photos", storage_path: `wines/${W}/front.jpg`, thumb_path: `wines/${W}/front.thumb.webp` },
      { id: "m2", wine_id: W, storage_bucket: "wine-documents", storage_path: `app/${W}/datenblatt.pdf`, thumb_path: null },
    ],
    ingest_jobs: [
      { id: "j1", status: "needs_review", photo_paths: ["telegram/job-open/10.jpg"] },
      { id: "j2", status: "discarded", photo_paths: ["telegram/job-done/190.jpg"] },
    ],
    inventory_items: [{ id: "i1", photo_urls: ["legacy/item.jpg"] }, { id: "i2", photo_urls: [] }],
  };
}
const orphanNames = (list: { bucket: string; path: string }[]) => list.map((f) => `${f.bucket}/${f.path}`).sort();
const EXPECTED = [`wine-documents/app/${W}/0464b738.pdf`, "wine-photos/telegram/job-done/190.jpg"];

test("Trockenlauf: listet nur Dateien ohne Verweis (auch in Unterordnern), löscht nichts", async () => {
  reset();
  const before = [...net.storage!.keys()].sort();
  const { orphans, deleted } = await cleanupOrphanFiles(db);
  assert.deepEqual(orphanNames(orphans), EXPECTED);
  assert.equal(deleted, 0);
  assert.deepEqual([...net.storage!.keys()].sort(), before, "nichts gelöscht");
});

test("--apply: löscht genau die Dateien ohne Verweis; frische und verwiesene bleiben", async () => {
  reset();
  const { orphans, deleted } = await cleanupOrphanFiles(db, { apply: true });
  assert.deepEqual(orphanNames(orphans), EXPECTED);
  assert.equal(deleted, 2);
  for (const k of EXPECTED) assert.ok(!net.storage!.has(k), `${k} gelöscht`);
  assert.equal(net.storage!.size, 6);
  assert.ok(net.storage!.has(`wine-documents/app/${W}/neu.pdf`), "frischer Upload bleibt");
  assert.ok(net.storage!.has("wine-photos/telegram/job-open/10.jpg"), "Fotos einer offenen Erfassung bleiben");
  // Fehler beim Lesen der Verweise → abbrechen, nichts löschen
  reset();
  net.fail = (method, table) => (table === "wine_media" ? { status: 500, body: { message: "kaputt" } } : null);
  try {
    await assert.rejects(cleanupOrphanFiles(db, { apply: true }));
  } finally {
    net.fail = undefined;
  }
  assert.equal(net.storage!.size, 8, "ohne Verweisliste wird nichts gelöscht");
});

test("Skript: Trockenlauf als Standard, Löschen nur mit --apply", () => {
  const script = readFileSync("scripts/cleanup-orphan-files.ts", "utf8");
  assert.match(script, /const apply = process\.argv\.includes\("--apply"\);/);
  assert.match(script, /cleanupOrphanFiles\(db, \{ apply \}\)/);
});
