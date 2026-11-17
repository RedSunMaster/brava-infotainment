import { useCallback, useEffect, useRef, useState } from "react";

// Use SPOTIFY_CLIENT_ID — set this in your .env (no NEXT_PUBLIC_ prefix in Electron)
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
/** The name the car's own Spotify player (spotifyd or librespot) registers under; see SPOTIFY_PLAYER.md. */
const CAR_DEVICE_NAME = (process.env.SPOTIFY_DEVICE_NAME || "Brava").toLowerCase();
const REDIRECT_URI = "myapp://callback"; // must match Spotify dashboard exactly

const SCOPES = [
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"playlist-read-private",
	"playlist-read-collaborative",
].join(" ");

const TOKEN_KEY = "spotify_access_token";
const EXPIRY_KEY = "spotify_token_expiry";
const VERIFIER_KEY = "spotify_code_verifier";
const REFRESH_KEY = "spotify_refresh_token"; // web fallback only

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateVerifier(length = 128): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
	return Array.from(crypto.getRandomValues(new Uint8Array(length)))
		.map((b) => chars[b % chars.length])
		.join("");
}

async function generateChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function getStoredToken(): string | null {
	const token = localStorage.getItem(TOKEN_KEY);
	const expiry = localStorage.getItem(EXPIRY_KEY);
	if (!token || !expiry) return null;
	if (Date.now() > parseInt(expiry, 10)) {
		localStorage.removeItem(TOKEN_KEY);
		localStorage.removeItem(EXPIRY_KEY);
		return null;
	}
	return token;
}

// The refresh token lives in the main process, encrypted; the renderer only asks for it.
async function readRefreshToken(): Promise<string | null> {
	const ipc = getIpc();
	if (ipc) return (await ipc.invoke("spotify-refresh-get")) ?? null;
	return localStorage.getItem(REFRESH_KEY);
}
async function saveRefreshToken(token: string | null): Promise<void> {
	const ipc = getIpc();
	if (ipc) await ipc.invoke("spotify-refresh-set", token);
	else if (token) localStorage.setItem(REFRESH_KEY, token);
	else localStorage.removeItem(REFRESH_KEY);
}

/** One renewal at a time: Spotify may replace the refresh token on every use, so two at once would break it. */
let renewal: Promise<string | null> | null = null;
/** Swaps the saved refresh token for a new access token. Resolves null if there is none or it was refused. */
function renewAccessToken(): Promise<string | null> {
	if (renewal) return renewal;
	renewal = (async () => {
		const refresh = await readRefreshToken();
		if (!refresh) return null;
		try {
			const res = await fetch("https://accounts.spotify.com/api/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refresh }),
			});
			const data = await res.json().catch((): null => null);
			if (res.ok && data?.access_token) {
				storeToken(data.access_token, data.expires_in);
				if (data.refresh_token) await saveRefreshToken(data.refresh_token);
				return data.access_token as string;
			}
			// Spotify said no (revoked or expired): forget it so the next connect starts clean.
			if (res.status === 400 || res.status === 401) await saveRefreshToken(null);
		} catch {
			// Offline: keep the saved token and try again later.
		}
		return null;
	})().finally(() => { renewal = null; });
	return renewal;
}

function storeToken(token: string, expiresIn: number): void {
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotifyTrack {
	id: string;
	name: string;
	artists: string;
	albumName: string;
	albumArt: string;
	durationMs: number;
	progressMs: number;
	isPlaying: boolean;
	shuffle: boolean;
	repeat: "off" | "track" | "context";
}
export interface SpotifyQueueItem {
	id: string;
	name: string;
	artists: string;
	albumArt: string;
	durationMs: number;
	uri: string;
}

export interface SpotifyPlaylist {
	id: string;
	name: string;
	imageUrl: string;
	tracksTotal: number;
	uri: string;
}
export interface UseSpotifyReturn {
	error: string | null;
	track: SpotifyTrack | null;
	isConnected: boolean;
	isLoading: boolean;
	isLibraryLoading: boolean; // ← new
	queue: SpotifyQueueItem[]; // ← new
	playlists: SpotifyPlaylist[]; // ← new
	searchResults: SpotifyQueueItem[]; // ← new
	connect: () => Promise<void>;
	play: () => Promise<void>;
	pause: () => Promise<void>;
	next: () => Promise<void>;
	previous: () => Promise<void>;
	toggleShuffle: () => Promise<void>;
	cycleRepeat: () => Promise<void>;
	fetchQueue: () => Promise<void>; // ← new
	fetchPlaylists: () => Promise<void>; // ← new
	search: (query: string) => Promise<void>; // ← new
	playTrack: (uri: string) => Promise<void>; // ← new
	playContext: (contextUri: string, offsetTrackUri?: string) => Promise<void>; // ← new
	volume: number; // ← new
	setVolume: (pct: number) => Promise<void>; // ← new
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpotify(): UseSpotifyReturn {
	const [error, setError] = useState<string | null>(null);
	const [token, setToken] = useState<string | null>(() =>
		typeof window !== "undefined" ? getStoredToken() : null,
	);
	const [track, setTrack] = useState<SpotifyTrack | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const [queue, setQueue] = useState<SpotifyQueueItem[]>([]);
	const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
	const [searchResults, setSearchResults] = useState<SpotifyQueueItem[]>([]);
	const [isLibraryLoading, setIsLibraryLoading] = useState(false);
	const [volume, setVolumeState] = useState(50);
	const volumeSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Shared token exchange (used by both Electron IPC and web fallback) ───
	const exchangeCode = useCallback((code: string, verifier: string) => {
		setIsLoading(true);
		fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				grant_type: "authorization_code",
				code,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier,
			}),
		})
			.then((r) => r.json())
			.then((data) => {
				if (data.access_token) {
					storeToken(data.access_token, data.expires_in);
					if (data.refresh_token) void saveRefreshToken(data.refresh_token);
					setToken(data.access_token);
				}
			})
			.catch((e) => console.error("Spotify token exchange failed:", e))
			.finally(() => setIsLoading(false));
	}, []);

	// ── Staying connected: with no access token, try the saved refresh token (this is what happens at
	// start-up); with one, renew it shortly before it runs out. Either way there is nothing to sign in to. ──
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (!token) {
			void renewAccessToken().then((renewed) => { if (!cancelled && renewed) setToken(renewed); });
		} else {
			const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10);
			timer = setTimeout(() => {
				void renewAccessToken().then((renewed) => { if (!cancelled && renewed) setToken(renewed); });
			}, Math.max(5_000, expiry - Date.now() - 120_000));
		}
		return () => { cancelled = true; if (timer) clearTimeout(timer); };
	}, [token]);

	// ── OAuth: initiate PKCE — opens system browser via Electron IPC ─────────

	const connect = useCallback(async () => {
		const verifier = generateVerifier();
		const challenge = await generateChallenge(verifier);
		localStorage.setItem(VERIFIER_KEY, verifier);

		const params = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: REDIRECT_URI,
			scope: SCOPES,
			code_challenge_method: "S256",
			code_challenge: challenge,
		});

		const authUrl = `https://accounts.spotify.com/authorize?${params}`;

		const ipc = getIpc();
		if (ipc) {
			// Electron: tell main to open the auth BrowserWindow
			ipc.send("spotify-open-auth", authUrl);
		} else {
			// Web dev fallback
			window.location.href = authUrl;
		}
	}, []);

	// ── OAuth: handle callback — IPC in Electron, URL params on web ──────────

	useEffect(() => {
		const ipc = getIpc();

		if (ipc) {
			// Electron: listen for the code from the intercepted myapp://callback
			const handler = (
				_event: unknown,
				payload: { code: string | null; error: string | null },
			) => {
				if (payload.error || !payload.code) {
					console.error("Spotify auth error:", payload.error);
					return;
				}
				const verifier = localStorage.getItem(VERIFIER_KEY);
				if (!verifier) return;
				localStorage.removeItem(VERIFIER_KEY);
				exchangeCode(payload.code, verifier);
			};

			ipc.on("spotify-auth-callback", handler);
			return () => ipc.removeListener("spotify-auth-callback", handler);
		} else {
			// Web fallback: parse ?code= from the URL after redirect
			const params = new URLSearchParams(window.location.search);
			const code = params.get("code");
			const verifier = localStorage.getItem(VERIFIER_KEY);
			if (!code || !verifier) return;
			window.history.replaceState({}, "", window.location.pathname);
			localStorage.removeItem(VERIFIER_KEY);
			exchangeCode(code, verifier);
		}
	}, [exchangeCode]);
	// ── API helper ───────────────────────────────────────────────────────────

	const spotifyFetch = useCallback(
		async (path: string, method = "GET", body?: object) => {
			try {
				if (method !== "GET") setError(null);
				if (!token) throw new Error("Connect Spotify first.");
				const send = (bearer: string) => fetch(`https://api.spotify.com/v1${path}`, {
					method,
					headers: {
						Authorization: `Bearer ${bearer}`,
						...(body ? { "Content-Type": "application/json" } : {}),
					},
					body: body ? JSON.stringify(body) : undefined,
				});
				let res = await send(token);
				if (res.status === 401) {
					// The access token ran out: renew it quietly and try once more.
					const renewed = await renewAccessToken();
					if (renewed) { setToken(renewed); res = await send(renewed); }
				}
				if (res.status === 401) {
					setToken(null);
					localStorage.removeItem(TOKEN_KEY);
					localStorage.removeItem(EXPIRY_KEY);
					throw new Error("Spotify session expired. Reconnect when parked.");
				}
				if (res.status === 204 || res.status === 202 || res.status === 200)
					return res.headers.get("content-type")?.includes("json")
						? res.json().catch((): null => null)
						: null;
				throw new Error(
					res.status === 404
						? "No Spotify playback device is active."
						: res.status === 429
							? "Spotify is busy. Try again shortly."
							: "Spotify could not complete this action.",
				);
			} catch (cause) {
				setError(
					cause instanceof Error ? cause.message : "Spotify is unavailable.",
				);
				if (method === "GET") return null;
				throw cause;
			}
		},
		[token],
	);

	const fetchQueue = useCallback(async () => {
		setIsLibraryLoading(true);
		const data = await spotifyFetch("/me/player/queue");
		if (data?.queue) {
			setQueue(
				(data.queue as any[]).slice(0, 30).map((item) => ({
					id: item.id,
					name: item.name,
					artists: item.artists.map((a: { name: string }) => a.name).join(", "),
					albumArt: item.album?.images?.[0]?.url ?? "",
					durationMs: item.duration_ms,
					uri: item.uri,
				})),
			);
		}
		setIsLibraryLoading(false);
	}, [spotifyFetch]);

	const fetchPlaylists = useCallback(async () => {
		setIsLibraryLoading(true);
		const data = await spotifyFetch("/me/playlists?limit=50");
		if (data?.items) {
			setPlaylists(
				(data.items as any[]).map((pl) => ({
					id: pl.id,
					name: pl.name,
					imageUrl: pl.images?.[0]?.url ?? "",
					tracksTotal: pl.tracks?.total ?? 0,
					uri: pl.uri,
				})),
			);
		}
		setIsLibraryLoading(false);
	}, [spotifyFetch]);

	const search = useCallback(
		async (query: string) => {
			if (!query.trim()) {
				setSearchResults([]);
				return;
			}
			setIsLibraryLoading(true);
			const data = await spotifyFetch(
				`/search?q=${encodeURIComponent(query)}&type=track&limit=20`,
			);
			if (data?.tracks?.items) {
				setSearchResults(
					(data.tracks.items as any[]).map((item) => ({
						id: item.id,
						name: item.name,
						artists: item.artists
							.map((a: { name: string }) => a.name)
							.join(", "),
						albumArt: item.album?.images?.[0]?.url ?? "",
						durationMs: item.duration_ms,
						uri: item.uri,
					})),
				);
			}
			setIsLibraryLoading(false);
		},
		[spotifyFetch],
	);

	// ── Polling: fetch current playback every 3 s ────────────────────────────

	const fetchPlayback = useCallback(async () => {
		const data = await spotifyFetch("/me/player");
		if (!data?.item) {
			setTrack(null);
			return;
		}
		setTrack({
			id: data.item.id,
			name: data.item.name,
			artists: data.item.artists
				.map((a: { name: string }) => a.name)
				.join(", "),
			albumName: data.item.album.name,
			albumArt: data.item.album.images?.[0]?.url ?? "",
			durationMs: data.item.duration_ms,
			progressMs: data.progress_ms ?? 0,
			isPlaying: data.is_playing,
			shuffle: data.shuffle_state,
			repeat: data.repeat_state as SpotifyTrack["repeat"],
		});
		if (!volumeSettleRef.current) {
			setVolumeState(data.device?.volume_percent ?? 50);
		}
	}, [spotifyFetch]);

	useEffect(() => {
		if (!token) {
			setTrack(null);
			return;
		}
		const poll = () => fetchPlayback().catch(() => setTrack(null));
		poll();
		pollRef.current = setInterval(poll, 3000);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [token, fetchPlayback]);

	// ── The car's own player ─────────────────────────────────────────────────
	// Nothing is "active" on a fresh start, and Spotify then refuses every command. So when nothing is
	// playing, start on the car's player by name instead of asking the user to open Spotify somewhere.
	const findCarDevice = useCallback(async (): Promise<string | null> => {
		const data = await spotifyFetch("/me/player/devices");
		const devices: { name: string; id: string | null; type: string; is_active: boolean; is_restricted: boolean }[] = (data?.devices ?? []).filter((item: { id: string | null; is_restricted: boolean }) => item.id && !item.is_restricted);
		// The car's own player if it is there. Otherwise, so it also works on a development PC, whatever is
		// already active, then any computer running Spotify (the desktop app counts), then any device.
		const device = devices.find((item) => item.name.toLowerCase() === CAR_DEVICE_NAME)
			?? devices.find((item) => item.is_active)
			?? devices.find((item) => item.type === "Computer")
			?? devices[0];
		return device?.id ?? null;
	}, [spotifyFetch]);
	/** Adds the car's player to a play request when nothing is active yet. */
	const onCarDevice = useCallback(async (path: string): Promise<string> => {
		if (track) return path;
		const id = await findCarDevice();
		return id ? `${path}${path.includes("?") ? "&" : "?"}device_id=${id}` : path;
	}, [track, findCarDevice]);

	// ── Playback controls ────────────────────────────────────────────────────

	const play = useCallback(async () => {
		if (!track) {
			// Nothing active: wake the car's player and carry on with what it last played.
			const id = await findCarDevice();
			if (id) {
				await spotifyFetch("/me/player", "PUT", { device_ids: [id], play: true });
				setTimeout(() => { void fetchPlayback().catch(() => setTrack(null)); }, 800);
				return;
			}
		}
		await spotifyFetch("/me/player/play", "PUT");
		setTrack((t) => t && { ...t, isPlaying: true });
	}, [spotifyFetch, track, findCarDevice, fetchPlayback]);

	const pause = useCallback(async () => {
		await spotifyFetch("/me/player/pause", "PUT");
		setTrack((t) => t && { ...t, isPlaying: false });
	}, [spotifyFetch]);

	const next = useCallback(async () => {
		await spotifyFetch("/me/player/next", "POST");
		setTimeout(() => {
			void fetchPlayback().catch(() => setTrack(null));
		}, 600);
	}, [spotifyFetch, fetchPlayback]);

	const previous = useCallback(async () => {
		await spotifyFetch("/me/player/previous", "POST");
		setTimeout(() => {
			void fetchPlayback().catch(() => setTrack(null));
		}, 600);
	}, [spotifyFetch, fetchPlayback]);

	const toggleShuffle = useCallback(async () => {
		const next = !track?.shuffle;
		await spotifyFetch(`/me/player/shuffle?state=${next}`, "PUT");
		setTrack((t) => t && { ...t, shuffle: next });
	}, [spotifyFetch, track?.shuffle]);

	const cycleRepeat = useCallback(async () => {
		const next =
			track?.repeat === "off"
				? "context"
				: track?.repeat === "context"
					? "track"
					: "off";
		await spotifyFetch(`/me/player/repeat?state=${next}`, "PUT");
		setTrack((t) => t && { ...t, repeat: next });
	}, [spotifyFetch, track?.repeat]);

	const setVolume = useCallback(
		async (pct: number) => {
			await spotifyFetch(`/me/player/volume?volume_percent=${pct}`, "PUT");
			setVolumeState(pct);
			// Block fetchPlayback from overwriting this for 2s
			if (volumeSettleRef.current) clearTimeout(volumeSettleRef.current);
			volumeSettleRef.current = setTimeout(() => {
				volumeSettleRef.current = null;
			}, 2000);
		},
		[spotifyFetch],
	);

	const playTrack = useCallback(
		async (uri: string) => {
			await spotifyFetch(await onCarDevice("/me/player/play"), "PUT", { uris: [uri] });
			setTimeout(() => {
				void fetchPlayback().catch(() => setTrack(null));
			}, 600);
		},
		[spotifyFetch, fetchPlayback, onCarDevice],
	);

	const playContext = useCallback(
		async (contextUri: string, offsetTrackUri?: string) => {
			const body: Record<string, unknown> = { context_uri: contextUri };
			if (offsetTrackUri) body.offset = { uri: offsetTrackUri };
			await spotifyFetch(await onCarDevice("/me/player/play"), "PUT", body);
			setTimeout(() => {
				void fetchPlayback().catch(() => setTrack(null));
			}, 600);
		},
		[spotifyFetch, fetchPlayback, onCarDevice],
	);

	return {
		error,
		track,
		isConnected: !!token,
		isLoading,
		isLibraryLoading,
		queue,
		playlists,
		searchResults,
		connect,
		play,
		pause,
		next,
		previous,
		toggleShuffle,
		cycleRepeat,
		fetchQueue,
		fetchPlaylists,
		search,
		playTrack,
		playContext,
		volume,
		setVolume,
	};
}
// ─── Electron IPC helper ──────────────────────────────────────────────────────
// nodeIntegration: true means we can require electron directly in the renderer
function getIpc() {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return (window as any).require("electron").ipcRenderer ?? null;
	} catch {
		return null;
	}
}
