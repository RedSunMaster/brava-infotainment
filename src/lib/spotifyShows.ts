/** Podcasts and audiobooks from the Spotify Web API, reduced to what the library shows. */
export interface SpotifyShow { id: string; name: string; publisher: string; imageUrl: string; uri: string; kind: "show" | "audiobook" }
export interface SpotifyEpisode {
	id: string; name: string; uri: string; imageUrl: string; durationMs: number;
	/** Where the listener got to last time, in ms (0 when never started or finished). */
	resumeMs: number;
	fullyPlayed: boolean;
	/** The show or book this belongs to; filled in for "continue listening". */
	showName?: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const firstImage = (item: { images?: { url?: unknown }[] } | undefined): string => text(item?.images?.[0]?.url);

export function parseShows(data: unknown): SpotifyShow[] {
	const items = (data as { items?: unknown[] } | null)?.items;
	if (!Array.isArray(items)) return [];
	return items.flatMap((entry: any) => {
		const show = entry?.show ?? entry;
		return text(show?.id) && text(show?.uri) ? [{ id: show.id, name: text(show.name), publisher: text(show.publisher), imageUrl: firstImage(show), uri: show.uri, kind: "show" as const }] : [];
	});
}

export function parseAudiobooks(data: unknown): SpotifyShow[] {
	const items = (data as { items?: unknown[] } | null)?.items;
	if (!Array.isArray(items)) return [];
	return items.flatMap((entry: any) => {
		const book = entry?.audiobook ?? entry;
		if (!text(book?.id) || !text(book?.uri)) return [];
		const authors = Array.isArray(book.authors) ? book.authors.map((a: { name?: unknown }) => text(a?.name)).filter(Boolean).join(", ") : "";
		return [{ id: book.id, name: text(book.name), publisher: authors, imageUrl: firstImage(book), uri: book.uri, kind: "audiobook" as const }];
	});
}

export function parseEpisodes(data: unknown, showName?: string): SpotifyEpisode[] {
	const items = (data as { items?: unknown[] } | null)?.items;
	if (!Array.isArray(items)) return [];
	return items.flatMap((item: any) => {
		if (!item || !text(item.id) || !text(item.uri)) return [];
		const fullyPlayed = item.resume_point?.fully_played === true;
		const resume = Number(item.resume_point?.resume_position_ms);
		return [{ id: item.id, name: text(item.name), uri: item.uri, imageUrl: firstImage(item), durationMs: Number(item.duration_ms) || 0, resumeMs: !fullyPlayed && Number.isFinite(resume) && resume > 0 ? Math.round(resume) : 0, fullyPlayed, ...(showName ? { showName } : {}) }];
	});
}

/** Episodes that were started but not finished, the ones worth offering under "Continue listening". */
export const inProgress = (episodes: SpotifyEpisode[]): SpotifyEpisode[] => episodes.filter(item => item.resumeMs > 0 && !item.fullyPlayed);

/** "12 min left", "1 h 5 min left", or the full length when not started. */
export function describeProgress(episode: SpotifyEpisode): string {
	const total = Math.round(episode.durationMs / 60000);
	if (episode.fullyPlayed) return "Played";
	const left = Math.max(1, Math.round((episode.durationMs - episode.resumeMs) / 60000));
	const fmt = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`);
	return episode.resumeMs > 0 ? `${fmt(left)} left` : fmt(Math.max(1, total));
}

/** Play request body: this episode from where it was left, followed by the rest when the caller lists them (audiobook chapters). */
export function playBody(episodes: SpotifyEpisode[], index: number): { uris: string[]; position_ms?: number } {
	const chosen = episodes[index];
	const body: { uris: string[]; position_ms?: number } = { uris: episodes.slice(index, index + 100).map(item => item.uri) };
	if (chosen && chosen.resumeMs > 0 && !chosen.fullyPlayed) body.position_ms = chosen.resumeMs;
	return body;
}
