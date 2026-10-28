// Karte „Bestand“: bezahlt und Normalpreis je auf einer eigenen Zeile, nie abgeschnitten
// („Normalpreis“, in schmaler Karte „normal“). Ausführen: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import { StockValue } from "@/components/cellar/stock-value";

// Die Tests laufen mit „react-server“ (ohne react-dom/server): Elementbaum selbst zu HTML machen.
function html(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(html).join("");
  if (!isValidElement(node)) return "";
  const { children, className } = node.props as { children?: ReactNode; className?: string };
  if (typeof node.type === "function") return html((node.type as (p: unknown) => ReactNode)(node.props));
  return `<${String(node.type)}${className ? ` class="${className}"` : ""}>${html(children)}</${String(node.type)}>`;
}
const render = (props: { paid: number; regular: number }) => html(StockValue(props));

const css = readFileSync("src/app/globals.css", "utf8");
const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));

test("Beide Beträge als eigene Zeilen, Schweizer Tausendertrennung", () => {
  const out = render({ paid: 11190, regular: 12239 });
  const lines = [...out.matchAll(/<p class="([^"]*)">(.*?)<\/p>/g)];
  assert.equal(lines.length, 2);
  assert.match(lines[0][2], /CHF\s11.190<\/span> bezahlt$/);
  assert.match(lines[1][2], /CHF\s12.239<\/span> <span class="amount-long">Normalpreis<\/span><span class="amount-short">normal<\/span>$/);
  assert.ok(out.includes("11’190") || out.includes("11'190"), out);
  assert.ok(lines.every((l) => l[1].includes("tile-amount")));
  // Gleicher Betrag → nur eine Zeile
  assert.equal([...render({ paid: 500, regular: 500 }).matchAll(/<p /g)].length, 1);
});

test("Nie mit „…“ abgeschnitten: Zeilen umbrechen, schmal „normal“ statt „Normalpreis“", () => {
  assert.match(rule(".tile-line.tile-amount"), /overflow: visible;/);
  assert.match(rule(".tile-line.tile-amount"), /white-space: normal;/);
  assert.match(rule(".tile-amounts"), /container-type: inline-size;/);
  assert.match(css, /@container \(max-width: 165px\) \{\s*\.amount-long \{\s*display: none;/);
  const page = readFileSync("src/app/(cellar)/page.tsx", "utf8");
  assert.ok(page.includes("<StockValue paid={valuePaid} regular={valueRegular} />"));
  assert.ok(!/bezahlt[\s\S]{0,80}· \$\{formatMoney/.test(page), "nicht mehr auf einer Zeile");
});
