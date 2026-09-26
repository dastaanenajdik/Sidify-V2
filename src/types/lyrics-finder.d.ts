declare module "lyrics-finder" {
  const findLyrics: (title: string, artist?: string) => Promise<string>;
  export default findLyrics;
}
