/**
 * Probes the exclusive collection's upstream call and prints exactly what was
 * requested and what came back.
 *
 * Run it with a local mock upstream:
 *   node scripts/probe-vault.mjs
 *
 * It is a diagnostic, not part of the app: it exercises the real provider and
 * the real signing code against a stub that answers the reference client's
 * shapes, so the exact request line, headers and parsed result are visible.
 */

import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- minimal TS loader (mirrors the pattern used by the test suite) ---
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

const { VaultClient } = loadTs("src/lib/media/vaultClient.ts");
const { VaultMediaProvider } = loadTs("src/lib/media/vaultProvider.ts");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json");

    if (url.pathname.includes("visitor-login")) {
      res.end(JSON.stringify({ data: { token: "probe-token" } }));
      return;
    }
    if (url.pathname.includes("tab-operating")) {
      // The reference client's homepage shape.
      res.end(
        JSON.stringify({
          data: {
            items: [
              {
                banner: {
                  banners: [
                    { subject: { subjectId: 1, title: "Banner Title", subjectType: 1, releaseDate: "2024-01-01", cover: { url: "https://img/1.jpg" } } },
                  ],
                },
              },
              { customData: { items: [{ subject: { subjectId: 2, title: "Custom Title", subjectType: 2 } }] } },
              { subjects: [{ subjectId: 3, title: "Grid Title", subjectType: 1 }] },
            ],
          },
        })
      );
      return;
    }
    if (url.pathname.includes("search/v2")) {
      res.end(
        JSON.stringify({
          data: { results: [{ subjects: [{ subjectId: 9, title: "Search Hit", subjectType: 1 }] }] },
        })
      );
      return;
    }
    res.end(JSON.stringify({ data: {} }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  const target = new URL(url);
  // Point every host at the local mock, keeping the path and query intact.
  const local = `http://127.0.0.1:${port}${target.pathname}${target.search}`;
  return fetch(local, init);
};

const client = new VaultClient({ fetchImpl: fakeFetch });
const provider = new VaultMediaProvider(client);

console.log("--- discovery('all') ---");
const listing = await provider.discovery("all", 24);
console.log("titles:", listing.length, listing.map((t) => `${t.kind}:${t.title}`));

console.log("--- searchTitles('dune') ---");
const found = await provider.searchTitles("dune", "all", 24);
console.log("titles:", found.length, found.map((t) => `${t.kind}:${t.title}`));

console.log("--- requests made ---");
for (const call of calls) {
  const u = new URL(call.url);
  console.log(`${call.init?.method || "GET"} ${u.pathname}${u.search}`);
  console.log(`   body: ${call.init?.body || "-"}`);
}

console.log("--- headers of the first signed request ---");
if (calls[0]) {
  for (const [k, v] of Object.entries(calls[0].init?.headers || {})) {
    console.log(`${k}: ${String(v).slice(0, 120)}`);
  }
}

server.close();
