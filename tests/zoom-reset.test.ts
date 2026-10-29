// Zoom beim Zurückkehren zurücksetzen (iPad/iPhone): nur bei einer Rückkehr in die App und nur,
// wenn hineingezoomt (scale > 1); in der App bleibt Zwei-Finger-Zoom möglich. Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MIN_AWAY_MS, isReturn, lockedViewport, shouldResetZoom } from "@/lib/ui/zoom";

test("Zurücksetzen nur bei Rückkehr und nur, wenn hineingezoomt", () => {
  const back = { type: "pageshow" as const, persisted: true };
  assert.equal(shouldResetZoom(back, 1.8), true, "aus dem Zwischenspeicher, hineingezoomt");
  assert.equal(shouldResetZoom(back, 1), false, "nicht gezoomt");
  assert.equal(shouldResetZoom(back, 1.004), false, "Rundung von Safari");
  assert.equal(shouldResetZoom(back, undefined), false, "ohne visualViewport");
  assert.equal(shouldResetZoom({ type: "pageshow", persisted: false }, 2), false, "normal geladen – keine Rückkehr");
  // Wieder sichtbar / Fokus: nur nach mindestens 1 s weg
  assert.equal(shouldResetZoom({ type: "visibilitychange", visibility: "visible" }, 2, 60_000), true);
  assert.equal(shouldResetZoom({ type: "visibilitychange", visibility: "visible" }, 2, 300), false, "kurz – z. B. Dialog in der App");
  assert.equal(shouldResetZoom({ type: "visibilitychange", visibility: "hidden" }, 2, 60_000), false);
  assert.equal(shouldResetZoom({ type: "focus" }, 2, MIN_AWAY_MS), true, "zurück in den Tab");
  assert.equal(shouldResetZoom({ type: "focus" }, 2, null), false, "in der App (nicht weg gewesen) – Zoomen bleibt möglich");
  assert.equal(isReturn({ type: "focus" }, null), false);
});

test("Viewport kurz sperren und danach unverändert wiederherstellen; im gemeinsamen Layout", () => {
  const original = "width=device-width, initial-scale=1, maximum-scale=1";
  assert.equal(lockedViewport(original), "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no");
  const component = readFileSync("src/components/zoom-reset.tsx", "utf8");
  assert.match(component, /const original = meta\.content;/);
  assert.match(component, /meta\.content = original;/, "wiederhergestellt – Zwei-Finger-Zoom geht wieder");
  assert.ok(!/location\.reload|router\.refresh/.test(component), "ohne Neuladen");
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /<ZoomReset \/>/);
  // Grundeinstellung bleibt ohne user-scalable=no
  assert.doesNotMatch(readFileSync("src/app/layout.tsx", "utf8"), /^\s*userScalable:/m);
});
