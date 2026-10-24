/**
 * End-to-end check of the exclusive collection, from this machine.
 *
 * The deployment's own logs show the upstream refusing every request with
 * `440 ServiceNotAvailable`, including the login. That message is what a host
 * returns when it will not serve the caller at all — a different network is the
 * first thing to rule out (or in).
 *
 * Run it on a normal connection, not inside the deployment:
 *
 *   node scripts/check-upstream.mjs            # listing
 *   node scripts/check-upstream.mjs "Dune"     # listing + a title search
 *
 * What the output means:
 *
 *   login ok, titles listed        the code works; the deployment's egress is the
 *                                  problem. Move the function region (§13.1 of the
 *                                  brief) or route the calls through a relay.
 *   login ok, zero titles          the request is accepted but the payload is
 *                                  empty — the shape log will name the shape.
 *   login refused with 440         the host refuses this network. Compare against
 *                                  the deployment: if both refuse, it is the
 *                                  account/identity, not the address.
 *
 * Nothing secret is printed: no token values, no raw payloads. Titles only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const Module = (await import("node:module")).default;
const ts = createRequire(path.join(ROOT, "package.json"))("typescript");

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
      const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidate)) return loadTs(path.relative(ROOT, candidate));
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const { VaultClient, VaultApiError } = loadTs("src/lib/media/vaultClient.ts");
const { VaultMediaProvider } = loadTs("src/lib/media/vaultProvider.ts");

const term = process.argv[2] || "";

const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

function explain(error) {
  if (error instanceof VaultApiError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    return `${error.code}${status}: ${error.message}`;
  }
  return String(error?.message || error);
}

console.log("");
console.log("Exclusive collection — live check");
console.log(`from ${process.platform}/${process.arch}, node ${process.version}`);
console.log("");

const client = new VaultClient();

/* ------------------------------- session -------------------------------- */

console.log("1. session");
let token = null;
try {
  const started = Date.now();
  token = await client.ensureSession();
  line("  login", `ok in ${Date.now() - started} ms`);
  line("  token", `${token.slice(0, 12)}… (${token.length} chars)`);
} catch (error) {
  const failure = client.describeLastFailure?.() ?? null;
  line("  login", `REFUSED — ${explain(error)}`);
  if (failure) {
    line("  host", failure.host);
    line("  gateway code", failure.envelopeCode ?? "—");
    line("  gateway message", failure.envelopeMessage ?? "—");
    line("  body keys", (failure.payloadKeys || []).join(", ") || "—");
  }
  console.log("");
  console.log("The session could not be created, so nothing else can be read.");
  console.log("Run this same script from another network to compare.");
  console.log("");
  process.exit(1);
}

/* ------------------------------- listing -------------------------------- */

console.log("");
console.log("2. listing");
const provider = new VaultMediaProvider(client);

try {
  const started = Date.now();
  const titles = await provider.discovery("all", 24);
  line("  titles", `${titles.length} in ${Date.now() - started} ms`);

  if (!titles.length) {
    const shape = client.describeLastResponse?.() ?? null;
    line("  WARNING", "the host accepted the request but returned no titles");
    if (shape) {
      line("  payload keys", (shape.payloadKeys || []).join(", ") || "—");
      console.log(`  shape            ${JSON.stringify(shape.skeleton).slice(0, 400)}`);
    }
  }

  for (const title of titles.slice(0, 8)) {
    line(`  ${title.kind}`, `${title.title}${title.year ? ` (${title.year})` : ""}`);
  }
} catch (error) {
  line("  FAILED", explain(error));
  const failure = client.describeLastFailure?.() ?? null;
  if (failure) {
    line("  host", failure.host);
    line("  gateway message", failure.envelopeMessage ?? "—");
  }
}

/* -------------------------------- search -------------------------------- */

if (term) {
  console.log("");
  console.log(`3. search — "${term}"`);

  try {
    const started = Date.now();
    const titles = await provider.searchTitles(term, "all", 10);
    line("  titles", `${titles.length} in ${Date.now() - started} ms`);

    if (!titles.length) {
      const shape = client.describeLastResponse?.() ?? null;
      if (shape) line("  payload keys", (shape.payloadKeys || []).join(", ") || "—");
    }

    for (const title of titles) {
      line(`  ${title.kind}`, `${title.title}${title.year ? ` (${title.year})` : ""}`);
    }
  } catch (error) {
    line("  FAILED", explain(error));
  }
}

console.log("");
console.log("Share this output as-is — it carries no tokens and no payload contents.");
console.log("");
