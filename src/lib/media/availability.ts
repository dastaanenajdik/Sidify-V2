/**
 * Region-scoped official availability lookup. This creates search links only, and the UI
 * shows them under a neutral label — no upstream service name is ever written on the site.
 */
export function justWatchSearchUrl(title: string, year?: number, country = "IN"): string {
  const region = /^[A-Za-z]{2}$/.test(country) ? country.toLowerCase() : "in";
  const url = new URL(`https://www.justwatch.com/${region}/search`);
  url.searchParams.set("q", [title, year].filter(Boolean).join(" "));
  return url.toString();
}
