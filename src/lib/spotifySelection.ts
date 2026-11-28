/** Start exactly the chosen song even when Spotify shuffle is enabled, then queue the remaining loaded songs. */
export async function playLikedSelection(uris: string[], play: (uri: string) => Promise<void>, enqueue: (uri: string) => Promise<void>): Promise<void> {
 if (!uris.length) return;
 await play(uris[0]);
 for (const uri of uris.slice(1)) await enqueue(uri);
}
