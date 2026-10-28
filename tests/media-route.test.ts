// Bilder über die eigene Route /media/<bucket>/<pfad>: stabile URL (Browser-Cache statt jedes
// Mal neu signiert), nur für Angemeldete (Storage-RLS: Mitglieder), langer privater Cache, nur
// Bilder als Bild. Listen und Weinseite brauchen keinen Signier-Aufruf mehr. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { installNet, type Net } from "./stub-net";
import { MEDIA_CACHE_CONTROL, mediaUrl, parseMediaPath } from "@/lib/media/url";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLabelPhotos, loadVintagePhotos } from "@/lib/media/store";

const W = "11111111-1111-4111-8111-111111111111";

test("URL: immer gleich für denselben Pfad, Teile kodiert; Route prüft Bucket und Pfad", () => {
  assert.equal(mediaUrl(`app/${W}/a b.jpg`), `/media/wine-photos/app/${W}/a%20b.jpg`);
  assert.equal(mediaUrl("telegram/x/190.thumb.webp"), mediaUrl("telegram/x/190.thumb.webp"));
  assert.deepEqual(parseMediaPath("wine-photos", ["app", W, "a.thumb.webp"]), { bucket: "wine-photos", path: `app/${W}/a.thumb.webp` });
  assert.equal(parseMediaPath("wine-documents", ["app", "x.pdf"]), null, "nur der Foto-Bucket");
  assert.equal(parseMediaPath("wine-photos", ["..", "x.jpg"]), null);
  assert.equal(parseMediaPath("wine-photos", ["app", "a..b.jpg"]), null);
  assert.equal(parseMediaPath("wine-photos", []), null);
  assert.equal(parseMediaPath("wine-photos", ["app", ".hidden"]), null);
  assert.equal(MEDIA_CACHE_CONTROL, "private, max-age=31536000, immutable");
});

// Route mit nachgebildetem Supabase-Client (angemeldet bzw. nicht, Storage-Dateien).
let signedIn = true;
const files = new Map<string, Blob>([
  [`app/${W}/a.thumb.webp`, new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" })],
  [`app/${W}/x.html`, new Blob(["<script>"], { type: "text/html" })],
]);
const downloads: string[] = [];
const fakeClient = {
  auth: { getClaims: async () => ({ data: signedIn ? { claims: { sub: "u1" } } : null, error: null }) },
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) => {
        downloads.push(`${bucket}/${path}`);
        const blob = files.get(path);
        return blob ? { data: blob, error: null } : { data: null, error: { message: "not found" } };
      },
    }),
  },
};
const serverFile = require.resolve("@/lib/supabase/server");
const fake = new Module(serverFile);
fake.filename = serverFile;
fake.loaded = true;
fake.exports = { createClient: async () => fakeClient };
require.cache[serverFile] = fake;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET } = require("@/app/media/[bucket]/[...path]/route") as typeof import("@/app/media/[bucket]/[...path]/route");
const call = (bucket: string, path: string[]) => GET(new Request("https://x/") as never, { params: Promise.resolve({ bucket, path }) } as never);

test("Route: angemeldet → Bild mit langem privatem Cache; sonst 401/404 ohne Cache", async () => {
  signedIn = true;
  const ok = await call("wine-photos", ["app", W, "a.thumb.webp"]);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(ok.headers.get("content-type"), "image/webp");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3]);

  const html = await call("wine-photos", ["app", W, "x.html"]);
  assert.equal(html.headers.get("content-type"), "application/octet-stream", "Nicht-Bild nie als Seite");
  assert.equal(html.headers.get("content-disposition"), "attachment");

  const missing = await call("wine-photos", ["app", W, "fehlt.jpg"]);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");

  downloads.length = 0;
  assert.equal((await call("wine-photos", ["..", "secret"])).status, 404);
  assert.equal((await call("wine-documents", ["app", "x.pdf"])).status, 404);
  assert.deepEqual(downloads, [], "ungültige Pfade gehen gar nicht erst an Storage");

  signedIn = false;
  const anon = await call("wine-photos", ["app", W, "a.thumb.webp"]);
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get("cache-control"), "no-store");
});

test("Listen und Weinseite: Foto-URLs der Route, kein Signier-Aufruf", async () => {
  const net: Net = {
    tables: {
      wine_media: [
        { id: "m1", wine_id: W, inventory_item_id: null, kind: "label_front", vintage_year: 2019, storage_bucket: "wine-photos", storage_path: `app/${W}/a.jpg`, thumb_path: `app/${W}/a.thumb.webp`, sort_order: 0, created_at: "2026-10-01" },
        { id: "m2", wine_id: W, inventory_item_id: null, kind: "label_back", vintage_year: 2019, storage_bucket: "wine-photos", storage_path: `app/${W}/b.jpg`, thumb_path: `app/${W}/b.thumb.webp`, sort_order: 0, created_at: "2026-10-01" },
      ],
      inventory_items: [{ id: "i1", photo_urls: [] }],
    },
    telegram: [], rpc: {}, storage: new Map(),
    claude: () => { throw new Error("kein Claude"); },
  };
  installNet(net);
  const requests: string[] = [];
  const base = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new URL(String(input)).pathname);
    return base(input, init);
  }) as typeof fetch;
  try {
    const db = createAdminClient();
    const pick = await loadLabelPhotos(db, [W]);
    const pair = pick(W, 2019)!;
    assert.deepEqual([pair.front.thumb, pair.front.full], [`/media/wine-photos/app/${W}/a.thumb.webp`, `/media/wine-photos/app/${W}/a.jpg`]);
    assert.equal(pair.back?.thumb, `/media/wine-photos/app/${W}/b.thumb.webp`);
    const all = await loadLabelPhotos(db, null);
    assert.equal(all(W, 2019)?.front.id, "m1", "null = alle Weine (Bestand lädt gleichzeitig)");
    const photos = await loadVintagePhotos(db, W, 2019, ["i1"]);
    assert.deepEqual(photos.map((p) => p.thumb), [`/media/wine-photos/app/${W}/a.thumb.webp`, `/media/wine-photos/app/${W}/b.thumb.webp`]);
    assert.ok(!requests.some((r) => r.startsWith("/storage/")), `kein Storage-Aufruf: ${requests.join(", ")}`);
  } finally {
    globalThis.fetch = base;
  }
});
