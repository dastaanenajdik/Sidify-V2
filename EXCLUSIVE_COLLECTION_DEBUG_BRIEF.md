# Context Brief — "Exclusive" collection returns empty on a Vercel deployment

> **Purpose of this document:** to hand to an independent expert (or a different AI) so
> they can diagnose and fix a production bug without needing to read the whole codebase.
>
> **Audience:** someone who does not know this project. Assume deep familiarity with
> HTTP, API reverse-engineering, mobile-app API protocols, Next.js and Vercel.
>
> **No repository link is given on purpose** — everything needed is written out below.

---

## 1. What we are building

A **Next.js 16 (App Router) music + movies streaming web app**, deployed on **Vercel's
free tier** (serverless functions, no separate backend server, no long-running process,
no persistent filesystem).

The app has these user-facing parts:

| Part | Purpose |
|---|---|
| Main catalogue | The "normal" movies/series catalogue (a separate, already-working provider) |
| **"Exclusive" collection** | A second, separate catalogue, added later — **currently broken** |
| Library | Liked songs, playlists, downloads, history (Postgres, with a localStorage fallback) |
| Player | Playback via Shaka Player (HLS/DASH) plus external-player hand-off |

The **Exclusive collection** is the subject of this brief. It was added as a *separate
section* with *its own search box*, and its results must come **only** from this
catalogue — never mixed with the main catalogue's.

---

## 2. The bug, as reported by the user

The Exclusive section renders its heading and search box correctly, but the results
area shows:

> **Nothing here yet**
>
> This collection is empty right now. Please try again shortly.

**This specific wording matters.** The component has two distinct empty states:

| UI text | Meaning |
|---|---|
| "The exclusive collection is unavailable" | the HTTP request **failed** (`isError`) |
| **"Nothing here yet"** | the request **succeeded (HTTP 200)** but the list was empty |

The user sees **"Nothing here yet"**. So:

> **The API route returns HTTP 200 with a valid JSON body containing an empty `items`
> array. No exception, no 5xx, no timeout.**

That immediately rules out a large class of causes (route crash, missing env var
throwing, host unreachable, auth rejection) and points at the **response-parsing /
payload-shape** layer, or at the upstream genuinely returning nothing.

Two related symptoms were reported in the same report:

- The **main** search page works, and the main catalogue's results appear normally.
- The main catalogue's browse pages show an "**Exclusive picks**" rail. That rail was
  also empty before a previous fix, and remains empty.

---

## 3. Current architecture of the Exclusive collection

### 3.1 Files (all paths relative to the repo root)

| File | Role |
|---|---|
| `src/lib/media/vaultClient.ts` | Signed HTTP client: host pool, session token, envelope unwrapping |
| `src/lib/media/vaultCrypto.ts` | Request signing (HMAC-MD5), Android client identity |
| `src/lib/media/vaultProvider.ts` | The provider: search, listing, details, streams, downloads |
| `src/lib/media/vaultAdapt.ts` | Payload → app-model adapters (search, homepage, details, releases) |
| `src/lib/media/vaultResolve.ts` | Resolves a release mirror into a playable/downloadable URL |
| `src/lib/media/vaultStream.ts` | Same-origin relay that proxies the signed CDN streams |
| `src/lib/media/service.ts` | `searchExclusive()`, `getSecondaryProvider()`, merge helpers |
| `src/app/api/media/exclusive/route.ts` | `GET /api/media/exclusive?q=&type=&limit=` |
| `src/app/exclusive/page.tsx` | The `/exclusive` page (static shell) |
| `src/components/media/ExclusiveSection.tsx` | The client component that renders the section |
| `src/lib/media/hooks.ts` | `useExclusiveSearch()` → `mediaApi.exclusive()` |
| `src/lib/media/client.ts` | `mediaApi.exclusive()` → `fetch("/api/media/exclusive?…")` |

### 3.2 The request path, end to end

```
Browser
  └─ useExclusiveSearch(term)                 src/lib/media/hooks.ts
      └─ mediaApi.exclusive(term,"all",30)     src/lib/media/client.ts
          └─ GET /api/media/exclusive?q=&type=all&limit=30
              └─ searchExclusive(q, kind, limit)      src/lib/media/service.ts
                  └─ getSecondaryProvider().discovery(kind, limit)
                                                     src/lib/media/vaultProvider.ts
                      └─ VaultClient.get("/wefeed-mobile-bff/tab-operating?…")
                          └─ signed HTTPS request to the upstream API host
                  └─ homepagePayloadToTitles(payload)
                                                     src/lib/media/vaultAdapt.ts
```

**With a search term** (`q=dune`), `searchExclusive()` calls
`getSecondaryProvider().searchTitles(term, kind, limit)` instead, which POSTs to
`/wefeed-mobile-bff/subject-api/search/v2`.

### 3.3 How the listing is supposed to work

The catalogue's **primary discovery source is a "homepage" endpoint** — the same rows
the reference mobile client shows on its first screen:

```
GET /wefeed-mobile-bff/tab-operating?page=1&tabId=<tabId>&version=
```

Its payload is:

```jsonc
{
  "data": {
    "items": [                 // "groups" — one per row on the homepage
      { "banner":   { "banners": [ { "subject": { … } } ] } },   // banner row
      { "customData": { "items":  [ { "subject": { … } } ] } },   // custom row
      { "subjects": [ { … } ] }                                   // plain grid row
    ]
  }
}
```

`homepagePayloadToTitles()` walks every group and pulls the subjects out of all three
places, in that order.

The `data` envelope is **stripped by the client** before the adapter sees the payload,
so the adapter actually receives `{ "items": [ … ] }`.

### 3.4 Search payload shape

```
POST /wefeed-mobile-bff/subject-api/search/v2
body: {"keyword":"<term>","page":1,"perPage":15,"subjectType":0}
```

Response (after envelope stripping):

```jsonc
{
  "results": [                // an array of result GROUPS
    { "subjects": [ { subjectId, title, subjectType, releaseDate, cover:{url}, … } ] },
    { "subjects": [ … ] }     // ← later groups were being dropped; now all are read
  ]
}
```

`subjectType`: `1` = movie, `2` = series.

---

## 4. The upstream API, in full detail

This API is the protocol of an **Android streaming app**. The upstream product's name
must **never** appear on the site — internally it is called **"vault"**, publicly the
badge says **"Exclusive"**. Please do not put the upstream name in any public string,
comment that ships to the client, or user-facing log.

### 4.1 Host pool

```
https://api6.aoneroom.com
https://api5.aoneroom.com
https://api4.aoneroom.com
https://api4sg.aoneroom.com
https://api3.aoneroom.com
https://api6sg.aoneroom.com
https://api.inmoviebox.com
```

Rotation happens on a **retryable status**: `403, 406, 407, 429, 500, 502, 503, 504`.
A `401`/`403` (or an exhausted pool) invalidates the session, re-logs in and retries
**once**.

### 4.2 Session

```
POST /wefeed-mobile-bff/user-api/visitor-login
body: {}
→ { "data": { "token": "<jwt>", "uid": "…" } }
```

The token's JWT `exp` is honoured (60 s skew); otherwise a 7-day max age is assumed.
The `x-user` response header (JSON `{token, uid}`) is also absorbed if present.

### 4.3 Request signing — **the most likely place for a subtle mismatch**

Two headers carry the anti-abuse state. Both are derived from a **shared secret embedded
in the client app**, so they can be reproduced.

**Secret key bytes (hex):**

```
ef a8 91 97 4e ec d3 14 8d f6 3a a6 11 60 2d ef d1 01 25 9b a5 21 02 2c 57 ae 05 66 bd 8e
```

**Canonical string** — exactly seven fields joined by `\n`:

```
METHOD \n accept \n contentType \n bodyLength \n timestampMs \n bodyMd5Hex \n canonicalUrl
```

- `METHOD` — upper-cased (`GET` / `POST`)
- `accept` — `application/json`
- `contentType` — `application/json`
- `bodyLength` — **full** body length in bytes (not truncated)
- `timestampMs` — epoch milliseconds
- `bodyMd5Hex` — MD5 hex of the body, **truncated to the first 102 400 bytes**; empty
  string when there is no body
- `canonicalUrl` — `pathname` + (`?` + query) where the query is the parameters
  **grouped by key and sorted by key** (values keep insertion order); **no query ⇒ no
  `?`**. *This is the URL path only — never the full URL with host.*

**Signature header:**

```
x-tr-signature: <timestampMs>|2|<base64(HMAC-MD5(canonical, secret))>
```

**Client token header:**

```
x-client-token: <timestampMs>,<md5Hex(reverse(timestampMsAsString))>
```

**Android client identity** (`x-client-info`, a JSON string):

```json
{
  "package_name": "com.community.oneroom",
  "version_name": "4.0.01.0813.03",
  "version_code": 50020117,          // one of 50020117–50020121, picked per session
  "os": "android",
  "os_version": "…",
  "install_ch": "ps",
  "device_id": "<32 hex chars>",
  "gaid": "<uuid v4>",
  "brand": "Redmi",
  "model": "…",
  "sp_code": "40401",
  "X-Play-Mode": "2"
}
```

**User-Agent:**

```
com.community.oneroom/<version_code> (Linux; U; Android <ver>; en_US; <model>; Build/<build>; Cronet/135.0.7012.3)
```

**Other headers:** `x-client-status: 0`, `x-forwarded-for: <random public IP>`,
`authorization: Bearer <session token>` (absent on the login call),
`accept: application/json`, `content-type: application/json`, `connection: keep-alive`.

### 4.4 Envelope unwrapping

The client strips a top-level `data` object from every successful response and returns
it. This matches the reference client exactly.

> ⚠️ **Note:** the current implementation only strips `data` when it is a **non-null
> object**. If `data` were `null`, an array, or a string, the whole payload is kept
> instead. This was hardened recently; it may or may not be the deployed version.

### 4.5 Other endpoints (working, for reference)

| Purpose | Request |
|---|---|
| Details | `GET /wefeed-mobile-bff/subject-api/get?subjectId=<id>` → `{ "data": { "subject": { … } } }` |
| Season structure | `GET /wefeed-mobile-bff/subject-api/season-info?subjectId=<id>` |
| Play sources | `GET /wefeed-mobile-bff/subject-api/play-info/v2?subjectId=<id>[&se=&ep=]` |
| Downloads / releases | `GET /wefeed-mobile-bff/subject-api/resource?subjectId=<id>[&se=&ep=]&page=1&perPage=20` |
| Resource v2 | `GET /wefeed-mobile-bff/subject-api/resource/v2?…` |
| Captions | `GET /wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=&resourceId=` |

**Details fields:** `subjectId|id`, `title`, `subjectType|stype`, `releaseDate|year`,
`description|intro`, `tagline`, `imdbRatingValue|rating`, `director`, `stars`, `prints`,
`audios`, `cover.url|coverUrl`, `duration`, `genre|genres`, `seasons.seasons[]`.

**Subject fields:** `subjectId|id`, `title|name`, `subjectType|stype`,
`releaseDate|year|releaseInfo`, `cover.url|coverUrl|poster|pic`, `genre|genres`,
`lanName|language`, `imdbRatingValue|imdbRate|imdb_rating|rating`,
`__browse_rank|imdb_popularity|imdbPopularity|popularity|viewers|hotValue`.

---

## 5. What has already been tried (and what it taught us)

This is important context — please do not repeat these dead ends.

### 5.1 Fixed earlier — the search adapter read the wrong shape

**Was:** the adapter looked for `results.list[0].subjects`.
**Reality:** `results` is an **array of result groups**; each group has `subjects`.
**Fix:** the adapter now handles array-of-groups, a `results.list` wrapper, a flat
`subjects`, and a flat `list`; it reads **every** group (not only the first) and
deduplicates by subject id. It also accepts a payload with or without the `data`
envelope.

### 5.2 Fixed earlier — the listing was "guessed" with keyword searches

**Was:** the listing searched for `"2024"`, `"action"`, `"drama"`, `"horror"`, …
**Why that failed:** the search endpoint matches **title text**. Generic words match
**no title at all**, so every term came back empty and the section showed
"Nothing here yet". The same guess was used for the "Exclusive picks" rail
(`secondarySearch("2024", kind, 12)`).
**Fix:** both now use the real homepage endpoint (`tab-operating`).

### 5.3 Fixed earlier — a missing database broke the whole library

`DATABASE_URL` is **not set** on the Vercel deployment. The library routes answered
`503`, which the client interpreted as "the backend is down" and then stopped calling
the library API for 20 seconds. Now a database-less deploy answers `200` with an empty
list, and only a *transport* failure marks the backend down.

> **This is the shape of bug we are looking at now:** a silently-empty success.

### 5.4 Dead ends — please do not repeat

- **Query-string relay token** (`?t=<token>`) is broken for DASH: the base became
  `…/vault-stream?t=abc/` and segment resolution returned null. The token must travel
  **in the path**: `/api/media/vault-stream/<token>/<segment>`.
- **Rewriting only the DASH manifest URL is insufficient** — segment URLs can resolve
  to the CDN and lose the signed cookies. The MPD's `<BaseURL>` must be rewritten to a
  same-origin segment proxy.
- **A generic `/api/media/stream?url=` proxy with injected headers does not proxy DASH
  segments** without MPD `<BaseURL>` rewriting.
- **Sniffing the CDN by URL is ambiguous** → mirrors are tagged `source: "vault"` and
  `isVaultMirrorUrl` is narrowed to DASH-CDN URLs only.
- **Applying the CDN allowlist to direct files is wrong** → the allowlist applies only
  to the DASH relay path; direct files use `sanitizePublicHttpsUrl` (any public HTTPS).
- **Direct MP4s must not send the DASH `Referer`** (it triggers 429) — only the
  `User-Agent`. The DASH `Referer` is `https://sportslive.wine`.
- **Deprecation-notice URLs** must be rejected: markers
  `1c7de0bd3393702d9191801f15f88f8d`, `9a0461bc39da389663bf3dbb17091d3f`,
  `b164fbfb4347792950bdfbfb563d39d9`, `/notice.mp4`, or `macdn.aoneroom.com` + `/other/`.

---

## 6. Current state of the fix, and what is *still* unknown

### 6.1 What the code does now

- `homepagePayloadToTitles()` mirrors the reference client's homepage adapter exactly.
- The provider reads tabs `["2", "1", "3"]` from `tab-operating`, merges them,
  deduplicates by id, and caches the result (5 min fresh / 30 min stale).
- The search adapter reads all result groups and tolerates the envelope.
- The "Exclusive picks" browse rail uses the same homepage listing.
- A broad keyword search remains as a **fallback** if the homepage comes back empty.
- Structured warnings were added so the server logs show the payload's top-level keys
  whenever a listing or a search comes back empty:
  - `[vault] homepage tab answered without any subjects` `{ tabId, keys }`
  - `[vault] homepage tab failed` `{ tabId, error }`
  - `[vault] search answered without any subjects` `{ term, keys }`

### 6.2 What is still unknown — the crux of this brief

> **The section still renders "Nothing here yet" in production after the homepage
> endpoint was added.**

The API returns **HTTP 200 with `items: []`**. The possible causes, in rough order of
likelihood:

1. **The payload shape of `tab-operating` is not what we think it is.** The reference
   adapter reads `payload["items"]` (or the payload itself, if it is an array) and then
   looks for `group["banner"]["banners"][*]["subject"]`,
   `group["customData"]["items"][*]["subject"]` and `group["subjects"]`. If the live
   endpoint uses different keys, or nests the groups one level deeper, every adapter
   yields zero subjects — **and returns an empty list rather than an error**, which is
   exactly the observed symptom.
2. **The `tabId` values are wrong.** The reference client uses `"2"` for the default
   browse tab. We also try `"1"` and `"3"`. If the live endpoint needs a *different*
   identifier (a string like `"movie"`, a numeric id, an empty string, a slug, or a
   `version` value that must be non-empty), every tab returns an empty payload.
3. **The request needs extra parameters or a different path.** The reference builds
   `?page={page}&tabId={tab_id}&version=` — note the **trailing `=` with an empty
   value**. A canonicalisation mismatch between the *signed* URL and the *sent* URL
   would make the signature invalid, and the API might answer `200` with an empty
   body instead of `401`.
4. **The signature is subtly wrong for this endpoint.** The canonical URL for the
   homepage contains a query string with an **empty value** (`version=`). Our query
   sorter groups by key and sorts by key — how an empty value and the trailing `=` are
   serialised must match the server's expectation byte for byte. A mismatch might
   yield an empty body with a 200.
5. **The upstream is geo-blocking the Vercel egress IPs** (the deployment is on
   Vercel's shared infrastructure; the API is a regional Indian/South-East-Asian
   service). A block often manifests as an empty successful payload.
6. **The endpoint requires the session token to be attached differently**, or requires
   a warm-up request (login → then homepage) with the same connection.
7. **The envelope is not `data` for this endpoint.** The client strips `data` only if
   it is a non-null object. If `tab-operating` answers `{"data": null, "items": […]}`,
   the current code keeps the whole payload — the adapter then sees
   `{data: null, items: […]}` and *would* find `items` at the top level, so this
   particular case is handled. But a response like `{"data": {"data": {"items": […]}}}`
   (double wrapping) is not.

### 6.3 The single most useful next step

**Capture the raw upstream response.** Everything else is guesswork until we see the
actual bytes the API returns for `tab-operating` and for `search/v2`.

The most reliable ways to get it, in order of preference:

1. **Run the same signed request from a machine that can reach the API** (not the
   sandbox, not Vercel) and dump the raw body.
2. **Add a temporary server-side dump** — in the provider, log the raw response text
   (truncated) for the homepage call, then read it in the Vercel function logs.
3. **Reproduce with the original mobile app** (the real Android client) and capture
   the request/response with a proxy — that gives the authoritative payload shape,
   tab id, and parameter set.

> **Constraint that matters for the fix:** the upstream's product name must not appear
> anywhere on the public site. Internal code names it "vault"; the public badge reads
> "Exclusive". Please keep that separation in any new code, and keep raw dumps in
> **server logs only** — never in the client bundle.

---

## 7. Constraints & requirements for any fix

| Constraint | Detail |
|---|---|
| **Deployment** | Vercel free tier only. Existing Next.js App Router serverless routes. **No separate server**, no background workers, no persistent disk. |
| **No separate server** | All upstream calls must happen inside the existing serverless functions. |
| **Server-side only** | The signing secret, the session token and the raw upstream payloads must never reach the browser. |
| **Upstream name hidden** | Never render the upstream product's name on the site. Public label: "Exclusive". |
| **Only this catalogue** | The Exclusive section must show **only** this collection — no titles from the main catalogue. |
| **Own search** | The section has its own search box that searches only this collection. |
| **Full detail pages** | A result must open a detail page with synopsis, cast, genres, ratings, seasons/episodes. |
| **Playback** | Results must play, with a quality/resolution picker. |
| **Downloads** | Direct file download links must be offered. |
| **Exclusive badge** | A minimal badge/logo on the thumbnails of these titles. |
| **Existing search must keep working** | The main catalogue's search must not regress. |
| **Main search stays mixed** | On the *main* search page both catalogues' results appear together. |
| **Degrade gracefully** | If this catalogue is unreachable, the app must not break — the rest of the site must keep working. |

---

## 8. Tooling & commands

```bash
npm ci                # install
npm run dev           # dev server (http://localhost:3000)
npx tsc --noEmit      # typecheck
npx eslint src/       # lint
npm test              # unit + integration tests (node:test)
npm run build         # production build
node scripts/probe-vault.mjs   # prints the collection's exact upstream calls
```

**Testing note:** the unit tests transpile TypeScript on the fly with a small
`Module._load` patch (see `tests/vaultIntegration.test.cjs` for the pattern). The
upstream API is **not reachable from the test sandbox or the build sandbox** — the
tests therefore use an injected `fetch` that answers with the reference payload
shapes. Everything about the real payload shape is asserted against those fixtures,
so **if a fixture is wrong, the tests are green and production is broken.**

---

## 9. Code excerpts (for reference)

### 9.1 The homepage adapter

```ts
export function homepagePayloadToTitles(payload: unknown): MediaTitle[] {
  const root = asRecord(payload);
  if (!root) return [];

  const inner = asRecord(root.data);
  const scope = inner ?? root;

  const groups = Array.isArray(scope.items) ? scope.items : Array.isArray(scope) ? scope : [];
  const subjects: unknown[] = [];

  for (const group of groups) {
    const groupRecord = asRecord(group);
    if (!groupRecord) continue;

    const banner = asRecord(groupRecord.banner);
    if (banner && Array.isArray(banner.banners)) {
      for (const bannerItem of banner.banners) {
        const bannerRecord = asRecord(bannerItem);
        const subject = bannerRecord ? bannerRecord.subject : undefined;
        if (subject !== undefined) subjects.push(subject);
      }
    }

    const customData = asRecord(groupRecord.customData);
    if (customData && Array.isArray(customData.items)) {
      for (const customItem of customData.items) {
        const customRecord = asRecord(customItem);
        const subject = customRecord ? customRecord.subject : undefined;
        if (subject !== undefined) subjects.push(subject);
      }
    }

    if (Array.isArray(groupRecord.subjects)) subjects.push(...groupRecord.subjects);
  }

  return titlesFromSubjects(subjects);
}
```

### 9.2 The signing core

```ts
export function buildCanonicalString(
  method: string, accept: string | undefined, contentType: string | undefined,
  url: string, body: string | undefined, timestampMs: number
): string {
  let canonicalUrl = url;
  try {
    const parsed = new URL(url);
    const query = sortedQueryString(url);
    canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch { /* keep the raw URL */ }

  let bodyHash = "";
  let bodyLength = "";
  if (body !== undefined) {
    const bytes = Buffer.from(body, "utf8");
    bodyLength = String(bytes.length);
    bodyHash = md5Hex(bytes.length > SIGNATURE_BODY_MAX_BYTES
      ? bytes.subarray(0, SIGNATURE_BODY_MAX_BYTES) : bytes);
  }

  return [
    method.toUpperCase(), accept ?? "", contentType ?? "",
    bodyLength, String(timestampMs), bodyHash, canonicalUrl,
  ].join("\n");
}

export function generateSignature(method, accept, contentType, url, body, timestampMs): string {
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestampMs);
  const signature = createHmac("md5", DEFAULT_SECRET_BYTES).update(canonical).digest("base64");
  return `${timestampMs}|2|${signature}`;
}
```

The query sorter (note: **values keep insertion order, keys are sorted**, and an empty
value is still emitted):

```ts
export function sortedQueryString(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return ""; }
  const grouped = new Map<string, string[]>();
  for (const [key, value] of parsed.searchParams) {
    const bucket = grouped.get(key);
    if (bucket) bucket.push(value); else grouped.set(key, [value]);
  }
  if (grouped.size === 0) return "";
  const parts: string[] = [];
  for (const key of [...grouped.keys()].sort()) {
    for (const value of grouped.get(key) ?? []) parts.push(`${key}=${value}`);
  }
  return parts.join("&");
}
```

### 9.3 The envelope unwrapping

```ts
// The API wraps successful payloads in `data`.
if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
  const envelope = parsed as Record<string, unknown>;
  if ("data" in envelope) {
    const inner = envelope.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
    if (inner === undefined) return envelope;
  }
}
return parsed;
```

### 9.4 The listing call

```ts
const HOMEPAGE_TAB_IDS = ["2", "1", "3"];

const payload = await this.client.get(
  `/wefeed-mobile-bff/tab-operating?page=1&tabId=${encodeURIComponent(tabId)}&version=`
);
```

---

## 10. Please answer these specific questions

1. Given the symptom (**HTTP 200, `items: []`**, with the upstream reachable and
   signing apparently accepted), what is your ranked list of causes?
2. What is the **correct payload shape** for `tab-operating`, and which `tabId`
   values are valid? How would you verify it without the upstream product's name
   appearing anywhere in the repo?
3. Is the **signature canonicalisation** for a URL with an empty query value
   (`…&version=`) correct? Specifically: should `version=` appear in the canonical
   string, and is the trailing `=` included in the value?
4. Could this upstream be **geo-blocking** Vercel's egress IPs, and if so, what is a
   realistic mitigation that still runs on the Vercel free tier?
5. Is there a **correct, sanctioned way** to list this catalogue's content that we may
   have overlooked (a different endpoint, a `tab-operating` variant, a public API,
   an RSS/Atom feed, a sitemap, an official API)?
6. What is the **minimum, lowest-risk change** that would make the section show
   *something* today while the correct listing is worked out — without leaking the
   upstream's name, and without breaking the main catalogue?

---

## 11. Facts about the environment (so you don't waste time)

- The upstream API hosts are **not reachable from the AI sandbox** (only
  `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` and GitHub are allowed).
  A live call cannot be made from here — but it **can** be made from the Vercel
  deployment, which is why the server-side logging described in §6.3 is the practical
  way to capture the response.
- The upstream's reference implementation (a Rust terminal client) was available
  during development and was used as the protocol oracle. It is **not** part of this
  project and should not be vendored in.
- The site's own domain is `sidify.vercel.app`.
- `DATABASE_URL` is **not** configured; the app is designed to run without it
  (local-first library).
- The main catalogue (movies/series from a different provider) works fine and is
  unrelated to this bug.

---

---
## 12. Update — what changed after this brief was written

A second review of this brief found a blind spot in §2's deduction, and it was
real. `HTTP 200 + items: []` was described as "the payload shape is wrong, or the
catalogue is genuinely empty". It missed a third case: **the gateway reporting a
failure in the body while keeping HTTP 200**. That case produced exactly the same
observable symptom, and the code had no way to tell it apart.

### 12.1 Cause that was found and fixed: the adapter only knew 3 payload shapes

The homepage adapter read `items` → `banner.banners[].subject`,
`customData.items[].subject` and `subjects[]` — and nothing else. Tested against
eleven plausible shapes, it parsed three and returned an empty list for the other
eight, including:

- groups under `operatingList`, `list`, `modules`
- subjects at the payload root (`data.subjects[]`)
- **flat** row items (the row *is* the subject, not `{subject}`)
- a double-wrapped envelope (`data.data.items`)

A shape it does not recognise yields `[]` with HTTP 200 — indistinguishable from
an empty catalogue. That is the reported symptom exactly.

`homepagePayloadToTitles()` now reads `items`, `operatingList`, `list`,
`modules`, `groups` and `rows`, accepts both nested and flat row items, and if the
known shapes still yield nothing, falls back to `collectSubjectsDeep()`: a walk of
the payload that collects every object carrying an id **and** a title **and** at
least one media marker (type, artwork, release date, rating, genre). The media
marker is what stops a row or a banner — which also carry an id and a title — from
being mistaken for a title. All eleven shapes now parse.

### 12.2 Cause that was found and fixed: failures reported inside a 200

`VaultClient` now inspects the envelope's `code`. A code of 401/403/407/429 or
5xx, with no content next to it, is raised as an error instead of being handed to
the adapters. This also triggers the existing session refresh, so a stale token
recovered from a body-level 401 re-authenticates exactly as a header-level 401
does.

### 12.3 Cause that was found and fixed: every tab failing looked like an empty list

`loadHomepage()` caught the error from each tab and carried on. If **all** tabs
failed, it returned `[]` and the UI said "Nothing here yet" — even though nothing
had answered at all. It now raises when every attempt failed, and `discovery()`
surfaces that as a provider error after one last fallback attempt. The UI's two
empty states now mean what they say again.

A time budget (9 s) was added to the tab loop: each tab has its own 12 s timeout,
so reading several of them one after another could exceed what a serverless
function is allowed to run. A partial listing beats a request that never returns.

### 12.4 The logs now print the shape, not the content

When a listing or a search comes back empty, the warning now carries a
depth-limited **skeleton** of the payload in which every value is replaced by its
type:

```
{ items: [ { banner: { banners: [ { subject: { subjectId: "number", title: "string" } } ] } } ] }
```

plus the envelope's `code`/`message` and the payload's top-level keys. This is
enough to see a shape change at a glance, and it writes no titles, no artwork
URLs and no upstream content to the logs at all. Read it with:

```
Vercel → Project → Logs → search "[vault]"
```

---

## 13. Corrections to advice received from another reviewer

The following claims were checked against this codebase and against the reference
client. Two were wrong for this API; the rest were useful and one led to a real fix.

| Claim | Verdict |
| --- | --- |
| `new URL(url)` throws on a relative path, so the query is never sorted and the signature breaks | **Wrong here.** `VaultClient` signs the *absolute* URL (`${base}${pathAndQuery}`), so `new URL()` never throws. `scripts/check-signature.mjs` prints the signed and sent query side by side and shows they match for every listing call. |
| `tab-operating` needs `host=` and `pageSize=` parameters | **Wrong for this API.** The reference client, which works against the live service, calls `?page={page}&tabId={tab_id}&version=` and nothing else. Adding parameters changes the canonical string and can only make a valid signature invalid. |
| `tab-api/all` should be used to discover tab ids dynamically | **Not supported by the reference.** It uses the literal tab id `"2"` and no discovery call. Adding an unverified endpoint risks a 404 per request. Not adopted. |
| Pin the region to `bom1`/`sin1`, prefer SG hosts, keep a stable Indian `x-forwarded-for` | **Plausible and worth trying, but unverified.** Vercel runs Hobby functions in `iad1` (US-East) by default; the service is regional. Nothing in this repo can confirm or deny geo-blocking, so no code was changed — see §13.1 for how to test it without risking the deploy. |
| A stale `version_code` / missing `X-M-Version` may gate the listing | **Unverified.** The reference sends no `X-M-Version` header and works. Do not add headers the oracle does not send; each one changes the request for no known benefit. |
| Failures reported in the body with HTTP 200 | **Correct, and it led to the fix in §12.2.** |
| The fallback search should use common title words (`"the"`, `"love"`) instead of genre words | **Sound reasoning.** The search endpoint matches title text, so genre words match nothing. See §13.2. |
| A recursive subject walker instead of brittle path lookups | **Correct, and it is the fix in §12.1.** |

### 13.1 If the shape fix does not resolve it: testing the geo hypothesis safely

The cheapest experiment, with no code change and no deploy risk:

1. Open the project's Vercel settings and change the **Functions region** from the
   default to Singapore (`sin1`) or Mumbai (`bom1`).
2. Redeploy and watch the same `[vault]` log lines.

If the payload shape changes from empty to populated, geo-blocking is the cause.
Do **not** hard-code a region in a route file until that is confirmed: on the
Hobby plan the region is a project-level setting, and a code-level pin that
conflicts with it can fail the deploy.

Note also that `HOST_POOL` already contains Singapore hosts (`api4sg`, `api6sg`).
If the deployment is moved to `sin1`, reordering the pool to prefer those is a
one-line change.

### 13.2 The last-resort fallback

`discoveryQuery()` fell back to genre words (`action`, `drama`), which the search
index cannot match — it searches titles. That fallback could therefore never
return anything, which is why it looked like the safety net was in place while it
was not. It now uses common title words (`love`, `night`, `war`, `dark`, `city`,
`girl`), which do match real titles.

---

## 14. The answer the logs finally gave: HTTP 440

The production logs after §12 settled it. Every homepage tab was answered with:

```
[vault] homepage tab failed { tabId: '2', error: 'VaultApiError: Upstream host returned 440.' }
```

`440` is not a standard HTTP status. It is the gateway's own code for "I will not
accept this session". **That was the bug all along**, and §2 of this brief read it
wrong: the empty list was never `HTTP 200 + items: []`. It was a `440` that the
provider caught per tab, discarded, and turned into `[]` — which the UI rendered as
"Nothing here yet". Every earlier theory (payload shape, tab ids, signature,
geo-blocking) was chasing an empty list that was in fact an unhandled error.

### 14.1 What the code did with a 440

Nothing useful:

1. `440` was not in `RETRY_STATUS_CODES`, so no host rotation.
2. It was not `401`/`403`, so no session refresh.
3. `request()` re-threw it immediately, because it was not retryable.
4. `loadHomepage()` caught it per tab, logged a warning, and carried on.
5. With every tab failed, it returned `[]`.
6. `discovery()` handed `[]` to the route, which answered `200 {items: []}`.
7. The section rendered "Nothing here yet".

A fatal, recoverable error became an empty shelf in six steps, and nothing in the
logs said the word "440" in a place anyone was looking.

### 14.2 The fix

- **`440` is now a session rejection**, alongside `401`/`403`. The client mints a
  fresh session and retries once. If a brand-new session is also refused, it
  rotates to another host and tries once more — because a refusal that survives a
  fresh login is about the host or the egress, not the token.
- **A rejected response's body is read and logged.** `{status, code, message, host,
  path}` and the payload keys. The reason a host gives is the single most useful
  thing in a failure, and it used to be thrown away with the response.

Expect a line like:

```
[vault] upstream rejected the request {
  status: 440, host: 'https://api6.aoneroom.com',
  path: '/wefeed-mobile-bff/tab-operating?...',
  envelopeCode: 440, envelopeMessage: '<the reason>', payloadKeys: [...]
}
```

`envelopeMessage` is what decides the next move:

| Message suggests | Next step |
| --- | --- |
| login / token / session | The retry in §14.2 should already cover it. If it still fails, the token from `visitor-login` is not the one this endpoint wants. |
| region / country / unavailable in your area | Geo-blocking. Change the Vercel functions region to `sin1`/`bom1` (§13.1). |
| version / update | The client version is being refused. Raise `VERSION_CODES` in `vaultCrypto.ts` to the current build. |
| device / banned / too many | The identity is flagged. The request is then indistinguishable from abuse and needs a different egress. |
| signature / timestamp | Re-check `scripts/check-signature.mjs`. It currently passes for every listing call. |

### 14.3 Two things that were also fixed while chasing this

- **Concurrent listing reads are shared.** One page load asked for the listing more
  than once (the section, then the movies and series fallbacks together), and each
  of those read every tab. In the logs that is why each tab id appears twice. An
  in-flight promise is now shared.
- **The last-resort search has a time ceiling (5 s).** Each call can now cost a
  retry, so an upstream that rejects everything could otherwise hold the function
  open.

*End of brief.*
