// App-Symbol „Traube“: Dateien vorhanden (SVG, ICO 16+32, Apple 180, Manifest 192/512), Manifest
// mit Name, Symbolen und display „browser“ (nicht standalone – Magic Link), Name auf dem
// Home-Bildschirm „MyWine“, Proxy lässt Symbole und Manifest ohne Anmeldung durch. Ausführen: npm test
import "./env";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import manifest from "@/app/manifest";
import { config } from "@/proxy";

const pngSize = (file: string) => {
  const b = readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), "PNG", file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test("Manifest: Name, Farben, Symbole 192/512 (any + maskable), display browser", () => {
  const m = manifest();
  assert.equal(m.name, "MyWine");
  assert.equal(m.short_name, "MyWine");
  assert.equal(m.display, "browser", "nicht standalone: eigene Sitzung auf iOS, Magic Link käme nicht an");
  assert.equal(m.background_color, "#faf7f5");
  assert.equal(m.theme_color, "#faf7f5");
  const icons = (m.icons ?? []).map((i) => `${i.src} ${i.sizes} ${i.purpose}`);
  assert.deepEqual(icons, [
    "/icons/icon-192.png 192x192 any",
    "/icons/icon-192.png 192x192 maskable",
    "/icons/icon-512.png 512x512 any",
    "/icons/icon-512.png 512x512 maskable",
  ]);
  for (const i of m.icons ?? []) assert.ok(existsSync(`public${i.src}`), i.src);
});

test("Dateien: icon.svg (abgerundet), favicon.ico (16+32), apple-icon 180, Manifest-PNGs quadratisch", () => {
  const svg = readFileSync("src/app/icon.svg", "utf8");
  assert.match(svg, /<rect width="512" height="512" rx="112" fill="#6E1F33"\/>/);
  assert.match(svg, /#C9A46A/);
  assert.equal(svg.match(/<circle /g)?.length, 6);
  const square = readFileSync("scripts/icons/home-square.svg", "utf8");
  assert.ok(!square.includes("rx="), "Home-Bildschirm: volles Quadrat, iOS/Android runden selbst");
  const ico = readFileSync("src/app/favicon.ico");
  assert.deepEqual([ico.readUInt16LE(2), ico.readUInt16LE(4)], [1, 2], "ICO mit zwei Bildern");
  assert.deepEqual([ico.readUInt8(6), ico.readUInt8(22)], [16, 32]);
  assert.deepEqual(pngSize("src/app/apple-icon.png"), [180, 180]);
  assert.deepEqual(pngSize("public/icons/icon-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/icons/icon-512.png"), [512, 512]);
});

test("Name auf dem Home-Bildschirm „MyWine“, ohne Standalone", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.match(layout, /"apple-mobile-web-app-title": "MyWine"/);
  // Nicht als Einstellung (Kommentare dürfen es erwähnen): appleWebApp setzt mobile-web-app-capable.
  assert.doesNotMatch(layout, /^\s*appleWebApp:/m, "kein mobile-web-app-capable (sonst eigene Sitzung)");
  assert.doesNotMatch(layout, /"(apple-)?mobile-web-app-capable":/);
});

test("Proxy: Symbole und Manifest ohne Anmeldung (nicht auf /login umgeleitet)", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of ["/icon.svg", "/apple-icon.png", "/favicon.ico", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]) {
    assert.equal(matcher.test(path), false, `${path} läuft nicht durch den Proxy`);
  }
  for (const path of ["/", "/offen", "/wein/123", "/login"]) assert.equal(matcher.test(path), true, `${path} weiterhin mit Proxy`);
});
