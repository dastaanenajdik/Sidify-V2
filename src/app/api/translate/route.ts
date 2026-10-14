import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/translate — { lines: string[], target: string }
 *   → { success: true, lines: string[], target, source }
 *
 * In-page lyrics translation. Uses the free, key-less public translation
 * endpoint (`translate.googleapis.com/translate_a/single?client=gtx`, the
 * same public API the web translator widgets use) from the server, so the
 * browser never opens another tab and never hits a CORS wall. Lines go up
 * joined with newlines in bounded chunks and come back split the same way,
 * so a synced (timed) lyric keeps its timing — only the words change.
 * Results are memoised in this process for a while: retranslating the same
 * song is a very common second tap.
 */

const MAX_LINES = 400;
const MAX_LINE_LENGTH = 500;
const CHUNK_CHARS = 1600;

const cache = new Map<string, { lines: string[]; source: string; at: number }>();
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 200;

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key: string, value: { lines: string[]; source: string }) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ...value, at: Date.now() });
}

/** Split `lines` into newline-joined chunks of at most ~CHUNK_CHARS. */
function chunkLines(lines: string[]): { text: string; count: number }[] {
  const chunks: { text: string; count: number }[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (buf.length) chunks.push({ text: buf.join("\n"), count: buf.length });
    buf = [];
    size = 0;
  };
  for (const line of lines) {
    if (buf.length && size + line.length + 1 > CHUNK_CHARS) flush();
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks;
}

/** One call to the public endpoint. Returns the translated text + detected source language. */
async function translateChunk(text: string, target: string): Promise<{ text: string; source: string }> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; Sidify/2.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`translate upstream ${res.status}`);
  const data = (await res.json()) as unknown;
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : null;
  if (!segments) throw new Error("translate upstream shape");
  const translated = segments
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""))
    .join("");
  const source = Array.isArray(data) && typeof data[2] === "string" ? data[2] : "";
  return { text: translated, source };
}

/** Fallback public API (MyMemory, key-less) — used only if the first upstream is unreachable. */
async function translateLineFallback(line: string, target: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(line)}&langpair=autodetect|${encodeURIComponent(target)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`translate fallback ${res.status}`);
  const data = (await res.json()) as { responseData?: { translatedText?: string } };
  const text = data.responseData?.translatedText?.trim();
  if (!text) throw new Error("translate fallback shape");
  return text;
}

async function translateLines(lines: string[], target: string): Promise<{ lines: string[]; source: string }> {
  const out: string[] = [];
  let source = "";
  for (const chunk of chunkLines(lines)) {
    let first: { text: string; source: string };
    try {
      first = await translateChunk(chunk.text, target);
    } catch {
      // First upstream unreachable (offline region, blocked host): fall back
      // line by line so the song still translates in place.
      for (const line of chunk.text.split("\n")) {
        out.push(line.trim() ? await translateLineFallback(line, target) : line);
      }
      continue;
    }
    const { text, source: src } = first;
    if (src) source = src;
    const parts = text.split("\n");
    if (parts.length === chunk.count) {
      out.push(...parts);
    } else {
      // The translator merged/split a line break: redo this chunk line by
      // line so the 1:1 line mapping (and the lyric timing) survives.
      for (const line of chunk.text.split("\n")) {
        if (!line.trim()) {
          out.push(line);
          continue;
        }
        const one = await translateChunk(line, target);
        out.push(one.text.replace(/\s*\n\s*/g, " ").trim());
      }
    }
  }
  return { lines: out, source };
}

export async function POST(request: NextRequest) {
  let body: { lines?: unknown; target?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* handled below */
  }
  const targetRaw = typeof body.target === "string" ? body.target.trim() : "";
  const target = targetRaw.split("-")[0]?.toLowerCase() ?? "";
  if (!/^[a-z]{2,3}$/.test(target)) {
    return NextResponse.json({ success: false, message: "A valid target language is required" }, { status: 400 });
  }
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_LINES) {
    return NextResponse.json({ success: false, message: "Lyrics lines are required" }, { status: 400 });
  }
  const lines = body.lines.map((l) => (typeof l === "string" ? l.slice(0, MAX_LINE_LENGTH) : ""));
  if (!lines.some((l) => l.trim())) {
    return NextResponse.json({ success: false, message: "Nothing to translate" }, { status: 400 });
  }

  const key = `${target}\n${lines.join("\n")}`;
  const hit = cacheGet(key);
  if (hit) {
    return NextResponse.json(
      { success: true, lines: hit.lines, target, source: hit.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await translateLines(lines, target);
    cacheSet(key, result);
    return NextResponse.json(
      { success: true, lines: result.lines, target, source: result.source },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Translation is temporarily unavailable. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
