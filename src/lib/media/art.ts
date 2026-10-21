/**
 * Deterministic poster / backdrop artwork.
 *
 * Licensed providers send real image URLs (`poster`, `backdrop`); the demo catalogue
 * and any title missing artwork get a generated SVG instead — so a card never shows a
 * broken image and no placeholder is fetched from a third party. Everything here is
 * computed from the seed, which keeps server and client renders identical.
 */

export type ArtRatio = "poster" | "backdrop" | "still";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToHue(hex: string | undefined): number | null {
  if (!hex) return null;
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const dims: Record<ArtRatio, { w: number; h: number }> = {
  poster: { w: 400, h: 600 },
  backdrop: { w: 1200, h: 675 },
  still: { w: 640, h: 360 },
};

/**
 * The picture to draw for a title: the provider's own URL when it has one,
 * otherwise generated art. Safe to call during the server render.
 */
export function mediaArt(
  src: string | null | undefined,
  opts: { seed: string; accent?: string; ratio?: ArtRatio }
): string {
  if (src) return src;
  return generatedArt(opts);
}

export function generatedArt({ seed, accent, ratio = "poster" }: { seed: string; accent?: string; ratio?: ArtRatio }): string {
  const { w, h } = dims[ratio];
  const n = hash(seed || "sidify");
  const baseHue = hexToHue(accent) ?? n % 360;
  const hue2 = (baseHue + 34 + (n % 70)) % 360;
  const hue3 = (baseHue + 320) % 360;
  const tilt = 24 + (n % 40);
  const cx1 = 18 + ((n >> 3) % 44);
  const cy1 = 12 + ((n >> 7) % 34);
  const cx2 = 52 + ((n >> 11) % 40);
  const cy2 = 58 + ((n >> 13) % 30);
  const ringX = 26 + ((n >> 17) % 52);
  const ringY = 34 + ((n >> 19) % 46);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="presentation">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.85" y2="1">
<stop offset="0" stop-color="hsl(${baseHue} 46% 30%)"/>
<stop offset="0.55" stop-color="hsl(${hue2} 38% 18%)"/>
<stop offset="1" stop-color="hsl(${hue3} 44% 7%)"/>
</linearGradient>
<radialGradient id="r1" cx="${cx1 / 100}" cy="${cy1 / 100}" r="0.75">
<stop offset="0" stop-color="hsl(${baseHue} 82% 62%)" stop-opacity="0.55"/>
<stop offset="1" stop-color="hsl(${baseHue} 82% 62%)" stop-opacity="0"/>
</radialGradient>
<radialGradient id="r2" cx="${cx2 / 100}" cy="${cy2 / 100}" r="0.6">
<stop offset="0" stop-color="hsl(${hue2} 78% 56%)" stop-opacity="0.4"/>
<stop offset="1" stop-color="hsl(${hue2} 78% 56%)" stop-opacity="0"/>
</radialGradient>
<linearGradient id="v" x1="0" y1="0.35" x2="0" y2="1">
<stop offset="0" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#000" stop-opacity="0.55"/>
</linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<rect width="${w}" height="${h}" fill="url(#r1)"/>
<rect width="${w}" height="${h}" fill="url(#r2)"/>
<g stroke="hsl(${baseHue} 90% 78%)" stroke-opacity="0.12" fill="none" transform="rotate(${tilt} ${w / 2} ${h / 2})">
<path d="M ${-w} ${h * 0.68} L ${w * 2} ${h * 0.42}" stroke-width="${Math.max(1, w / 260)}"/>
<path d="M ${-w} ${h * 0.76} L ${w * 2} ${h * 0.5}" stroke-width="${Math.max(1, w / 420)}"/>
</g>
<g fill="none" stroke="hsl(${baseHue} 95% 88%)" stroke-opacity="0.1" stroke-width="${Math.max(1, w / 300)}">
<circle cx="${(ringX / 100) * w}" cy="${(ringY / 100) * h}" r="${Math.min(w, h) * 0.3}"/>
<circle cx="${(ringX / 100) * w}" cy="${(ringY / 100) * h}" r="${Math.min(w, h) * 0.44}"/>
</g>
<rect width="${w}" height="${h}" fill="url(#v)"/>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
