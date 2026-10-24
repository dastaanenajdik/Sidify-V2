/**
 * Request signing for the Vault media API.
 *
 * The upstream API rejects unsigned calls, so every request carries a client token
 * plus an HMAC-MD5 signature over a canonical description of the request. This is a
 * TypeScript port of the reference terminal client's `crypto.rs`:
 *
 *   x-client-token   = "<ms-since-epoch>,<md5(reversed-ms)>"
 *   x-tr-signature   = "<ms-since-epoch>|2|<base64(hmac-md5(canonical))>"
 *   canonical        = METHOD \n accept \n content-type \n body-len \n ms \n body-md5 \n path?sorted-query
 *
 * Server-only: it uses `node:crypto`.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

/** Shared signing key material. */
const DEFAULT_SECRET_BYTES = Buffer.from([
  0xef, 0xa8, 0x91, 0x97, 0x4e, 0xec, 0xd3, 0x14, 0x8d, 0xf6, 0x3a, 0xa6, 0x11, 0x60, 0x2d, 0xef,
  0xd1, 0x01, 0x25, 0x9b, 0xa5, 0x21, 0x02, 0x2c, 0x57, 0xae, 0x05, 0x66, 0xbd, 0x8e,
]);

/** Bodies longer than this are truncated before hashing. */
const SIGNATURE_BODY_MAX_BYTES = 102_400;

function md5Hex(input: Buffer | string): string {
  return createHash("md5").update(input).digest("hex");
}

/** `<ms>,<md5 of the reversed millisecond timestamp>`. */
export function generateClientToken(timestampMs: number): string {
  const ts = String(timestampMs);
  const reversed = ts.split("").reverse().join("");
  return `${ts},${md5Hex(reversed)}`;
}

/**
 * Query string with parameters grouped by key and sorted by key, matching the
 * reference client's `BTreeMap` ordering (values keep their insertion order).
 */
export function sortedQueryString(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const grouped = new Map<string, string[]>();
  for (const [key, value] of parsed.searchParams) {
    const bucket = grouped.get(key);
    if (bucket) bucket.push(value);
    else grouped.set(key, [value]);
  }
  if (grouped.size === 0) return "";

  const parts: string[] = [];
  for (const key of [...grouped.keys()].sort()) {
    for (const value of grouped.get(key) ?? []) parts.push(`${key}=${value}`);
  }
  return parts.join("&");
}

/** The exact string that gets signed. */
export function buildCanonicalString(
  method: string,
  accept: string | undefined,
  contentType: string | undefined,
  url: string,
  body: string | undefined,
  timestampMs: number
): string {
  let canonicalUrl = url;
  try {
    const parsed = new URL(url);
    const query = sortedQueryString(url);
    canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    /* keep the raw URL when it cannot be parsed */
  }

  let bodyHash = "";
  let bodyLength = "";
  if (body !== undefined) {
    const bytes = Buffer.from(body, "utf8");
    bodyLength = String(bytes.length);
    bodyHash = md5Hex(bytes.length > SIGNATURE_BODY_MAX_BYTES ? bytes.subarray(0, SIGNATURE_BODY_MAX_BYTES) : bytes);
  }

  return [
    method.toUpperCase(),
    accept ?? "",
    contentType ?? "",
    bodyLength,
    String(timestampMs),
    bodyHash,
    canonicalUrl,
  ].join("\n");
}

/** `<ms>|2|<base64 signature>`. */
export function generateSignature(
  method: string,
  accept: string | undefined,
  contentType: string | undefined,
  url: string,
  body: string | undefined,
  timestampMs: number
): string {
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestampMs);
  const signature = createHmac("md5", DEFAULT_SECRET_BYTES).update(canonical).digest("base64");
  return `${timestampMs}|2|${signature}`;
}

export interface VaultRequestHeaders {
  [name: string]: string;
}

/** All headers an API request needs, including the bearer session token. */
export function buildSignedHeaders(params: {
  method: string;
  url: string;
  body?: string;
  authToken?: string | null;
  userAgent: string;
  clientInfo: string;
  spoofedIp: string;
}): VaultRequestHeaders {
  const { method, url, body, authToken, userAgent, clientInfo, spoofedIp } = params;
  const timestampMs = Date.now();
  const accept = "application/json";
  const contentType = "application/json";

  const headers: VaultRequestHeaders = {
    "user-agent": userAgent,
    accept,
    "content-type": contentType,
    connection: "keep-alive",
    "x-client-token": generateClientToken(timestampMs),
    "x-tr-signature": generateSignature(method, accept, contentType, url, body, timestampMs),
    "x-client-info": clientInfo,
    "x-client-status": "0",
    "x-forwarded-for": spoofedIp,
  };

  if (authToken && authToken.trim()) {
    headers.authorization = `Bearer ${authToken.trim()}`;
  }
  return headers;
}

/* --------------------------- client identity ----------------------------- */

const ANDROID_VERSIONS: Array<[string, string]> = [
  ["9", "PQ3A.190605.03081104"],
  ["10", "QP1A.191005.007.A3"],
  ["11", "RP1A.200720.011"],
  ["12", "S1B.220414.015"],
  ["13", "TQ2A.230405.003"],
];

const REDMI_DEVICES: Array<[string, string]> = [
  ["23078RKD5C", "Redmi"],
  ["2201117TY", "Redmi"],
  ["2201117TG", "Redmi"],
  ["22101316G", "Redmi"],
  ["21121210G", "Redmi"],
  ["M2012K11AG", "Redmi"],
  ["M2007J20CG", "Redmi"],
];

const VERSION_CODES = [50020117, 50020118, 50020119, 50020120, 50020121];
const NETWORK_TYPES = ["NETWORK_WIFI", "NETWORK_MOBILE"];
const TIMEZONES = ["Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "America/New_York", "Europe/London"];

function randomInt(maxExclusive: number): number {
  return randomBytes(4).readUInt32BE(0) % maxExclusive;
}

function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

function randomUuid(): string {
  const hex = randomHex(32);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

/** A plausible Android client identity (user agent + `x-client-info` payload). */
export function generateClientIdentity(): { userAgent: string; clientInfo: string } {
  const android = ANDROID_VERSIONS[randomInt(ANDROID_VERSIONS.length)];
  const device = REDMI_DEVICES[randomInt(REDMI_DEVICES.length)];
  const versionCode = VERSION_CODES[randomInt(VERSION_CODES.length)];
  const network = NETWORK_TYPES[randomInt(NETWORK_TYPES.length)];
  const timezone = TIMEZONES[randomInt(TIMEZONES.length)];
  const gaid = randomUuid();
  const deviceId = randomHex(32);

  const userAgent = `com.community.oneroom/${versionCode} (Linux; U; Android ${android[0]}; en_US; ${device[0]}; Build/${android[1]}; Cronet/135.0.7012.3)`;

  const clientInfo = JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: "4.0.01.0813.03",
    version_code: versionCode,
    os: "android",
    os_version: android[0],
    install_ch: "ps",
    device_id: deviceId,
    install_store: "ps",
    gaid,
    brand: device[1],
    model: device[0],
    system_language: "en",
    net: network,
    region: "US",
    timezone,
    sp_code: "40401",
    "X-Play-Mode": "2",
  });

  return { userAgent, clientInfo };
}

const IP_PREFIXES = ["103.241", "49.36", "117.195", "106.198", "122.162", "157.32", "182.70", "103.58", "27.60", "59.90"];

/** A routable-looking `x-forwarded-for` value. */
export function randomSpoofedIp(): string {
  const prefix = IP_PREFIXES[randomInt(IP_PREFIXES.length)];
  const c = 1 + randomInt(253);
  const d = 1 + randomInt(253);
  return `${prefix}.${c}.${d}`;
}
