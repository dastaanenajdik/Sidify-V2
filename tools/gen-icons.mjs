/**
 * Sidify PWA icon generator.
 *
 * Draws the same mark as `src/components/SidifyLogo.tsx` — a neon "S" fused with
 * three equalizer bars on the near-black brand background — and writes every PNG
 * the manifest + service worker ask for:
 *
 *   public/icon.png                512  (favicon / artwork fallback)
 *   public/icon-192.png            192  (any)
 *   public/icon-512.png            512  (any)
 *   public/icon-maskable-192.png   192  (maskable — content inside the 40% safe circle)
 *   public/icon-maskable-512.png   512  (maskable)
 *   public/favicon.ico             32   (classic tab icon)
 *
 * Run (needs the rasterizer, not a project dependency on purpose):
 *   npm i --no-save @resvg/resvg-js && node tools/gen-icons.mjs
 *
 * Re-run this whenever the brand accent or the mark changes; the PNGs are committed
 * so normal builds never need the generator.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

/** Brand palette — mirrors the defaults in globals.css + store/settings.ts. */
const ACCENT = "#00E676";
const BG_TOP = "#14141f";
const BG_BOTTOM = "#050509";

/** Loads @resvg/resvg-js from the project or from a scratch install (npm --no-save). */
function loadResvg() {
  const candidates = ["@resvg/resvg-js", "/tmp/node_modules/@resvg/resvg-js"];
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
 * The whole icon as one SVG string.
 *
 * @param size     output pixel size (square)
 * @param maskable true → full-bleed background + mark shrunk into the safe zone;
 *                 false → rounded-square badge with the mark filling more of it.
 */
function iconSvg(size, maskable) {
  // The mark itself is authored in the logo's own 64×64 space, then placed with a
  // scale + translate so both variants stay pixel-consistent.
  const scale = maskable ? 0.66 : 0.84;
  const offset = (64 - 64 * scale) / 2; // centres the scaled group
  const radius = maskable ? 0 : 128; // maskable must bleed to the edges

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="glow" cx="256" cy="228" r="250" gradientUnits="userSpaceOnUse">
      <stop stop-color="${ACCENT}" stop-opacity="0.30"/>
      <stop offset="0.55" stop-color="${ACCENT}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="neon" x1="10" y1="58" x2="54" y2="6" gradientUnits="userSpaceOnUse">
      <stop stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT}" stop-opacity="0.72"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#glow)"/>
  ${
    maskable
      ? ""
      : `<rect x="3" y="3" width="506" height="506" rx="${radius - 2}" fill="none"
           stroke="#ffffff" stroke-opacity="0.10" stroke-width="4"/>`
  }

  <g transform="translate(${offset * 8} ${offset * 8}) scale(${scale * 8})">
    <text x="32" y="40" text-anchor="middle" font-family="DejaVu Sans" font-size="33"
          font-weight="bold" fill="url(#neon)">S</text>
    <!-- Equalizer trio: baseline-aligned at y=52, centred on the 64-box axis. -->
    <rect x="22.5" y="45" width="4" height="7" rx="2" fill="url(#neon)"/>
    <rect x="30" y="40" width="4" height="12" rx="2" fill="url(#neon)"/>
    <rect x="37.5" y="43" width="4" height="9" rx="2" fill="url(#neon)"/>
  </g>
</svg>`;
}

const { Resvg } = loadResvg();

function render(size, maskable) {
  const resvg = new Resvg(iconSvg(size, maskable), {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
    background: "#06060a",
  });
  return resvg.render().asPng();
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

console.log("icons done — favicon.ico is derived from icon-192.png (see the header comment)");

/* favicon.ico (32 + 16) is derived from the 192 png with ImageMagick, because ICO is not
 * something resvg can write:
 *   convert public/icon-192.png -resize 32x32 /tmp/fav32.png
 *   convert /tmp/fav32.png -define icon:auto-resize=32,16 public/favicon.ico
 */
