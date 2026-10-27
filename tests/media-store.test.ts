// Fotos speichern: Vorschaubild 160 px als WebP; scheitert ein Upload oder das Vorschaubild,
// bleibt das Foto ohne Vorschaubild bzw. wird übersprungen – der Rest wird gespeichert.
import "./env";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { makeThumb, saveWineMedia } from "@/lib/media/store";

const big = () => sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#803040" } }).jpeg().toBuffer();

test("Vorschaubild: WebP, 160 px breit, Seitenverhältnis bleibt", async () => {
  const meta = await sharp(await makeThumb(await big())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 160, 240]);
});

test("saveWineMedia: Upload-Fehler und unlesbares Bild ohne Vorschaubild, Rest gespeichert", async () => {
  const uploads: string[] = [];
  const inserted: { kind: string; thumb_path: string | null }[] = [];
  const db = {
    storage: { from: () => ({ upload: async (p: string) => { uploads.push(p); return { error: p.includes("bad") ? new Error("x") : null }; } }) },
    from: () => ({ insert: async (rows: typeof inserted) => { inserted.push(...rows); return { error: null }; } }),
  };
  const bytes = await big();
  await saveWineMedia(db as never, { wineId: "w", vintageYear: 2020, itemId: "i" }, [
    { path: "t/1.jpg", bytes, mimeType: "image/jpeg", kind: "label_front", sortOrder: 0 },
    { path: "t/bad.jpg", bytes, mimeType: "image/jpeg", kind: "label_back", sortOrder: 1 },
    { path: "t/3.jpg", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", kind: "photo", sortOrder: 2 },
  ]);
  assert.ok(uploads.includes("t/1.thumb.webp"));
  assert.deepEqual(inserted.map((r) => r.thumb_path), ["t/1.thumb.webp", null, null]);
});
