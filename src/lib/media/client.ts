"use client";

import type { MediaBrowse, MediaDetail, MediaKind, MediaQuery, MediaSearchResponse, Season } from "./types";

export class MediaApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MediaApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the status message */
    }
    throw new MediaApiError(message, res.status);
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
};
