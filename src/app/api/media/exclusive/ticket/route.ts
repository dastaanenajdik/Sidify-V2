import { NextRequest, NextResponse } from "next/server";
import { callerKey, TokenBucketLimiter } from "@/lib/media/rateLimit";
import { getVaultClient } from "@/lib/media/vaultClient";
import { readJsonBody } from "@/lib/readJsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/media/exclusive/ticket
 *
 * Hands the caller **one signed upstream request per allowed call**, so the
 * browser can make it itself:
 *
 *   browser ──ticket──> this route ──(signs with the HMAC key it alone holds)
 *   browser ──signed request──> upstream        ← connection carries the user's IP
 *
 * Why this exists: the catalogue is reachable from most consumer networks but
 * refuses or rate-limits shared datacenter ranges, which is exactly what a
 * serverless function egresses from. Moving the *originating* side of the
 * request to the browser fixes the block for free — the request then carries a
 * residential IP, the user's own TLS fingerprint and a real browser profile.
 *
 * What is deliberately NOT possible here:
 *
 *   1. **No arbitrary URLs.** The caller names a *kind* of call (`home`,
 *      `search`, `detail`, `resource`) plus validated parameters. The path,
 *      host and query are built here. There is no `url` field to abuse.
 *   2. **No secrets.** The HMAC key never leaves this process. The response
 *      carries per-request signatures (bound to method + URL + body +
 *      timestamp, and only useful until the upstream's own skew window
 *      closes) and a **one-off anonymous visitor token** minted for this
 *      ticket — never the process-wide session this server keeps using.
 *   3. **No bulk signing.** One batch is at most four calls; the expanded
 *      total is capped; the route is rate-limited per caller.
 *
 * A CORS refusal is a *normal* outcome: the browser path is best-effort and
 * the client falls back to the relay route without showing an error. See
 * `src/lib/media/exclusiveDirect.ts`.
 */

/** A batch may name at most this many calls. */
const MAX_CALLS_PER_BATCH = 4;
/** After expansion (`home` → three tabs) a batch may produce this many requests. */
const MAX_SIGNED_CALLS = 6;
/** Signatures are only useful for a short window; do not hand out long-lived ones. */
const TICKET_TTL_MS = 10 * 60 * 1000;
/** Ephemeral visitor tokens are reused for this long per ticket key. */
const EPHEMERAL_TOKEN_TTL_MS = 4 * 60 * 1000;
const MAX_EPHEMERAL_TOKENS = 256;

/**
 * Browser-bound calls must not claim a forwarded address: the request leaves
 * from the user's own connection, so the socket *is* the truth. (The relay path
 * keeps its spoofed header, because there the origin really is a datacenter.)
 */
const BROWSER_BOUND = { forwardedFor: false } as const;

/** Homepage tabs the collection is read from (kept server-side on purpose). */
const HOME_TAB_IDS = ["2", "1", "3"];

const MAX_KEYWORD_LENGTH = 120;
const MAX_SUBJECT_ID_LENGTH = 20;

const limiter = new TokenBucketLimiter({ capacity: 40, refillPerSecond: 40 / 60 });

interface EphemeralToken {
  token: string;
  expiresAt: number;
}
const ephemeralTokens = new Map<string, EphemeralToken>();

interface RawCall {
  kind?: unknown;
  term?: unknown;
  subjectId?: unknown;
  se?: unknown;
  ep?: unknown;
}

interface SignedCallDescriptor {
  id: string;
  kind: "home" | "search" | "detail" | "resource";
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  expiresAt: number;
}

function isSubjectId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}

function toSmallInt(value: unknown, max: number): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded >= 0 && rounded <= max ? rounded : undefined;
}

/** Reuses a recent ephemeral token per ticket key, so a page view costs one login. */
async function ephemeralTokenFor(key: string, mint: () => Promise<string>): Promise<string> {
  const cached = ephemeralTokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const token = await mint();
  if (ephemeralTokens.size >= MAX_EPHEMERAL_TOKENS) {
    const oldest = ephemeralTokens.keys().next().value;
    if (oldest) ephemeralTokens.delete(oldest);
  }
  ephemeralTokens.set(key, { token, expiresAt: Date.now() + EPHEMERAL_TOKEN_TTL_MS });
  return token;
}

export async function POST(req: NextRequest) {
  const limited = limiter.take(callerKey(req.headers));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many ticket requests. Try again shortly.", code: "rate_limited" },
      {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
      }
    );
  }

  const body = await readJsonBody<{ calls?: unknown; key?: unknown }>(req);
  if (!body || !Array.isArray(body.calls)) {
    return NextResponse.json({ error: "Expected { calls: [...] }", code: "bad_request" }, { status: 400 });
  }
  if (body.calls.length === 0 || body.calls.length > MAX_CALLS_PER_BATCH) {
    return NextResponse.json(
      { error: `A batch must hold 1–${MAX_CALLS_PER_BATCH} calls.`, code: "bad_request" },
      { status: 400 }
    );
  }

  const ticketKey = typeof body.key === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(body.key) ? body.key : "anon";

  // Validate first, then sign: a rejected batch must never cost an upstream call.
  const requested: Array<{ kind: SignedCallDescriptor["kind"]; term?: string; subjectId?: string; se?: number; ep?: number }> = [];
  for (const raw of body.calls as RawCall[]) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Each call must be an object.", code: "bad_request" }, { status: 400 });
    }
    const kind = raw.kind;
    if (kind === "home") {
      requested.push({ kind });
      continue;
    }
    if (kind === "search") {
      const term = typeof raw.term === "string" ? raw.term.trim() : "";
      if (!term || term.length > MAX_KEYWORD_LENGTH) {
        return NextResponse.json({ error: "A search call needs a term (1–120 chars).", code: "bad_request" }, { status: 400 });
      }
      requested.push({ kind, term });
      continue;
    }
    if (kind === "detail" || kind === "resource") {
      if (!isSubjectId(raw.subjectId)) {
        return NextResponse.json({ error: "A detail/resource call needs a numeric subjectId.", code: "bad_request" }, { status: 400 });
      }
      requested.push({
        kind,
        subjectId: raw.subjectId.slice(0, MAX_SUBJECT_ID_LENGTH),
        se: toSmallInt(raw.se, 500),
        ep: toSmallInt(raw.ep, 500),
      });
      continue;
    }
    return NextResponse.json({ error: "Unknown call kind.", code: "bad_request" }, { status: 400 });
  }

  const expandedCount = requested.reduce((total, call) => total + (call.kind === "home" ? HOME_TAB_IDS.length : 1), 0);
  if (expandedCount > MAX_SIGNED_CALLS) {
    return NextResponse.json({ error: "Batch expands to too many requests.", code: "bad_request" }, { status: 400 });
  }

  const client = getVaultClient();

  try {
    // A visitor token minted for this caller only. It is anonymous, expires on
    // its own, and is never the session the rest of this server uses.
    const token = await ephemeralTokenFor(ticketKey, () => client.mintEphemeralSession());
    const expiresAt = Date.now() + TICKET_TTL_MS;
    const calls: SignedCallDescriptor[] = [];

    for (const call of requested) {
      if (call.kind === "home") {
        for (const tabId of HOME_TAB_IDS) {
          const path = `/wefeed-mobile-bff/tab-operating?page=1&tabId=${encodeURIComponent(tabId)}&version=`;
          const signed = client.signedCall("GET", path, undefined, token, BROWSER_BOUND);
          calls.push({ id: `home:${tabId}`, kind: "home", method: "GET", url: signed.url, headers: signed.headers, expiresAt });
        }
        continue;
      }

      if (call.kind === "search") {
        const path = "/wefeed-mobile-bff/subject-api/search/v2";
        const payload = JSON.stringify({ keyword: call.term, page: 1, perPage: 15, subjectType: 0 });
        const signed = client.signedCall("POST", path, payload, token, BROWSER_BOUND);
        calls.push({
          id: "search",
          kind: "search",
          method: "POST",
          url: signed.url,
          headers: signed.headers,
          body: payload,
          expiresAt,
        });
        continue;
      }

      if (call.kind === "detail") {
        const path = `/wefeed-mobile-bff/subject-api/get?subjectId=${call.subjectId}`;
        const signed = client.signedCall("GET", path, undefined, token, BROWSER_BOUND);
        calls.push({ id: "detail", kind: "detail", method: "GET", url: signed.url, headers: signed.headers, expiresAt });
        continue;
      }

      const suffix =
        call.se !== undefined && call.ep !== undefined && call.se > 0 && call.ep > 0 ? `&se=${call.se}&ep=${call.ep}` : "";
      const path = `/wefeed-mobile-bff/subject-api/resource?subjectId=${call.subjectId}${suffix}&page=1&perPage=20`;
      const signed = client.signedCall("GET", path, undefined, token, BROWSER_BOUND);
      calls.push({ id: "resource", kind: "resource", method: "GET", url: signed.url, headers: signed.headers, expiresAt });
    }

    return NextResponse.json(
      { issuedAt: Date.now(), expiresAt, calls },
      {
        // Never cached: a signature is single-use-ish and must not be stored by
        // a browser cache, a CDN or a shared proxy.
        headers: { "cache-control": "no-store, no-store", pragma: "no-cache" },
      }
    );
  } catch (error) {
    // The server cannot mint a session either (its egress may be blocked too).
    // The browser will simply use the relay path; this is not a client error.
    console.warn("[api/media/exclusive/ticket] could not sign", (error as Error)?.message || error);
    return NextResponse.json(
      { error: "Signing is unavailable right now.", code: "ticket_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
