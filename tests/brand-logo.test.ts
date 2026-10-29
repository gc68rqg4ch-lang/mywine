// Kopfzeile: Logo „Traube“ (dieselbe Datei wie das Favicon) vor „MyWine“, zusammen ein Link auf „/“;
// das Logo ist dekorativ (alt="", aria-hidden). Auch auf Login und „Kein Zugang“.
// Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Kopfzeile: Logo und Schriftzug sind ein Link auf die Startseite", () => {
  const layout = readFileSync("src/app/(cellar)/layout.tsx", "utf8");
  assert.match(layout, /<Link href="\/" className="brand">\s*<BrandLogo \/>\s*<span className="brand-name">MyWine<\/span>\s*<\/Link>/);
  const logo = readFileSync("src/components/brand-logo.tsx", "utf8");
  // Keine zweite Kopie der Grafik: die App-Datei /icon.svg (src/app/icon.svg).
  assert.match(logo, /src="\/icon\.svg"/);
  assert.match(logo, /alt=""/);
  assert.match(logo, /aria-hidden="true"/);
  assert.doesNotMatch(logo, /<svg|<path|<circle/);
  for (const page of ["src/app/login/page.tsx", "src/app/kein-zugang/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /<h1 className="brand">\s*<BrandLogo \/>\s*<span className="brand-name">MyWine<\/span>/, page);
  }
  // Logo 28–32 px, bleibt bei schmaler Breite gleich gross.
  const css = readFileSync("src/app/globals.css", "utf8");
  const size = css.match(/\.brand-logo \{[^}]*width: (\d+)px;[^}]*height: (\d+)px;/);
  assert.ok(size && Number(size[1]) >= 28 && Number(size[1]) <= 32 && size[1] === size[2]);
  assert.match(css, /\.brand-logo \{[^}]*flex: none;/);
});
