// App-Symbol „Traube“ aus den SVGs erzeugen (einmalig bzw. nach Änderungen; Ergebnis eingecheckt):
//   src/app/icon.svg               – volle Version, abgerundet (Safari-Tab ab 32 px; von Hand gepflegt)
//   scripts/icons/favicon-small.svg → src/app/favicon.ico (16 und 32 px, vereinfacht)
//   scripts/icons/home-square.svg   → src/app/apple-icon.png (180 px), public/icons/icon-192.png und
//                                     icon-512.png (Manifest; volles Quadrat, iOS/Android runden selbst)
// Ausführen: npx tsx scripts/make-icons.ts
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const png = (svg: string, size: number) => sharp(readFileSync(svg), { density: 300 }).resize(size, size).png().toBuffer();

/** ICO mit eingebetteten PNGs (von allen Browsern unterstützt). */
function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  const small = "scripts/icons/favicon-small.svg";
  const square = "scripts/icons/home-square.svg";
  writeFileSync("src/app/favicon.ico", ico([{ size: 16, data: await png(small, 16) }, { size: 32, data: await png(small, 32) }]));
  writeFileSync("src/app/apple-icon.png", await png(square, 180));
  writeFileSync("public/icons/icon-192.png", await png(square, 192));
  writeFileSync("public/icons/icon-512.png", await png(square, 512));
  console.log("Symbole erzeugt.");
}

void main();
