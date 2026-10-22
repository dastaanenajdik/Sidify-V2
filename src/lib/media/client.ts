"use client";

import type {
  MediaBrowse,
  MediaDetail,
  MediaKind,
  MediaQuery,
  MediaSearchResponse,
  MirrorResolveResult,
  Season,
} from "./types";

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

function queryString(query: MediaQuery & { page?: number; type?: string; limit?: number }): string {
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

  detail: (kind: MediaKind, slug: string) =>
    fetch(`/api/media/title/${kind}/${encodeURIComponent(slug)}`).then((r) => json<MediaDetail>(r)),

  season: (slug: string, seasonNumber: number) =>
    fetch(`/api/media/seasons/${encodeURIComponent(slug)}?season=${seasonNumber}`).then((r) =>
      json<{ seasons: Season[] }>(r)
    ),

  resolveMirror: async (params: { url: string; fileName?: string; label?: string }): Promise<MirrorResolveResult> => {
    const res = await fetch("/api/media/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(params),
    });
    const payload = (await res.json().catch(() => null)) as MirrorResolveResult | { error?: string; code?: string } | null;
    if (payload && "hops" in payload && Array.isArray(payload.hops)) {
      return payload;
    }
    const errMessage =
      payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Mirror resolution failed (${res.status})`;
    const errCode = payload && "code" in payload ? payload.code : undefined;
    throw new MediaApiError(errMessage, res.status, errCode);
  },
};
