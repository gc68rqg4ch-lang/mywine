// Zoom beim Zurückkehren zurücksetzen (iPad/iPhone): nur bei einer Rückkehr in die App und nur,
// wenn hineingezoomt (scale > 1); in der App bleibt Zwei-Finger-Zoom möglich. Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CHECK_DELAYS_MS,
  MIN_AWAY_MS,
  RESET_METHODS,
  WATCH_MS,
  debugEnabled,
  inWatchWindow,
  isReturn,
  loadKind,
  lockedViewport,
  minMaxViewport,
  nextMethod,
  resetOutcome,
  shouldResetZoom,
  zoomedIn,
} from "@/lib/ui/zoom";

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

test("Wann prüfen: beim Laden und nach der Rückkehr sofort, 0,3 s, 1 s, 2,5 s; „resize“ nur in den ersten 3 s", () => {
  assert.deepEqual([...CHECK_DELAYS_MS], [0, 300, 1000, 2500]);
  assert.ok(CHECK_DELAYS_MS.every((ms) => ms <= WATCH_MS));
  const t0 = 10_000;
  assert.equal(inWatchWindow(t0 + 100, t0), true);
  assert.equal(inWatchWindow(t0 + WATCH_MS, t0), true);
  assert.equal(inWatchWindow(t0 + WATCH_MS + 1, t0), false, "danach: Zwei-Finger-Zoom in der App nicht stören");
  assert.equal(inWatchWindow(t0, null), false);
  // Art des Ladens (Diagnose)
  assert.equal(loadKind("navigate"), "neu");
  assert.equal(loadKind("reload"), "neu geladen");
  assert.equal(loadKind("back_forward"), "zurück/vor");
  assert.equal(loadKind("navigate", true), "Zwischenspeicher");
  assert.equal(loadKind(undefined), "neu");
});

test("Wann zurücksetzen: nur hineingezoomt; Methoden der Reihe nach, bis eine wirkt", () => {
  assert.equal(zoomedIn(1), false);
  assert.equal(zoomedIn(1.009), false);
  assert.equal(zoomedIn(1.6), true);
  assert.equal(zoomedIn(null), false);
  assert.deepEqual([...RESET_METHODS], ["Meta umstellen", "Meta neu einfügen", "min/max-scale=1"]);
  assert.equal(nextMethod([]), "Meta umstellen");
  assert.equal(nextMethod(["Meta umstellen"]), "Meta neu einfügen");
  assert.equal(nextMethod([...RESET_METHODS]), null, "alle versucht – aufhören");
  assert.equal(minMaxViewport("width=device-width, initial-scale=1, maximum-scale=1"), "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1");
  assert.doesNotMatch(minMaxViewport("width=device-width"), /user-scalable/);
});

test("Ergebnis messen: zurückgesetzt, teilweise, ohne Wirkung, unbekannt", () => {
  assert.equal(resetOutcome(1.9, 1), "zurückgesetzt");
  assert.equal(resetOutcome(1.9, 1.005), "zurückgesetzt");
  assert.equal(resetOutcome(1.9, 1.4), "teilweise");
  assert.equal(resetOutcome(1.9, 1.9), "ohne Wirkung");
  assert.equal(resetOutcome(1.9, null), "unbekannt");
});

test("Diagnose: ?zoomdebug=1 ein, ?zoomdebug=0 aus, sonst wie für den Tab gespeichert", () => {
  assert.equal(debugEnabled("?zoomdebug=1", null), true);
  assert.equal(debugEnabled("?zoomdebug=0", "1"), false);
  assert.equal(debugEnabled("", "1"), true, "nach Schliessen/Öffnen weiter sichtbar");
  assert.equal(debugEnabled("?gruppe=land", null), false);
  const component = readFileSync("src/components/zoom-reset.tsx", "utf8");
  assert.match(component, /sessionStorage\.setItem/);
  assert.match(component, /className="zoom-debug"/);
});
