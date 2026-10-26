#!/usr/bin/env node
/**
 * QA Dots probe runner — the executable half of the tester personalities in
 * `testing/dots/` (OpenDots Specialist Dot format; see testing/dots/README.md).
 *
 * Each Dot has a human checklist in its `instructions`; the checks below are
 * the deterministic subset that can run without a browser: page/API contracts,
 * chaos inputs, cache headers, titles/meta, PWA shell and media error shapes.
 * Upstreams (YouTube, film providers, …) may be unreachable from a sandbox or
 * CI box, so checks that depend on them assert the *contract* (JSON, error
 * code, sane status) rather than live data.
 *
 * Usage:
 *   npm run build && npm run start        # or any running deploy
 *   node scripts/qa-dots.mjs              # defaults to http://localhost:3000
 *   QA_BASE_URL=https://your-deploy node scripts/qa-dots.mjs
 *
 * Only invalid writes are sent (malformed JSON etc.), so running this against
 * production cannot create playlists/rooms or alter a library. Exit code is
 * 1 when any check fails.
 */

const BASE = (process.env.QA_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.QA_TIMEOUT_MS || 20_000);

let pass = 0;
const failures = [];

function check(dot, name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${dot}: ${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(path, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual", signal: ctrl.signal, ...init });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      bytes: buf.length,
      text: buf.toString("utf8"),
      ms: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

function jsonOf(r) {
  try {
    return JSON.parse(r.text);
  } catch {
    return undefined;
  }
}
const isJson = (r) => jsonOf(r) !== undefined && !(r.headers.get("content-type") || "").includes("text/html");

function section(title) {
  console.log(`\n## ${title}`);
}

/* ------------------------------------------------ Aarav — first visit --- */
async function aarav() {
  const dot = "Aarav";
  section("Aarav — First-time Mobile Listener (golden paths)");
  for (const p of ["/", "/app", "/movies", "/series", "/exclusive", "/explore", "/search", "/library", "/downloads", "/rooms", "/settings"]) {
    const r = await req(p);
    check(dot, `GET ${p}`, r.status === 200 && r.text.includes("<title>"), `${r.status}, ${r.ms}ms, ${(r.bytes / 1024).toFixed(0)}KB`);
  }
  const notFound = await req("/totally-unknown-route-qa");
  check(dot, "unknown page is a real 404", notFound.status === 404, `got ${notFound.status}`);
  const get = await req("/get");
  check(
    dot,
    "/get redirects to the latest APK",
    get.status >= 300 && get.status < 400 && (get.headers.get("location") || "").endsWith("releases/latest/download/app-release.apk"),
    `${get.status} -> ${get.headers.get("location")}`
  );
}

/* ------------------------------------------- Meera — library contracts --- */
async function meera() {
  const dot = "Meera";
  section("Meera — Power Listener & Curator (library contracts)");
  const reads = [
    ["/api/playlists", "playlists"],
    ["/api/library/liked", "tracks"],
    ["/api/library/recent", "tracks"],
    ["/api/library/followed", "artists"],
    ["/api/library/blocked", "artists"],
    ["/api/downloads", "downloads"],
  ];
  for (const [p, key] of reads) {
    const r = await req(p);
    const body = jsonOf(r);
    check(dot, `GET ${p} → {${key}: []}`, r.status === 200 && Array.isArray(body?.[key]), `${r.status}`);
  }
}

/* ------------------------------------------------ Kabir — chaos --- */
async function kabir() {
  const dot = "Kabir";
  section("Kabir — Chaos & Security Tester (nothing may 500 on bad input)");
  const writers = [
    ["POST", "/api/playlists"],
    ["POST", "/api/playlists/1"],
    ["PATCH", "/api/playlists/1"],
    ["POST", "/api/downloads"],
    ["POST", "/api/library/liked"],
    ["POST", "/api/library/recent"],
    ["POST", "/api/library/followed"],
    ["POST", "/api/library/blocked"],
    ["POST", "/api/library/restore"],
  ];
  for (const badBody of ["{bad json", "null", "[1,2,3]", '"text"', ""]) {
    for (const [method, p] of writers) {
      const r = await req(p, { method, headers: { "content-type": "application/json" }, body: badBody });
      check(dot, `${method} ${p} body=${badBody || "(empty)"}`, r.status === 400 && isJson(r), `${r.status}`);
    }
  }
  const unknown = await req("/api/definitely-not-a-route");
  check(dot, "unknown /api/* is JSON 404 (not HTML)", unknown.status === 404 && isJson(unknown) && unknown.bytes < 1024, `${unknown.status}, ${unknown.bytes}B`);
  // Next first normalises the trailing slash (308 → /api/album); the end of
  // that hop must be the JSON 404, not the HTML shell.
  const slash = await req("/api/album/", { redirect: "follow" });
  check(dot, "trailing-slash /api/album/ ends on JSON 404", slash.status === 404 && isJson(slash), `${slash.status}`);
  const ssrf1 = await req(`/api/art?u=${encodeURIComponent("http://127.0.0.1:3000/api/health")}`);
  check(dot, "/api/art refuses 127.0.0.1", ssrf1.status >= 400 && ssrf1.status < 500, `${ssrf1.status}`);
  const ssrf2 = await req(`/api/media/stream?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data")}`);
  check(dot, "/api/media/stream refuses metadata IP", ssrf2.status >= 400 && ssrf2.status < 500, `${ssrf2.status}`);
  const huge = await req(`/api/search?q=${"a".repeat(5000)}`);
  check(dot, "5000-char search query does not 500", huge.status !== 500 && isJson(huge), `${huge.status}`);
  const radio = await req("/api/radio?video_id=not-a-real-id!!");
  check(dot, "junk radio video_id answers without 500", radio.status === 200 && jsonOf(radio)?.success === true, `${radio.status}, ${radio.ms}ms`);
  const qr = await req("/api/qr?size=99999&format=bmp");
  check(dot, "QR params are clamped, still an image", qr.status === 200 && (qr.headers.get("content-type") || "").startsWith("image/"), `${qr.status}`);
}

/* ------------------------------------------------ Ira — performance --- */
async function ira() {
  const dot = "Ira";
  section("Ira — Performance Hawk (caching & weight)");
  for (const p of ["/icon-192.png", "/icon.png", "/favicon.ico", "/covers/phonk-funk.jpg"]) {
    const r = await req(p, { method: "HEAD" });
    const cc = r.headers.get("cache-control") || "";
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] || 0);
    check(dot, `${p} cached ≥ 1 day`, r.status === 200 && maxAge >= 86400, `cache-control: ${cc}`);
  }
  const qr = await req("/api/qr?size=128");
  check(dot, "/api/qr is CDN-cacheable", /s-maxage=\d+/.test(qr.headers.get("cache-control") || ""), qr.headers.get("cache-control") || "(none)");
  const home = await req("/");
  const chunks = [...new Set([...home.text.matchAll(/\/_next\/static\/[^"]+\.js/g)].map((m) => m[0]))];
  check(dot, "home references build chunks", chunks.length > 0, `${chunks.length} JS files`);
  if (chunks[0]) {
    const c = await req(chunks[0], { method: "HEAD" });
    const cc = c.headers.get("cache-control") || "";
    check(dot, "_next/static chunk is long-cached", /immutable|max-age=31536000/.test(cc), cc);
  }
}

/* ------------------------------------------- Dev — accessibility & SEO --- */
async function dev() {
  const dot = "Dev";
  section("Dev — Accessibility & SEO Auditor (titles & meta)");
  const expected = [
    ["/search", "Search · Sidify"],
    ["/settings", "Settings · Sidify"],
    ["/explore", "Explore · Sidify"],
    ["/downloads", "Downloads · Sidify"],
    ["/rooms", "Listen Together · Sidify"],
    ["/library", "Library · Sidify"],
    ["/library/liked", "Liked Songs · Sidify"],
    ["/movies", "Movies · Sidify"],
    ["/series", "Series · Sidify"],
  ];
  for (const [p, title] of expected) {
    const r = await req(p);
    check(dot, `${p} title is "${title}"`, r.text.includes(`<title>${title}</title>`));
  }
  const home = await req("/");
  check(dot, "html has lang + meta description", /<html lang="en"/.test(home.text) && home.text.includes('name="description"'));
  const devPage = await req("/dev/lyrics-sync");
  check(dot, "dev playground is noindex", /noindex/.test(devPage.text), `${devPage.status}`);
}

/* ------------------------------------------- Zoya — offline / repeat --- */
async function zoya() {
  const dot = "Zoya";
  section("Zoya — Slow-Network & Offline User (PWA shell)");
  const sw = await req("/sw.js");
  check(dot, "/sw.js served fresh (max-age=0)", sw.status === 200 && /max-age=0/.test(sw.headers.get("cache-control") || ""), sw.headers.get("cache-control") || "(none)");
  const manifest = await req("/manifest.json");
  const m = jsonOf(manifest);
  check(dot, "manifest is valid with icons", manifest.status === 200 && Array.isArray(m?.icons) && m.icons.length >= 4);
  for (const icon of m?.icons || []) {
    const r = await req(icon.src, { method: "HEAD" });
    check(dot, `manifest icon ${icon.src}`, r.status === 200, `${r.status}`);
  }
}

/* ------------------------------------------- Rian — media contracts --- */
async function rian() {
  const dot = "Rian";
  section("Rian — Movies & Series Viewer (media error shapes)");
  for (const p of ["/api/media/browse?type=movie", "/api/media/search?q=test", "/api/media/exclusive"]) {
    const r = await req(p);
    const okShape = r.status === 200 ? jsonOf(r) !== undefined : typeof jsonOf(r)?.error === "string";
    check(dot, `GET ${p} is JSON (200 or coded error)`, isJson(r) && okShape && r.status !== 500, `${r.status}, ${r.ms}ms`);
  }
  const badType = await req("/api/media/title/badtype/x");
  check(dot, "unknown media type is 400 JSON", badType.status === 400 && isJson(badType), `${badType.status}`);
  // A relay token carries the manifest URL and its directory; anything after the token
  // is a DASH segment resolved against that directory (and must stay inside it).
  const relayToken = Buffer.from(
    JSON.stringify({
      u: "https://sbcdn3.hakunaymatata.com/dash/1/index.mpd",
      b: "https://sbcdn3.hakunaymatata.com/dash/1/",
    })
  ).toString("base64url");

  const traversal = await req(`/api/media/vault-stream/${relayToken}/..%2F..%2Fsecret.m4s`);
  check(
    dot,
    "the stream relay refuses a segment that escapes the manifest folder",
    traversal.status === 400 && isJson(traversal),
    `${traversal.status}`
  );

  const segment = await req(`/api/media/vault-stream/${relayToken}/1_video_1.m4s`);
  check(
    dot,
    "a segment below the token resolves instead of being rejected as malformed",
    segment.status !== 400,
    `${segment.status}`
  );

  const noUrl = await req("/api/media/stream");
  check(dot, "media stream without url is 400 JSON", noUrl.status === 400 && isJson(noUrl), `${noUrl.status}`);
}

/* --------------------------------------- Naina — exclusive section --- */
async function naina() {
  const dot = "Naina";
  section("Naina — Exclusive Binger (collection contracts)");

  const page = await req("/exclusive");
  check(
    dot,
    "GET /exclusive renders the section",
    page.status === 200 && page.text.includes("Exclusive") && page.text.includes("<title>"),
    `${page.status}, ${page.ms}ms, ${(page.bytes / 1024).toFixed(0)}KB`
  );

  const home = await req("/api/media/exclusive?mode=home");
  const homeBody = jsonOf(home);
  const homeOk =
    home.status === 200
      ? homeBody?.mode === "home" && Array.isArray(homeBody?.rails) && Array.isArray(homeBody?.facets?.genres)
      // An upstream outage is a coded 502/503, never a bare 500 and never HTML.
      : home.status !== 500 && typeof homeBody?.error === "string";
  check(dot, "home payload is a spotlight + rails contract (or a coded error)", isJson(home) && homeOk, `${home.status}, ${home.ms}ms`);

  const search = await req("/api/media/exclusive?mode=search&q=love&type=movie&sort=rating&page=1&limit=5");
  const searchBody = jsonOf(search);
  const searchOk =
    search.status === 200
      ? Array.isArray(searchBody?.items) && typeof searchBody?.totalPages === "number" && Array.isArray(searchBody?.facets?.genres)
      : typeof searchBody?.error === "string";
  check(dot, "search page returns items, page and facets", isJson(search) && searchOk, `${search.status}`);

  const capped = await req("/api/media/exclusive?mode=search&limit=9999");
  const cappedBody = jsonOf(capped);
  check(
    dot,
    "page size is capped at 60",
    isJson(capped) && (capped.status === 200 ? (cappedBody?.pageSize ?? 0) <= 60 : typeof cappedBody?.error === "string"),
    `${capped.status}`
  );

  const huge = await req(`/api/media/exclusive?q=${"a".repeat(5000)}`);
  check(dot, "a 5000-char query does not 500", huge.status !== 500 && isJson(huge), `${huge.status}`);

  const junkSort = await req("/api/media/exclusive?mode=search&sort=not-a-sort");
  check(dot, "an unknown sort falls back instead of failing", junkSort.status !== 500 && isJson(junkSort), `${junkSort.status}`);

  const suggest = await req("/api/media/exclusive/suggest?q=lo");
  check(dot, "suggest returns {items: []}", isJson(suggest) && Array.isArray(jsonOf(suggest)?.items), `${suggest.status}`);

  const missing = await req("/api/media/exclusive/title/%20");
  check(dot, "a blank slug is a JSON 400", missing.status === 400 && isJson(missing), `${missing.status}`);

  const unknown = await req("/api/media/exclusive/title/vault-1-not-a-title");
  check(
    dot,
    "an unknown exclusive title is JSON 404 or a coded upstream error",
    isJson(unknown) && (unknown.status === 404 || (unknown.status >= 400 && typeof jsonOf(unknown)?.error === "string")),
    `${unknown.status}`
  );

  const headers = home.headers.get("cache-control") || "";
  check(
    dot,
    "the landing payload is CDN-cacheable when it succeeds",
    home.status !== 200 || /s-maxage=\d+/.test(headers),
    headers || "(none)"
  );

  /* --- the browser-direct transport (see docs/exclusive-collection.md) --- */

  // Each probe comes from its own forwarded address: the ticket route is
  // rate-limited per caller, and a QA run must not exhaust one bucket.
  const asCaller = (address) => ({ "x-forwarded-for": `198.18.${address}.1` });

  const emptyTicket = await req("/api/media/exclusive/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...asCaller(1) },
    body: JSON.stringify({ calls: [] }),
  });
  check(dot, "an empty ticket batch is a JSON 400", emptyTicket.status === 400 && isJson(emptyTicket), `${emptyTicket.status}`);

  const forged = await req("/api/media/exclusive/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...asCaller(2) },
    body: JSON.stringify({ calls: [{ kind: "home", url: "https://evil.test/collect", path: "/etc/passwd" }] }),
  });
  const forgedBody = jsonOf(forged);
  const forgedOk =
    forged.status !== 500 &&
    isJson(forged) &&
    (forged.status === 200
      ? Array.isArray(forgedBody?.calls) &&
        forgedBody.calls.length > 0 &&
        forgedBody.calls.every((call) => typeof call?.url === "string" && !call.url.includes("evil.test") && !call.url.includes("/etc/passwd"))
      : typeof forgedBody?.error === "string");
  check(dot, "the ticket is never an open signing oracle (no caller-supplied URL)", forgedOk, `${forged.status}`);

  const loginTicket = await req("/api/media/exclusive/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...asCaller(4) },
    body: JSON.stringify({ calls: [{ kind: "login" }] }),
  });
  const loginBody = jsonOf(loginTicket);
  check(
    dot,
    "a login ticket is signed without needing upstream reachability",
    loginTicket.status === 200 || (loginTicket.status === 503 && loginBody?.code === "ticket_unavailable"),
    `${loginTicket.status}`
  );
  if (loginTicket.status === 200) {
    const loginCall = Array.isArray(loginBody?.calls) ? loginBody.calls[0] : null;
    check(
      dot,
      "the login ticket carries a signature but no credential",
      Boolean(loginCall?.["x-tr-signature"] || loginCall?.headers?.["x-tr-signature"]) && !loginCall?.headers?.authorization,
      loginCall?.id || "(none)"
    );
  }

  const oversized = await req("/api/media/exclusive/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...asCaller(3) },
    body: JSON.stringify({ calls: Array.from({ length: 12 }, () => ({ kind: "home" })) }),
  });
  check(dot, "an oversized ticket batch is a JSON 400", oversized.status === 400 && isJson(oversized), `${oversized.status}`);

  const ticketSecrets = /MEDIA_VAULT|hmac|secret/i.test(forged.text) || /MEDIA_VAULT|hmac/i.test(emptyTicket.text);
  check(dot, "a ticket never echoes a secret", !ticketSecrets);
  const ticketCache = forged.headers.get("cache-control") || "";
  check(
    dot,
    "a ticket is never cacheable",
    forged.status !== 200 || /no-store/.test(ticketCache),
    ticketCache || "(none)"
  );

  // Stream resolution is client-side now: the old server hop must be gone, and
  // its absence must still be a JSON answer rather than an HTML 404 page.
  const playback = await req("/api/media/exclusive/playback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "vault-101-night-train" }),
  });
  check(
    dot,
    "no server-side playback-resolution route is left",
    playback.status === 404 && isJson(playback),
    `${playback.status}`
  );

  const ticketKinds = await req("/api/media/exclusive/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...asCaller(5) },
    // A browser token is what a real client sends after logging in itself, and
    // it is what lets this probe exercise signing with no upstream access at all.
    body: JSON.stringify({
      key: "qadots-browser-1",
      token: "qa-browser-token-0001",
      calls: [
        { kind: "detail", subjectId: "101" },
        { kind: "playback", subjectId: "101" },
        { kind: "resource", subjectId: "101" },
      ],
    }),
  });
  const ticketKindsBody = jsonOf(ticketKinds);
  check(
    dot,
    "detail + playback + resource are signed in one batch",
    ticketKinds.status === 200
      ? Array.isArray(ticketKindsBody?.calls) &&
        ticketKindsBody.calls.some((call) => call.kind === "playback") &&
        ticketKindsBody.calls.some((call) => call.kind === "detail") &&
        ticketKindsBody.calls.some((call) => call.kind === "resource")
      : typeof ticketKindsBody?.error === "string" && ticketKinds.status !== 500,
    `${ticketKinds.status}`
  );
}

/* ----------------------------------- Ved — audio & picture sync --- */
async function ved() {
  const dot = "Ved";
  section("Ved — Audio & Picture Sync Inspector (playback contracts)");

  const probe = await req("/api/media/exclusive/title/vault-1-not-a-title");
  const body = jsonOf(probe);
  const detail = body?.detail;
  const playbackOk =
    probe.status !== 200
      ? typeof body?.error === "string"
      : Array.isArray(detail?.playback) &&
        detail.playback.every(
          (source) =>
            typeof source?.url === "string" &&
            source.url.startsWith("https://") &&
            ["dash", "hls", "mp4", "webm"].includes(source.type)
        ) &&
        Array.isArray(detail?.playback) === true;
  check(dot, "playback sources are typed, absolute and browser-playable", isJson(probe) && playbackOk, `${probe.status}`);

  const mkv = body?.detail?.playback?.find((source) => /\.mkv($|\?)/i.test(source.url)) || null;
  check(dot, "no MKV is ever offered as a browser stream", mkv === null, mkv ? mkv.url : "none");

  const audioShape =
    probe.status !== 200 ||
    (Array.isArray(detail?.title?.audioLanguages) &&
      (typeof detail?.title?.quality === "string" || detail?.title?.quality === undefined));
  check(dot, "title payload carries optional audio/quality metadata", audioShape, `${probe.status}`);

  const badToken = await req("/api/media/vault-stream/not-a-token");
  check(dot, "the stream relay rejects an invalid token with JSON", badToken.status === 400 && isJson(badToken), `${badToken.status}`);

  const crossSite = await req("/api/media/vault-stream/not-a-token", { headers: { "sec-fetch-site": "cross-site" } });
  check(dot, "the stream relay refuses cross-site hotlinking", crossSite.status === 403 && isJson(crossSite), `${crossSite.status}`);

  // A relay token carries the manifest URL and its directory; anything after the token
  // is a DASH segment resolved against that directory (and must stay inside it).
  const relayToken = Buffer.from(
    JSON.stringify({
      u: "https://sbcdn3.hakunaymatata.com/dash/1/index.mpd",
      b: "https://sbcdn3.hakunaymatata.com/dash/1/",
    })
  ).toString("base64url");

  const traversal = await req(`/api/media/vault-stream/${relayToken}/..%2F..%2Fsecret.m4s`);
  check(
    dot,
    "the stream relay refuses a segment that escapes the manifest folder",
    traversal.status === 400 && isJson(traversal),
    `${traversal.status}`
  );

  const segment = await req(`/api/media/vault-stream/${relayToken}/1_video_1.m4s`);
  check(
    dot,
    "a segment below the token resolves instead of being rejected as malformed",
    segment.status !== 400,
    `${segment.status}`
  );

  const noUrl = await req("/api/media/stream");
  check(dot, "the generic stream proxy rejects a missing url", noUrl.status === 400 && isJson(noUrl), `${noUrl.status}`);
}

console.log(`QA Dots against ${BASE}`);
for (const run of [aarav, meera, kabir, ira, dev, zoya, rian, naina, ved]) {
  try {
    await run();
  } catch (e) {
    failures.push(`${run.name} aborted: ${e?.message || e}`);
    console.log(`  FAIL ${run.name} aborted — ${e?.message || e}`);
  }
}
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
