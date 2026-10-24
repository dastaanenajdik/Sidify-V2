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
    if (!this.sessionPromise) {
      this.sessionPromise = this.fetchFreshSession()
        .then((session) => {
          this.session = session;
          return session;
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
      const status = error instanceof VaultApiError ? error.status : undefined;
      if (status === 401 || status === 403 || (error instanceof VaultApiError && error.code === "hosts_exhausted")) {
        this.invalidateSession();
        const freshToken = await this.ensureSession();
        return this.requestHosts(method, pathAndQuery, body, freshToken);
      }
      throw error;
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
          throw new VaultApiError(`Upstream host returned ${response.status}.`, "api_status", response.status);
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
        if (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)) {
          return (parsed as Record<string, unknown>).data;
        }
        return parsed;
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
