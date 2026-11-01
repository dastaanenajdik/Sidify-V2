/** Remove catalogue branding from text shown in the app, never from URLs or resolver input. */
export function mediaDisplayText(value: string | null | undefined, fallback = ""): string {
  if (!value) return fallback;
  const cleaned = value
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:4khdhub|hdhub4ua?)(?:\.(?:com|one|tv|to|in|net|org|lol|fans|click|dad|foo|site|xyz|pro|cc|io))?/gi, "")
    .replace(/\[\s*\]|\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s._|\-]+|[\s_|\-]+$/g, "")
    .trim();
  return cleaned || fallback;
}
