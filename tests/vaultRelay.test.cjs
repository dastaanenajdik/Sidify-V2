const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

/**
 * The signed-stream relay, exercised against a stand-in for the CDN: a DASH manifest,
 * a segment and the headers the CDN expects to receive.
 *
 * The relay only talks to allowlisted CDN hosts over https, so the transport is
 * injected: the host stays an allowlisted CDN name while `fetchImpl` and `dnsLookup`
 * point at a local server.
 */
const moduleCache = new Map();

function loadTs(targetPath) {
  const filename = path.resolve(__dirname, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return loadTs(candidateTs);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const S = loadTs('../src/lib/media/vaultStream.ts');

const RELAY_HEADERS = [
  ["Cookie", "CloudFront-Policy=abc"],
  ["Referer", "https://sportslive.wine"],
  ["User-Agent", "TestAgent/1.0"],
];

/** The allowlisted CDN host the relay is permitted to reach. */
const CDN_HOST = "sbcdn3.hakunaymatata.com";

/** A stand-in CDN serving a DASH manifest and one segment. */
function createFakeCdn(seen) {
  return async (url, init) => {
    const parsed = new URL(url);
    seen.push({
      url: parsed.pathname,
      cookie: init.headers.get("cookie"),
      referer: init.headers.get("referer"),
      userAgent: init.headers.get("user-agent"),
      range: init.headers.get("range"),
    });

    if (parsed.pathname === "/dash/1/index.mpd") {
      return new Response(
        '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>' +
          "<BaseURL>https://cdn.example.com/dash/1/</BaseURL>" +
          '<AdaptationSet><SegmentTemplate media="$Number$.m4s"/></AdaptationSet>' +
          "</Period></MPD>",
        { status: 200, headers: { "content-type": "application/dash+xml" } }
      );
    }
    if (parsed.pathname === "/dash/1/1.m4s") {
      return new Response(Buffer.from("SEGMENT-BYTES"), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

/** The relay's dependency bundle: an injected transport and a public DNS answer. */
function deps(seen) {
  return {
    fetchImpl: createFakeCdn(seen),
    dnsLookup: async () => [{ address: "104.21.58.178", family: 4 }],
  };
}

test("the relay forwards the signed cookie and referer upstream", async () => {
  const seen = [];
  const result = await S.fetchVaultStream(
    `https://${CDN_HOST}/dash/1/index.mpd`,
    RELAY_HEADERS,
    null,
    deps(seen)
  );

  assert.equal(result.status, 200);
  const manifest = await new Response(result.body).text();
  assert.ok(manifest.includes("<MPD"));

  assert.equal(seen[0].cookie, "CloudFront-Policy=abc");
  assert.equal(seen[0].referer, "https://sportslive.wine");
  assert.equal(seen[0].userAgent, "TestAgent/1.0");
});

test("the relay forwards the Range header so the player can seek", async () => {
  const seen = [];
  await S.fetchVaultStream(`https://${CDN_HOST}/dash/1/1.m4s`, RELAY_HEADERS, "bytes=0-6", deps(seen));
  assert.equal(seen[0].range, "bytes=0-6");
});

test("a manifest's base is rewritten so its segments are relayed too", async () => {
  const seen = [];
  const result = await S.fetchVaultStream(
    `https://${CDN_HOST}/dash/1/index.mpd`,
    RELAY_HEADERS,
    null,
    deps(seen)
  );
  const manifest = await new Response(result.body).text();

  const rewritten = S.rewriteDashManifest(manifest, "https://site.test/api/media/vault-stream/TOK");
  const base = rewritten.match(/<BaseURL>([^<]+)<\/BaseURL>/)[1];

  assert.ok(base.startsWith("https://site.test/api/media/vault-stream/TOK"));
  assert.ok(!base.includes("cdn.example.com"), "the CDN base must be replaced");

  // The player requests the segment relative to that base; the relay resolves it
  // against the manifest's own directory on the CDN.
  const segmentPath = base.slice("https://site.test/api/media/vault-stream/TOK/".length);
  assert.equal(segmentPath, "");
  const resolved = S.resolveVaultSegmentUrl(`https://${CDN_HOST}/dash/1/`, "1.m4s");
  assert.equal(resolved, `https://${CDN_HOST}/dash/1/1.m4s`);

  const segment = await S.fetchVaultStream(resolved, RELAY_HEADERS, null, deps(seen));
  const bytes = Buffer.from(await new Response(segment.body).arrayBuffer());
  assert.equal(bytes.toString(), "SEGMENT-BYTES");
});

test("the relay refuses hosts that are not on the allowlist", async () => {
  const seen = [];
  await assert.rejects(
    () => S.fetchVaultStream("https://evil.example.com/a.mp4", RELAY_HEADERS, null, deps(seen)),
    (error) => error.code === "disallowed_host"
  );
  assert.equal(seen.length, 0, "no request may be made for a disallowed host");
});

test("the relay refuses plain http and credentialed URLs", async () => {
  const seen = [];
  await assert.rejects(
    () => S.fetchVaultStream(`http://${CDN_HOST}/a.mp4`, RELAY_HEADERS, null, deps(seen)),
    (error) => error.code === "insecure_protocol"
  );
  await assert.rejects(
    () => S.fetchVaultStream(`https://user:pw@${CDN_HOST}/a.mp4`, RELAY_HEADERS, null, deps(seen)),
    (error) => error.code === "disallowed_host"
  );
});

test("the relay refuses a host that resolves to a private address", async () => {
  const seen = [];
  await assert.rejects(
    () =>
      S.fetchVaultStream(`https://${CDN_HOST}/a.mp4`, RELAY_HEADERS, null, {
        fetchImpl: createFakeCdn(seen),
        dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    (error) => error.code === "blocked_ip"
  );
  assert.equal(seen.length, 0, "no request may be made for a blocked address");
});
