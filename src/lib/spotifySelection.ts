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

/** A URI list cannot use Spotify's context offset; put the selected song first instead. */
export function likedPlaybackUris(uris: string[], selected?: string): string[] {
 const index = selected ? uris.indexOf(selected) : -1;
 return index < 0 ? uris : [uris[index], ...uris.slice(0, index), ...uris.slice(index + 1)];
}

/** Spotify can choose another track if a new context starts while shuffle is on. */
export async function playSelectedWithShuffle(options: {
 shuffle: boolean;
 setShuffle: (enabled: boolean) => Promise<void>;
 start: () => Promise<void>;
 waitForShuffleOff: () => Promise<void>;
 waitForSelection: () => Promise<void>;
}): Promise<void> {
 if (!options.shuffle) { await options.start(); return; }
 await options.setShuffle(false);
 try {
  await options.waitForShuffleOff();
  await options.start();
  await options.waitForSelection();
 } finally {
  await options.setShuffle(true);
 }
}
