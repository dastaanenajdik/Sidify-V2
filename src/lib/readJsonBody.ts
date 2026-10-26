import type { NextRequest } from "next/server";

/**
 * Reads a JSON request body without ever throwing.
 *
 * The library/playlist routes used to call `await req.json()` bare. A malformed,
 * empty or non-JSON body (a truncated upload on a flaky network, a bot probing
 * the API, `curl -d not-json`) then surfaced as an unhandled `SyntaxError` —
 * Next answered `500` with an empty body and the stack landed in the server
 * log. `null`/array/string JSON bodies crashed the same way on the
 * destructuring that followed.
 *
 * Returns the parsed value when it is a plain JSON object, and `null` for
 * anything else. Callers turn `null` into their normal `400` answer, so a bad
 * body is a client error, not a server crash.
 */
export async function readJsonBody<T extends object>(req: NextRequest): Promise<T | null> {
  try {
    const value: unknown = await req.json();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}
