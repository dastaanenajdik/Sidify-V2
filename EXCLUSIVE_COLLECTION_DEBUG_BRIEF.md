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

*End of brief.*
