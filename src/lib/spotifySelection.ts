/** Load all saved tracks, including pages that have not been opened in the library. */
export async function loadLikedUris(fetchPage: (offset: number) => Promise<{ items: any[]; next: string | null } | null>): Promise<string[]> {
 const uris: string[] = [];
 let offset = 0;
 for (;;) {
  const page = await fetchPage(offset);
  if (!page || !Array.isArray(page.items)) throw new Error("Could not load all liked songs. Try again.");
  for (const item of page.items) if (item?.track?.uri && item.track.type === "track" && !item.track.is_local) uris.push(item.track.uri);
  if (!page.next) return uris;
  if (!page.items.length) throw new Error("Could not load all liked songs. Try again.");
  offset += page.items.length;
 }
}
