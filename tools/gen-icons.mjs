/**
 * Sidify PWA icon generator.
 *
 * Draws the same mark as `src/components/Logo.tsx` — a white "S" on a red
 * squircle — and writes every image the manifest, the service worker and the
 * browser tab ask for:
 *
 *   public/icon.png                512  (favicon / artwork fallback)
 *   public/icon-192.png            192  (any — also the apple-touch-icon)
 *   public/icon-512.png            512  (any)
 *   public/icon-maskable-192.png   192  (maskable — the S inside the 40% safe circle)
 *   public/icon-maskable-512.png   512  (maskable)
 *   public/favicon.ico             32 + 16 (PNG-compressed ICO)
 *
 * Run (needs the rasterizer, not a project dependency on purpose):
 *   npm i --no-save @resvg/resvg-js && node tools/gen-icons.mjs
 *
 * Re-run whenever the mark changes; the PNGs are committed so normal builds
 * never need the generator.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

/** Brand red, top to bottom — mirrors LogoMark. */
const RED_TOP = "#ff5b6e";
const RED_BOTTOM = "#fa233b";
/** The S as one stroke in a 24-unit box — the same path as `S_PATH` in Logo.tsx. */
const S_PATH =
  "M16.3 7.7c-.95-1.55-2.6-2.4-4.55-2.4-2.65 0-4.55 1.45-4.55 3.5 0 4.75 9.6 2.55 9.6 7.5 0 2.15-2.05 3.75-4.95 3.75-2.2 0-4.05-.95-5.05-2.7";

/** Loads @resvg/resvg-js from the project or from a scratch install (npm --no-save). */
function loadResvg() {
  const candidates = ["@resvg/resvg-js", "/tmp/node_modules/@resvg/resvg-js", "/tmp/icons/node_modules/@resvg/resvg-js"];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      /* try the next location */
    }
  }
  throw new Error("Missing rasterizer. Run: npm i --no-save @resvg/resvg-js");
}

/**
 * The whole icon as one SVG string, in a 24-unit viewBox.
 *
 * maskable → full-bleed red with the S shrunk into the safe zone;
 * otherwise → the rounded-square badge itself, transparent corners.
 */
function iconSvg(size, maskable) {
  const scale = maskable ? 0.62 : 1;
  const offset = (24 - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <defs>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${RED_TOP}"/>
      <stop offset="1" stop-color="${RED_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="24" height="24" rx="${maskable ? 0 : 5.4}" fill="url(#red)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${S_PATH}" fill="none" stroke="#ffffff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const { Resvg } = loadResvg();

function render(size, maskable) {
  return new Resvg(iconSvg(size, maskable), { fitTo: { mode: "width", value: size } }).render().asPng();
}

/** A minimal ICO container holding PNG images (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
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
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

mkdirSync(OUT, { recursive: true });

const targets = [
  ["icon.png", 512, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-192.png", 192, true],
  ["icon-maskable-512.png", 512, true],
];

for (const [name, size, maskable] of targets) {
  const png = render(size, maskable);
  writeFileSync(join(OUT, name), png);
  console.log(`wrote public/${name} (${size}×${size}${maskable ? ", maskable" : ""}) · ${png.length} bytes`);
}

const favicon = ico([
  { size: 32, data: render(32, false) },
  { size: 16, data: render(16, false) },
]);
writeFileSync(join(OUT, "favicon.ico"), favicon);
console.log(`wrote public/favicon.ico (32 + 16) · ${favicon.length} bytes`);
