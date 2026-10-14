"use client";

import { useEffect, useState } from "react";

/**
 * Four colours drawn from an artwork, for the mesh backdrop behind the player
 * and the ambience behind pages.
 *
 * The image is fetched through `/api/art` (same origin, so the canvas stays
 * readable), shrunk to 24×24 and quantised. The most populous distinct colours
 * win; dark or monochrome sleeves get their shortfall derived from their own
 * colours rather than borrowed from a stock palette.
 */

export type Palette = [string, string, string, string];

export const FALLBACK_PALETTE: Palette = ["#3a1c71", "#d76d77", "#2b5876", "#ffaf7b"];

const cache = new Map<string, Palette>();
const inflight = new Map<string, Promise<Palette>>();

/* ------------------------------- colour maths ------------------------------ */

type Hsl = [number, number, number];

function rgbToHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex([h, s, l]: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function hexToHsl(hex: string): Hsl {
  const h = hex.replace("#", "");
  return rgbToHsl(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}

/** Boost saturation and clamp lightness so any artwork yields a rich, non-muddy mesh. */
export function tune(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex([h, Math.min(1, s * 1.35), Math.max(0.28, Math.min(0.58, l))]);
}

/** The same hue, almost black — the mesh's base and the album header's fade. */
export function dim(hex: string, lightness = 0.12): string {
  const [h, s] = hexToHsl(hex);
  return hslToHex([h, Math.min(1, s), lightness]);
}

function close(a: Hsl, b: Hsl): boolean {
  const hueGap = Math.min(Math.abs(a[0] - b[0]), 360 - Math.abs(a[0] - b[0]));
  return hueGap < 15 && Math.abs(a[2] - b[2]) < 0.12;
}

/* ------------------------------- extraction -------------------------------- */

function quantise(data: Uint8ClampedArray, clearFilters: boolean): { hex: string; hsl: Hsl; n: number }[] {
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n++;
    } else bins.set(key, { r, g, b, n: 1 });
  }
  const out: { hex: string; hsl: Hsl; n: number }[] = [];
  for (const bin of bins.values()) {
    const r = bin.r / bin.n;
    const g = bin.g / bin.n;
    const b = bin.b / bin.n;
    const hsl = rgbToHsl(r, g, b);
    if (!clearFilters && (hsl[2] < 0.08 || hsl[2] > 0.93 || hsl[1] < 0.08)) continue;
    out.push({ hex: hslToHex(hsl), hsl, n: bin.n });
  }
  return out.sort((a, b) => b.n - a.n);
}

function paletteOf(data: Uint8ClampedArray): Palette {
  let found = quantise(data, false);
  if (found.length === 0) found = quantise(data, true);
  const kept: { hex: string; hsl: Hsl }[] = [];
  for (const c of found) {
    if (!kept.some((k) => close(k.hsl, c.hsl))) kept.push(c);
    if (kept.length >= 4) break;
  }
  if (kept.length === 0) return FALLBACK_PALETTE;
  const base = kept.length;
  let step = 1;
  while (kept.length < 4) {
    const src = kept[(kept.length - base) % base].hsl;
    const hsl: Hsl = [(src[0] + 24 * step) % 360, src[1], Math.max(0.2, Math.min(0.7, src[2] + 0.12 * step))];
    kept.push({ hex: hslToHex(hsl), hsl });
    step++;
  }
  return kept.slice(0, 4).map((k) => k.hex) as Palette;
}

/** A small rendition of the artwork, fetched through our own proxy. */
export function proxiedArt(url: string, size = 96): string {
  let small = url;
  const yt = url.match(/i\d?\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//);
  if (yt) small = `https://i.ytimg.com/vi/${yt[1]}/${size > 200 ? "hqdefault" : "mqdefault"}.jpg`;
  else if (/googleusercontent\.com|ggpht\.com/.test(url)) small = `${url.replace(/=[^/]*$/, "")}=w${size}-h${size}-l90-rj`;
  return `/api/art?u=${encodeURIComponent(small)}`;
}

export function extractPalette(url: string): Promise<Palette> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(url);
  if (running) return running;
  const job = new Promise<Palette>((resolve) => {
    if (typeof window === "undefined" || !url) return resolve(FALLBACK_PALETTE);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const done = (p: Palette) => {
      cache.set(url, p);
      inflight.delete(url);
      resolve(p);
    };
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(FALLBACK_PALETTE);
        // Video thumbnails are 16:9 — sample the centre square, like the tiles show.
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, 24, 24);
        done(paletteOf(ctx.getImageData(0, 0, 24, 24).data));
      } catch {
        done(FALLBACK_PALETTE);
      }
    };
    img.onerror = () => {
      inflight.delete(url);
      resolve(FALLBACK_PALETTE);
    };
    img.src = proxiedArt(url);
  });
  inflight.set(url, job);
  return job;
}

/** Raw (untuned) palette for an artwork; the fallback while it loads. */
export function usePalette(url: string | null | undefined, enabled = true): Palette {
  const [state, setState] = useState<{ url: string; palette: Palette } | null>(null);
  useEffect(() => {
    if (!url || !enabled) return;
    let alive = true;
    void extractPalette(url).then((palette) => {
      if (alive) setState({ url, palette });
    });
    return () => {
      alive = false;
    };
  }, [url, enabled]);
  if (!url || !enabled) return FALLBACK_PALETTE;
  if (state?.url === url) return state.palette;
  return cache.get(url) ?? FALLBACK_PALETTE;
}
