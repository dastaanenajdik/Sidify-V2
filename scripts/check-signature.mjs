/**
 * Checks that the URL we SIGN is byte-identical to the URL we SEND.
 *
 * The signature covers `pathname?sorted-query`. If the sent query and the
 * signed query differ in any way — an empty value, a different order, a
 * re-encoded character — the upstream rejects the request.
 *
 * Run: node scripts/check-signature.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ts = createRequire(path.join(ROOT, "package.json"))("typescript");
const fs = await import("node:fs");
const Module = (await import("node:module")).default;

const moduleCache = new Map();
function loadTs(targetPath) {
  const filename = path.resolve(ROOT, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.startsWith(".") && parent && parent.filename) {
      const c = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(c)) return loadTs(path.relative(ROOT, c));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const { buildCanonicalString, sortedQueryString } = loadTs("src/lib/media/vaultCrypto.ts");

const BASE = "https://api6.aoneroom.com";

const PATHS = [
  "/wefeed-mobile-bff/tab-operating?page=1&tabId=2&version=",
  "/wefeed-mobile-bff/tab-operating?page=1&tabId=1&version=",
  "/wefeed-mobile-bff/subject-api/get?subjectId=42",
  "/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=42&se=1&ep=2",
  "/wefeed-mobile-bff/subject-api/resource/v2?subjectId=42&page=1&perPage=20&all=0&startPosition=1&endPosition=1&pagerMode=2&resolution=0&se=1&epFrom=2&epTo=2&isVip=true",
  "/wefeed-mobile-bff/user-api/visitor-login",
];

console.log("signed canonical URL vs. sent URL\n");

let drift = 0;
for (const p of PATHS) {
  const url = `${BASE}${p}`;
  const canonical = buildCanonicalString("GET", "application/json", "application/json", url, undefined, 1700000000000);

  const sent = new URL(url);
  const sentQuery = sent.searchParams.toString();
  const signedQuery = sortedQueryString(url);

  // What the upstream reconstructs: pathname + sorted query.
  const reconstructed = signedQuery ? `${sent.pathname}?${signedQuery}` : sent.pathname;

  // The raw query as it appears on the wire.
  const rawQuery = p.includes("?") ? p.slice(p.indexOf("?") + 1) : "";

  const canonicalLine = canonical.split("\n").pop();
  const same = reconstructed === `${sent.pathname}${rawQuery ? "?" + rawQuery : ""}`;

  console.log(`path      ${sent.pathname}`);
  console.log(`  sent   ?${rawQuery || "(none)"}`);
  console.log(`  signed ?${signedQuery || "(none)"}`);
  console.log(`  canon  ${canonicalLine}`);
  console.log(`  same-order-as-sent? ${same ? "yes" : "NO — differs"}`);
  console.log("");

  if (!same) drift++;
}

console.log(drift === 0
  ? "All request URLs are signed exactly as they are sent."
  : `${drift} request(s) sign a different query than they send.`);
