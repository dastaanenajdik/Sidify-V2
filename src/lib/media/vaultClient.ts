/**
 * HTTP client for the Vault media API.
 *
 * Mirrors the reference terminal client's `client.rs`: a pool of API hosts is tried in
 * rotation, a visitor session token is minted once and reused until it expires, and a
 * 401/403 or an exhausted pool triggers one session refresh.
 *
 * Server-only: it uses `node:crypto` indirectly and holds the session token in memory.
 */

import {
  buildSignedHeaders,
  generateClientIdentity,
  randomSpoofedIp,
  type VaultRequestHeaders,
} from "./vaultCrypto";

/** API hosts, rotated on failure. */
const HOST_POOL = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com",
];

/** Statuses that mean "try the next host". */
const RETRY_STATUS_CODES = new Set([403, 406, 407, 429, 500, 502, 503, 504]);

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class VaultApiError extends Error {
  constructor(
    message: string,
    readonly code: "api_status" | "hosts_exhausted" | "json" | "missing_token" | "network",
    readonly status?: number
  ) {
    super(message);
    this.name = "VaultApiError";
  }
}

interface VaultSession {
  token: string;
  expiresAt: number | null;
  createdAt: number;
}

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a refused login is remembered before it is tried again.
 *
 * Long enough that one page load asks once instead of a dozen times, short
 * enough that a deployment recovers on its own when the host comes back.
 */
const SESSION_RETRY_COOLDOWN_MS = 20_000;

/** Reads `exp` / `userId` out of a JWT payload (no signature verification needed). */
export function parseJwtClaims(token: string): { userId: string | null; expiresAt: number | null } {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) return { userId: null, expiresAt: null };

  let bytes: Buffer | null = null;
  try {
    bytes = Buffer.from(payload, "base64url");
    if (!bytes.length) bytes = null;
  } catch {
    bytes = null;
  }
  if (!bytes) return { userId: null, expiresAt: null };

  try {
    const claims = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    const rawId = claims.userId ?? claims.uid ?? claims.sub;
    const userId =
      typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : null;

    let expiresAt: number | null = null;
    const rawExp = claims.exp;
    if (typeof rawExp === "number" && Number.isFinite(rawExp)) expiresAt = rawExp;
    else if (typeof rawExp === "string") {
      const parsed = Number.parseInt(rawExp, 10);
      if (Number.isFinite(parsed)) expiresAt = parsed;
    }

    return { userId, expiresAt };
  } catch {
    return { userId: null, expiresAt: null };
  }
}

function sessionIsValid(session: VaultSession | null): session is VaultSession {
  if (!session || !session.token.trim()) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (session.expiresAt !== null) return nowSeconds + 60 < session.expiresAt;
  return Date.now() < session.createdAt + SESSION_MAX_AGE_MS;
}

export interface VaultClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * A structural summary of one upstream response.
 *
 * Deliberately contains **no payload values** — only keys, counts and the
 * envelope's status fields. That is enough to tell "the endpoint has no rows"
 * apart from "the payload shape changed", which is the distinction the UI cannot
 * make, and it keeps titles and upstream content out of the logs entirely.
 */
export interface VaultResponseDiagnostics {
  status: number;
  host: string;
  path: string;
  /** `code` from the envelope, when the payload is enveloped. */
  envelopeCode?: unknown;
  /** `message`/`msg` from the envelope, when present. */
  envelopeMessage?: unknown;
  /** Top-level keys of the payload the adapters will see. */
  payloadKeys: string[];
  /** Depth-limited shape of the payload, with every string/number replaced by its type. */
  skeleton: unknown;
}

/**
 * Stateful API client. One instance is shared per server process; the session token
 * lives in module scope so warm serverless instances reuse it.
 */
export class VaultClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly identity = generateClientIdentity();
  private readonly spoofedIp = randomSpoofedIp();
  private activeHostIndex = 0;
  private session: VaultSession | null = null;
  private sessionPromise: Promise<VaultSession> | null = null;
  /** Structural summary of the most recent successful response. Diagnostics only. */
  private lastDiagnostics: VaultResponseDiagnostics | null = null;
  /** Structural summary of the most recent rejected response. Diagnostics only. */
  private lastFailure: VaultResponseDiagnostics | null = null;
  /** The last login failure, kept briefly so the host is not asked again at once. */
  private sessionFailure: { at: number; error: Error } | null = null;

  constructor(options: VaultClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get userAgent(): string {
    return this.identity.userAgent;
  }

  /* ------------------------------ session ------------------------------- */

  private async fetchFreshSession(): Promise<VaultSession> {
    const payload = await this.requestHosts("POST", "/wefeed-mobile-bff/user-api/visitor-login", "{}", null);
    const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const token = typeof record.token === "string" ? record.token.trim() : "";
    if (!token) throw new VaultApiError("Visitor login returned no token.", "missing_token");

    const claims = parseJwtClaims(token);
    return {
      token,
      expiresAt: claims.expiresAt,
      createdAt: Date.now(),
    };
  }

  /** Mints a visitor session once and reuses it until it expires. */
  async ensureSession(): Promise<string> {
    if (sessionIsValid(this.session)) return this.session.token;

    // A host that refuses the login refuses it just as firmly on the ninth
    // attempt. Without this, one page load with three tabs and a fallback search
    // minted the same rejected session a dozen times, which is both slow and a
    // good way to get a temporary identity ban.
    if (this.sessionFailure && Date.now() - this.sessionFailure.at < SESSION_RETRY_COOLDOWN_MS) {
      throw this.sessionFailure.error;
    }

    if (!this.sessionPromise) {
      this.sessionPromise = this.fetchFreshSession()
        .then((session) => {
          this.session = session;
          this.sessionFailure = null;
          return session;
        })
        .catch((error: unknown) => {
          this.sessionFailure = {
            at: Date.now(),
            error: error instanceof Error ? error : new Error(String(error)),
          };
          throw error;
        })
        .finally(() => {
          this.sessionPromise = null;
        });
    }
    const session = await this.sessionPromise;
    return session.token;
  }

  private invalidateSession(): void {
    this.session = null;
  }

  /* ------------------------------ requests ------------------------------ */

  async get(pathAndQuery: string): Promise<unknown> {
    return this.request("GET", pathAndQuery);
  }

  async post(pathAndQuery: string, body: unknown): Promise<unknown> {
    return this.request("POST", pathAndQuery, JSON.stringify(body));
  }

  private async request(method: string, pathAndQuery: string, body?: string): Promise<unknown> {
    const token = await this.ensureSession();
    try {
      return await this.requestHosts(method, pathAndQuery, body, token);
    } catch (error) {
      if (!isSessionRejection(error)) throw error;

      // The session was rejected. Mint a new one and try the same host again:
      // an expired token is by far the most common reason for this.
      this.invalidateSession();
      const freshToken = await this.ensureSession();
      try {
        return await this.requestHosts(method, pathAndQuery, body, freshToken);
      } catch (retryError) {
        if (!isSessionRejection(retryError)) throw retryError;

        // A brand-new session was rejected too, so the host itself is the
        // problem. One other host is worth a try before giving up.
        this.activeHostIndex = (this.activeHostIndex + 1) % HOST_POOL.length;
        return this.requestHosts(method, pathAndQuery, body, freshToken);
      }
    }
  }

  private async requestHosts(
    method: string,
    pathAndQuery: string,
    body: string | undefined,
    authToken: string | null
  ): Promise<unknown> {
    const startIndex = this.activeHostIndex;
    let lastError: VaultApiError | null = null;

    for (let attempt = 0; attempt < HOST_POOL.length; attempt++) {
      const index = (startIndex + attempt) % HOST_POOL.length;
      const base = HOST_POOL[index];
      const url = `${base}${pathAndQuery}`;

      const headers: VaultRequestHeaders = buildSignedHeaders({
        method,
        url,
        body,
        authToken,
        userAgent: this.identity.userAgent,
        clientInfo: this.identity.clientInfo,
        spoofedIp: this.spoofedIp,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          redirect: "follow",
        });

        if (RETRY_STATUS_CODES.has(response.status)) {
          this.activeHostIndex = (index + 1) % HOST_POOL.length;
          lastError = new VaultApiError(`Upstream host returned ${response.status}.`, "api_status", response.status);
          continue;
        }

        if (!response.ok) {
          // Read what the host had to say before giving up on it. A rejection
          // usually carries a `code`/`message` that names the reason, and without
          // it a rejected request is indistinguishable from a broken one.
          const failure = await this.describeFailure(response, base, pathAndQuery);
          this.lastFailure = failure;
          console.warn("[vault] upstream rejected the request", failure);

          throw new VaultApiError(
            `Upstream host returned ${response.status}` +
              (failure.envelopeMessage ? ` (${String(failure.envelopeMessage)})` : "") +
              ".",
            "api_status",
            response.status
          );
        }

        this.activeHostIndex = index;

        const text = await readBoundedText(response);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          lastError = new VaultApiError("Upstream host returned malformed JSON.", "json");
          continue;
        }

        // The API wraps successful payloads in `data`.
        //
        // The envelope is only unwrapped when `data` is actually an object. If a
        // response carries `data` as `null`, a string or an array, returning that
        // value would leave the adapters looking at something they cannot read —
        // and they answer with an empty list instead of an error, which is
        // indistinguishable from "the catalogue has no titles". Keeping the whole
        // payload lets the adapter try the unwrapped shape as well.
        const envelope = asEnvelope(parsed);
        const payload = unwrapEnvelope(envelope, parsed);

        this.lastDiagnostics = {
          status: response.status,
          host: base,
          path: pathAndQuery,
          envelopeCode: envelope?.code ?? envelope?.errorCode,
          envelopeMessage: envelope?.message ?? envelope?.msg,
          payloadKeys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [],
          skeleton: skeletonOf(payload),
        };

        // Some gateways answer a rejected request with HTTP 200 and the failure
        // in the body, e.g. `{ code: 401, message: "signature error", data: null }`.
        // Such a response looks like a successful, empty payload — the adapters
        // turn it into `[]` and the UI reports "nothing here yet", which hides the
        // real cause. A failure code with no data is therefore raised as an error.
        const softError = softErrorOf(envelope, payload);
        if (softError) {
          throw softError;
        }

        return payload;
      } catch (error) {
        if (error instanceof VaultApiError && error.code === "api_status" && !RETRY_STATUS_CODES.has(error.status ?? 0)) {
          throw error;
        }
        this.activeHostIndex = (index + 1) % HOST_POOL.length;
        lastError =
          error instanceof VaultApiError
            ? error
            : new VaultApiError(
                (error as Error)?.name === "AbortError"
                  ? "Upstream request timed out."
                  : `Upstream request failed: ${(error as Error)?.message || "network error"}`,
                "network"
              );
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new VaultApiError("All upstream hosts were exhausted.", "hosts_exhausted");
  }

  /**
   * A structural summary of the last successful response, for logging.
   *
   * Contains keys and types only — never a title, a URL or any other payload
   * value — so it is safe to write to the server logs.
   */
  describeLastResponse(): VaultResponseDiagnostics | null {
    return this.lastDiagnostics;
  }

  /**
   * The shape of the most recent rejected response, for logging.
   *
   * Carries the status, the gateway's own `code`/`message` and the payload keys —
   * no catalogue content.
   */
  describeLastFailure(): VaultResponseDiagnostics | null {
    return this.lastFailure;
  }

  /** Reads a rejected response's body and summarises it without keeping the content. */
  private async describeFailure(
    response: Response,
    host: string,
    path: string
  ): Promise<VaultResponseDiagnostics> {
    let envelopeCode: unknown;
    let envelopeMessage: unknown;
    let payloadKeys: string[] = [];
    let skeleton: unknown = null;

    try {
      const text = await readBoundedText(response);
      const parsed: unknown = JSON.parse(text);
      const envelope = asEnvelope(parsed);
      envelopeCode = envelope?.code ?? envelope?.errorCode;
      envelopeMessage =
        envelope?.message ??
        envelope?.msg ??
        (envelope && typeof envelope.error === "string" ? envelope.error : undefined);
      payloadKeys = envelope ? Object.keys(envelope).slice(0, 12) : [];
      skeleton = skeletonOf(parsed);
    } catch {
      /* a rejected response need not carry JSON at all */
    }

    return {
      status: response.status,
      host,
      path,
      envelopeCode,
      envelopeMessage,
      payloadKeys,
      skeleton,
    };
  }
}

/**
 * Statuses that mean "I do not accept this session", as opposed to "this request
 * is wrong".
 *
 * `440` is the gateway's own code for a session that is no longer valid — it is
 * not a standard HTTP status, which is exactly why it has to be named here. The
 * service answers `440` on every host when the token it was given is not usable,
 * and treating it as fatal turned a recoverable situation into an empty shelf.
 */
const SESSION_REJECTION_STATUSES = new Set([401, 403, 440]);

function isSessionRejection(error: unknown): boolean {
  if (!(error instanceof VaultApiError)) return false;
  if (error.code === "hosts_exhausted") return true;
  return error.code === "api_status" && SESSION_REJECTION_STATUSES.has(error.status ?? 0);
}

/** The part of a payload that carries `code`/`message`/`data`, when there is one. */
function asEnvelope(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return "code" in record || "data" in record || "message" in record || "msg" in record ? record : null;
}

function unwrapEnvelope(envelope: Record<string, unknown> | null, parsed: unknown): unknown {
  if (!envelope || !("data" in envelope)) return parsed;

  const inner = envelope.data;
  // A nested object is the payload proper.
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    // Guard against the payload being wrapped twice.
    const again = unwrapEnvelope(asEnvelope(inner), inner);
    return again;
  }
  // `data` is null, a string or an array: the envelope carries no payload, so the
  // whole body is handed on and the adapters try both shapes.
  if (inner === undefined || inner === null) return parsed;
  return inner;
}

/** Statuses that mean the request itself was rejected, whatever the HTTP status was. */
const REJECTED_ENVELOPE_CODES = new Set([401, 403, 407, 429]);

/**
 * Turns a body-level failure into an error.
 *
 * Some gateways answer a rejected request with HTTP 200 and the failure in the
 * body — `{ code: 401, message: "signature error", data: null }`. Without this
 * check that body reaches the adapters, becomes an empty list, and the UI
 * reports "nothing here yet", hiding the real cause.
 */
function softErrorOf(envelope: Record<string, unknown> | null, body: unknown): VaultApiError | null {
  if (!envelope) return null;

  const rawCode = envelope.code ?? envelope.errorCode;
  const code = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" ? Number(rawCode) : NaN;
  if (!Number.isFinite(code)) return null;

  // 0 and 200 both mean success in this API.
  if (code === 0 || code === 200) return null;

  // A body that carries content next to a business `code` is still a payload.
  if (hasContent(body) || hasContent(unwrapEnvelope(envelope, null))) return null;

  const rejected = REJECTED_ENVELOPE_CODES.has(code) || code >= 500;
  if (!rejected) return null;

  const message = typeof envelope.message === "string" ? envelope.message : typeof envelope.msg === "string" ? envelope.msg : "";
  return new VaultApiError(
    `Upstream rejected the request in the body (code ${code}${message ? `: ${message}` : ""}).`,
    "api_status",
    code
  );
}

const CONTENT_KEYS = ["items", "subjects", "results", "list", "operatingList", "modules", "groups", "rows", "subject"];

function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return CONTENT_KEYS.some((key) => {
    const entry = record[key];
    return Array.isArray(entry) ? entry.length > 0 : Boolean(entry && typeof entry === "object");
  });
}

/**
 * The shape of a payload with every value replaced by its type.
 *
 * `{items:[{banner:{banners:[{subject:{subjectId:1,title:"x"}}]}}]}`
 * becomes `{items:[{banner:{banners:[{subject:{subjectId:"number",title:"string"}}]}}]}`.
 *
 * This is what makes a shape change visible in the logs without writing any
 * upstream content into them.
 */
function skeletonOf(value: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (!value.length) return [];
    return [skeletonOf(value[0], depth + 1)];
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = skeletonOf(entry, depth + 1);
    }
    return out;
  }
  return typeof value;
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new VaultApiError("Upstream response was too large.", "json");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/* --------------------------- shared instance ----------------------------- */

let sharedClient: VaultClient | null = null;

/** Process-wide client so warm instances reuse the visitor session. */
export function getVaultClient(): VaultClient {
  if (!sharedClient) sharedClient = new VaultClient();
  return sharedClient;
}
