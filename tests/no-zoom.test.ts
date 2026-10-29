// iPad/iPhone: kein automatisches Hineinzoomen – Viewport mit maximum-scale=1 (ohne
// user-scalable=no, Zwei-Finger-Zoom bleibt), kein Doppeltipp-Zoom (touch-action), Felder auf
// Touch-Geräten mit mindestens 16 px Schrift. Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// layout.tsx lädt CSS und Schrift (nicht im Test ladbar) – darum der Quelltext des viewport-Objekts.
const layout = readFileSync("src/app/layout.tsx", "utf8");
const viewport = layout.slice(layout.indexOf("export const viewport"), layout.indexOf("};", layout.indexOf("export const viewport")));

test("Viewport: width=device-width, initial-scale=1, maximum-scale=1 – ohne userScalable: false", () => {
  assert.match(viewport, /: Viewport = \{/);
  assert.match(viewport, /width: "device-width",/);
  assert.match(viewport, /initialScale: 1,/);
  assert.match(viewport, /maximumScale: 1,/);
  assert.doesNotMatch(viewport, /userScalable/, "Zwei-Finger-Zoom bleibt möglich");
  assert.match(viewport, /themeColor:/, "Farben wie bisher");
});

test("CSS: touch-action manipulation; Felder auf Touch-Geräten ≥ 16 px, am Desktop unverändert", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /html,\s*body \{[^}]*touch-action: manipulation;/);
  const touch = css.slice(css.lastIndexOf("@media (pointer: coarse) {"));
  assert.match(touch, /input:not\(\[type="checkbox"\]\)[^{]*,\s*select,\s*textarea \{\s*font-size: max\(16px, 1em\) !important;/);
  // Nur in der Touch-Abfrage – sonst keine neue Schriftgrösse für Felder
  assert.equal(css.match(/max\(16px, 1em\)/g)?.length, 1);
});
