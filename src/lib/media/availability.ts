/** Region-scoped official availability lookup. This creates search links only. */
export function justWatchSearchUrl(title: string, year?: number, country = "IN"): string {
  const region = /^[A-Za-z]{2}$/.test(country) ? country.toLowerCase() : "in";
  const url = new URL(`https://www.justwatch.com/${region}/search`);
  url.searchParams.set("q", [title, year].filter(Boolean).join(" "));
  return url.toString();
}
