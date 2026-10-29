import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BACK_FALLBACK_MS, backHref, navigationStuck, plainClick } from "@/lib/ui/back-link";

test("backHref: zuletzt gezeigte Ansicht derselben Liste", () => {
  assert.equal(backHref("/bestand", "/bestand?gruppe=land&auf=Spanien"), "/bestand?gruppe=land&auf=Spanien");
  assert.equal(backHref("/bestand", "/bestand"), "/bestand");
  assert.equal(backHref("/offen", "/offen#x"), "/offen#x");
});

test("backHref: nichts gemerkt, fremde oder alte Adresse → Liste selbst", () => {
  assert.equal(backHref("/bestand", null), "/bestand");
  assert.equal(backHref("/bestand", ""), "/bestand");
  // Alte Adresse aus der Zeit, als der Bestand auf „/“ lag
  assert.equal(backHref("/bestand", "/?gruppe=land"), "/bestand");
  assert.equal(backHref("/getrunken", "/bestand?gruppe=land"), "/getrunken");
  assert.equal(backHref("/verkostet", "/verkostet-alt"), "/verkostet");
  assert.equal(backHref("/bestand", "//boese.example/bestand"), "/bestand");
  assert.equal(backHref("/bestand", "https://boese.example/bestand"), "/bestand");
  assert.equal(backHref("/", "/?gruppe=land"), "/?gruppe=land");
});

test("Rückfall: nur bei gewöhnlichem Tipp und unveränderter Adresse", () => {
  const tap = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(plainClick(tap), true);
  assert.equal(plainClick({ ...tap, metaKey: true }), false);
  assert.equal(plainClick({ ...tap, button: 1 }), false);
  assert.equal(navigationStuck("/wein/1?von=bestand", "/wein/1?von=bestand"), true);
  assert.equal(navigationStuck("/wein/1?von=bestand", "/bestand"), false);
  assert.ok(BACK_FALLBACK_MS >= 1000 && BACK_FALLBACK_MS <= 2000);
});

test("Zurück-Links nutzen den Rückfall; Bearbeiten löst den Fokus vor dem Schliessen", () => {
  const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(read("app/(cellar)/wein/[id]/page.tsx"), /<BackLink base=\{back\.href\}/);
  for (const p of ["app/(cellar)/flasche/[id]/verkostung/page.tsx", "app/(cellar)/verkostet/[id]/wset/page.tsx", "app/(cellar)/verkostet/neu/page.tsx"]) {
    assert.match(read(p), /<FallbackLink href=/, p);
    assert.doesNotMatch(read(p), /className="back"/, p);
  }
  assert.match(read("components/back-link.tsx"), /window\.location\.assign\(href\)/);
  assert.match(read("components/edit-unit.tsx"), /active\.blur\(\)/);
});
