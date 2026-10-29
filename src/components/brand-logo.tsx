/**
 * App-Logo „Traube“ vor dem Schriftzug „MyWine“ – dieselbe Datei wie das Favicon
 * (src/app/icon.svg, ausgeliefert unter /icon.svg), als Vektor auf Retina scharf. Dekorativ:
 * die Beschriftung ist der Text daneben.
 */
export function BrandLogo() {
  // eslint-disable-next-line @next/next/no-img-element -- SVG aus der App selbst, keine Optimierung nötig
  return <img src="/icon.svg" alt="" aria-hidden="true" width={30} height={30} className="brand-logo" />;
}
