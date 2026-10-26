"use client";

import type {
  ExclusiveHome,
  ExclusiveQuery,
  ExclusiveSearchPage,
  ExclusiveSuggestions,
  ExclusiveTitleResponse,
  MediaBrowse,
  MediaDetail,
  MediaKind,
  MediaQuery,
  MediaSearchResponse,
  MirrorResolveResult,
  Season,
} from "./types";
import { reportMediaDiagnostic } from "./diagnostics";

export class MediaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "MediaApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; message?: string; code?: string; reason?: string };
      if (body?.error || body?.message) message = body.error || body.message || message;
      code = body?.code || body?.reason;
    } catch {
      /* keep the status message */
    }
    throw new MediaApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

function queryString(
  query: MediaQuery & {
    page?: number;
    type?: string;
    limit?: number;
    mode?: string;
    genre?: string;
    year?: string;
    language?: string;
    sort?: string;
  }
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** The client-side transport for the media catalogue. Same-origin, no keys. */
export const mediaApi = {
  browse: (kind: MediaKind, query: MediaQuery, page = 1) =>
    fetch(`/api/media/browse?${queryString({ ...query, type: kind, page })}`).then((r) => json<MediaBrowse>(r)),

  search: (q: string, kind: MediaKind | "all" = "all", limit = 24) =>
    fetch(`/api/media/search?${queryString({ q, type: kind, limit })}`).then((r) => json<MediaSearchResponse>(r)),

  /** The exclusive landing page: spotlight, rails, genres and facets. */
  exclusiveHome: (kind: MediaKind | "all" = "all") =>
    fetch(`/api/media/exclusive?${queryString({ mode: "home", type: kind })}`).then((r) => json<ExclusiveHome>(r)),

  /** A filtered, sorted, paginated page of the exclusive collection. */
  exclusiveSearch: (params: ExclusiveQuery) =>
    fetch(
      `/api/media/exclusive?${queryString({
        mode: "search",
        q: params.q,
        type: params.kind ?? "all",
        genre: params.genre,
        year: params.year,
        language: params.language,
        sort: params.sort,
        page: params.page,
        limit: params.limit,
      })}`
    ).then((r) => json<ExclusiveSearchPage>(r)),

  /** One exclusive title with its own playback sources and recommendations. */
  exclusiveTitle: (slug: string, kind?: MediaKind) =>
    fetch(`/api/media/exclusive/title/${encodeURIComponent(slug)}${kind ? `?type=${kind}` : ""}`).then((r) =>
      json<ExclusiveTitleResponse>(r)
    ),

  /** Typeahead for the exclusive search field. */
  exclusiveSuggest: (q: string, limit = 8) =>
    fetch(`/api/media/exclusive/suggest?${queryString({ q, limit })}`).then((r) => json<ExclusiveSuggestions>(r)),

  detail: (kind: MediaKind, slug: string) =>
    fetch(`/api/media/title/${kind}/${encodeURIComponent(slug)}`).then((r) => json<MediaDetail>(r)),

  season: (slug: string, seasonNumber: number) =>
    fetch(`/api/media/seasons/${encodeURIComponent(slug)}?season=${seasonNumber}`).then((r) =>
      json<{ seasons: Season[] }>(r)
    ),

  /**
   * Resolve a mirror short-link into direct links (server-side HTML hops only — media is
   * never proxied). `refresh: true` requests one fresh resolution after cached links failed.
   *
   * Throws `MediaApiError` when the route's JSON contract didn't come back:
   *   - `non_json_response`: something in front of the app answered instead (e.g. a 401
   *     HTML page from Vercel Deployment Protection),
   *   - `network`: the request itself failed.
   * An aborted request rethrows the original `AbortError`.
   */
  resolveMirror: async (params: {
    url: string;
    fileName?: string;
    label?: string;
    /** Which catalogue the mirror belongs to, so the right resolver answers. */
    source?: "vault";
    /** Upstream request headers (e.g. a signed CDN cookie) to relay server-side. */
    headers?: Array<[string, string]>;
    refresh?: boolean;
    signal?: AbortSignal;
  }): Promise<MirrorResolveResult> => {
    const { signal, ...body } = params;
    let res: Response;
    try {
      res = await fetch("/api/media/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Same-origin cookies must ride along. On a Vercel deployment with Deployment
        // Protection, the `_vercel_jwt` cookie is what lets this request reach the route at
        // all — with `omit` every resolve got Vercel's 401 page on previews. The route never
        // reads these cookies and never forwards anything from the caller upstream.
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === "AbortError") throw err;
      reportMediaDiagnostic("resolve request failed", { stage: "resolve-api", error: (err as Error)?.name || "Error" });
      throw new MediaApiError("Mirror resolution request failed", 0, "network");
    }

    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
    const payload = (await res.json().catch(() => null)) as MirrorResolveResult | { error?: string; code?: string } | null;
    if (payload && "hops" in payload && Array.isArray(payload.hops)) {
      return payload;
    }

    const nonJson = payload === null;
    const errMessage =
      payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Mirror resolution failed (${res.status})`;
    const errCode = nonJson ? "non_json_response" : payload && "code" in payload ? payload.code : undefined;
    reportMediaDiagnostic("resolve API did not return a result", {
      stage: "resolve-api",
      httpStatus: res.status,
      contentType,
      redirected: res.redirected,
      code: errCode,
      hint:
        nonJson && (res.status === 401 || res.status === 403)
          ? "An auth wall answered before the app (e.g. Vercel Deployment Protection)."
          : undefined,
    });
    throw new MediaApiError(errMessage, res.status, errCode);
  },
};
