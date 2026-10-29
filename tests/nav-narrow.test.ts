// Reiterzeile auf schmalen Bildschirmen: wischbar in eigenem Container (die Seite wird nie breiter
// als der Bildschirm), aktiver Reiter beim Laden sichtbar, Tippflächen ≥ 44 px; iPad hochkant
// zweizeilig statt zu breit.
// Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { navScrollLeft } from "@/lib/ui/nav-scroll";

test("aktiver Reiter: sichtbar und möglichst mittig, nie über die Ränder hinaus", () => {
  const box = { width: 288, scrollWidth: 358 }; // 320 px Bildschirm, 70 px zu wischen
  assert.equal(navScrollLeft({ left: 0, width: 79 }, box), 0); // „Bestand“ ganz links
  assert.equal(navScrollLeft({ left: 270, width: 76 }, box), 70); // „Verkostet“: bis ans Ende
  assert.equal(navScrollLeft({ left: 150, width: 80 }, box), 46); // Mitte
  assert.equal(navScrollLeft({ left: 200, width: 80 }, { width: 400, scrollWidth: 400 }), 0); // passt: nichts
});

test("CSS: Reiter wischbar ohne Scrollleiste, 44 px hoch; iPad hochkant zweizeilig", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const narrow = css.slice(css.indexOf("@media (max-width: 560px) {\n  .header-inner"));
  const block = narrow.slice(0, narrow.indexOf("\n}\n"));
  assert.match(block, /\.nav \{[^}]*min-width: 0;[^}]*overflow-x: auto;[^}]*scrollbar-width: none;/);
  assert.match(block, /\.nav::-webkit-scrollbar \{\s*display: none;/);
  assert.match(block, /\.nav-link \{[^}]*min-height: 44px;/);
  assert.match(block, /\.header \.segmented \.segment \{[^}]*min-height: 44px;/);
  assert.match(css, /@media \(min-width: 561px\) and \(max-width: 899px\) \{\s*\.header-inner \{\s*flex-wrap: wrap;/);
  const nav = readFileSync("src/components/nav-links.tsx", "utf8");
  assert.match(nav, /nav\.scrollLeft = navScrollLeft\(/);
});
