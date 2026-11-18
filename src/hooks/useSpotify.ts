import { useCallback, useEffect, useRef, useState } from "react";
import { inProgress, parseAudiobooks, parseEpisodes, parseShows, playBody, type SpotifyEpisode, type SpotifyShow } from "../lib/spotifyShows";
export type { SpotifyEpisode, SpotifyShow } from "../lib/spotifyShows";

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
	"user-library-read", // saved podcasts and audiobooks
	"user-read-playback-position", // where each episode was left
	"streaming", // the in-app player (Web Playback SDK)
	"user-read-email",
	"user-read-private",
].join(" ");

const TOKEN_KEY = "spotify_access_token";
const EXPIRY_KEY = "spotify_token_expiry";
const VERIFIER_KEY = "spotify_code_verifier";
const REFRESH_KEY = "spotify_refresh_token"; // web fallback only

// ─── Web Playback SDK typings (minimal) ───────────────────────────────────────
interface SpotifyPlayer {
	addListener(event: string, cb: (state: any) => void): void;
	getCurrentState(): Promise<any | null>;
	getVolume(): Promise<number>;
	setVolume(volume: number): Promise<void>;
	resume(): Promise<void>;
	pause(): Promise<void>;
	nextTrack(): Promise<void>;
	previousTrack(): Promise<void>;
	connect(): Promise<boolean>;
	disconnect(): void;
}
declare global {
	interface Window {
		Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume?: number }) => SpotifyPlayer };
		onSpotifyWebPlaybackSDKReady?: () => void;
	}
}

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
	/** Saved podcasts and audiobooks. They need the extra permissions, so an older sign-in has to reconnect once. */
	shows: SpotifyShow[];
	audiobooks: SpotifyShow[];
	fetchShows: () => Promise<void>;
	fetchAudiobooks: () => Promise<void>;
	fetchEpisodes: (show: SpotifyShow) => Promise<SpotifyEpisode[]>;
	/** Started-but-unfinished episodes across the saved podcasts. */
	fetchContinueListening: () => Promise<SpotifyEpisode[]>;
	/** Plays episodes[index] from where it was left; audiobook chapters carry on to the next one. */
	playEpisodes: (episodes: SpotifyEpisode[], index: number) => Promise<void>;
	volume: number; // ← new
	setVolume: (pct: number) => Promise<void>; // ← new
}

/** Turns the Web Playback SDK's state (local, instant) into the same shape the Web API polling produces. */
function trackFromSdkState(state: any): SpotifyTrack | null {
	const item = state?.track_window?.current_track;
	if (!item) return null;
	return {
		id: item.id ?? item.uri,
		name: item.name,
		artists: (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
		albumName: item.album?.name ?? "",
		albumArt: item.album?.images?.[0]?.url ?? "",
		durationMs: state.duration ?? item.duration_ms ?? 0,
		progressMs: state.position ?? 0,
		isPlaying: !state.paused,
		shuffle: !!state.shuffle,
		repeat: state.repeat_mode === 2 ? "track" : state.repeat_mode === 1 ? "context" : "off",
	};
}

/** The last volume set in the app, so the player starts at it instead of a fixed 50. */
function savedVolume(): number {
	try { const v = Number(localStorage.getItem("brava-spotify-volume")); if (localStorage.getItem("brava-spotify-volume") !== null && Number.isFinite(v)) return Math.min(100, Math.max(0, Math.round(v))); } catch { /* Use the default. */ }
	return 50;
}

/** Setting key: resume the last music shortly after the app starts. Off unless switched on in Settings. */
export const RESUME_KEY = "brava-resume-music";
/** Setting key: play inside the app ("true", the default) or control the Spotify app on this device ("false"). */
export const INAPP_PLAYER_KEY = "brava-inapp-player";
export const INAPP_PLAYER_EVENT = "brava-inapp-player-changed";
const inAppPlayerWanted = (): boolean => { try { return localStorage.getItem(INAPP_PLAYER_KEY) !== "false"; } catch { return true; } };
let resumedThisLaunch = false;

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
	const [volume, setVolumeState] = useState(savedVolume);
	/** Bumped after each fresh sign-in so the in-app player restarts with the new permissions. */
	const [playerEpoch, setPlayerEpoch] = useState(0);
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
					setPlayerEpoch((n) => n + 1);
					setError(null);
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
							: res.status === 403
							? "Spotify needs more permission for this. Reconnect when parked."
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
					artists: item.show?.publisher ?? (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
					albumArt: (item.album ?? item.show ?? item)?.images?.[0]?.url ?? "",
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

	// ── Podcasts and audiobooks ──────────────────────────────────────────────
	const [shows, setShows] = useState<SpotifyShow[]>([]);
	const [audiobooks, setAudiobooks] = useState<SpotifyShow[]>([]);
	const fetchShows = useCallback(async () => {
		setIsLibraryLoading(true);
		try { setShows(parseShows(await spotifyFetch("/me/shows?limit=50"))); } finally { setIsLibraryLoading(false); }
	}, [spotifyFetch]);
	const fetchAudiobooks = useCallback(async () => {
		setIsLibraryLoading(true);
		try { setAudiobooks(parseAudiobooks(await spotifyFetch("/me/audiobooks?limit=50"))); } finally { setIsLibraryLoading(false); }
	}, [spotifyFetch]);
	const fetchEpisodes = useCallback(async (show: SpotifyShow): Promise<SpotifyEpisode[]> => {
		const path = show.kind === "audiobook" ? `/audiobooks/${show.id}/chapters?limit=50` : `/shows/${show.id}/episodes?limit=50`;
		return parseEpisodes(await spotifyFetch(path), show.name);
	}, [spotifyFetch]);
	const fetchContinueListening = useCallback(async (): Promise<SpotifyEpisode[]> => {
		// Spotify has no "continue listening" call, so look at the newest episodes of the first few saved podcasts.
		const list = shows.length ? shows : parseShows(await spotifyFetch("/me/shows?limit=50"));
		const batches = await Promise.all(list.slice(0, 8).map(show => fetchEpisodes(show)));
		return batches.flatMap(batch => inProgress(batch)).slice(0, 10);
	}, [shows, spotifyFetch, fetchEpisodes]);

	// ── Polling: fetch current playback every 3 s ────────────────────────────

	const fetchPlayback = useCallback(async () => {
		// When this app is the active player, read it locally: no network round trip, so no lag or stale values.
		const local = playerRef.current ? await playerRef.current.getCurrentState().catch((): null => null) : null;
		if (local) {
			activeDeviceRef.current = ownDeviceRef.current;
			setTrack(trackFromSdkState(local));
			if (!volumeSettleRef.current) void playerRef.current!.getVolume().then((v) => { if (!volumeSettleRef.current && typeof v === "number") setVolumeState(Math.round(v * 100)); }).catch((): void => undefined);
			return;
		}
		const data = await spotifyFetch("/me/player?additional_types=episode");
		activeDeviceRef.current = data?.device?.id ?? null;
		if (!data?.item) {
			setTrack(null);
			return;
		}
		setTrack({
			id: data.item.id,
			name: data.item.name,
			artists: data.item.show ? data.item.show.publisher ?? "" : (data.item.artists ?? [])
				.map((a: { name: string }) => a.name)
				.join(", "),
			albumName: (data.item.album ?? data.item.show)?.name ?? "",
			albumArt: (data.item.album ?? data.item.show ?? data.item)?.images?.[0]?.url ?? "",
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
		pollRef.current = setInterval(poll, 1000);
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [token, fetchPlayback]);

	// ── The app as its own Spotify player (Web Playback SDK) ──────────────────
	// Registers a "Brava" device inside this window, so no spotifyd / desktop app is needed.
	// Needs Widevine (castlabs Electron) and Premium. Other devices are still used if it can't start.
	const ownDeviceRef = useRef<string | null>(null);
	/** The Spotify device that is playing right now, as last seen. */
	const activeDeviceRef = useRef<string | null>(null);
	const playerRef = useRef<SpotifyPlayer | null>(null);
	const [ownReady, setOwnReady] = useState(false);
	const tokenRef = useRef<string | null>(token);
	tokenRef.current = token;
	const hasToken = !!token;
	const [inApp, setInApp] = useState(inAppPlayerWanted);
	useEffect(() => {
		const update = () => setInApp(inAppPlayerWanted());
		window.addEventListener(INAPP_PLAYER_EVENT, update);
		return () => window.removeEventListener(INAPP_PLAYER_EVENT, update);
	}, []);
	useEffect(() => {
		if (!hasToken || !inApp) return;
		let player: SpotifyPlayer | null = null;
		let cancelled = false;
		const start = () => {
			if (cancelled || !window.Spotify) return;
			player = new window.Spotify.Player({
				// The same plain name as the car's own player (spotifyd): Spotify shows "Brava" whichever one is playing. The app tells the two
				// apart by device id, preferring the car's own player when it is online.
				name: process.env.SPOTIFY_DEVICE_NAME || "Brava",
				getOAuthToken: (cb) => {
					const current = tokenRef.current ?? getStoredToken();
					if (current) cb(current);
					else void renewAccessToken().then((t) => { if (t) cb(t); });
				},
				volume: savedVolume() / 100,
			});
			player.addListener("ready", ({ device_id }) => { ownDeviceRef.current = device_id; setOwnReady(true); });
			player.addListener("not_ready", () => { ownDeviceRef.current = null; setOwnReady(false); });
			// Spotify skips to the next song on every playback error. If they keep coming (for example the audio licence is
			// refused), stop instead of racing through the whole playlist.
			const errorTimes: number[] = [];
			for (const kind of ["initialization_error", "authentication_error", "account_error", "playback_error"] as const) {
				player.addListener(kind, ({ message }) => {
					console.error(`Spotify player ${kind}:`, message);
					if (kind === "playback_error") {
						const now = Date.now();
						errorTimes.push(now);
						while (errorTimes.length && now - errorTimes[0] > 8000) errorTimes.shift();
						if (errorTimes.length >= 3) { errorTimes.length = 0; void player?.pause(); setError("Spotify could not play these songs in the app (audio licence refused). Playback stopped."); }
					}
					if (kind === "authentication_error") setError("Spotify needs new permissions. Tap Reconnect.");
					if (kind === "account_error") setError("Spotify Premium is needed to play in the app.");
					if (kind === "initialization_error") setError("This build cannot play Spotify audio (Widevine missing).");
				});
			}
			playerRef.current = player;
			void player.connect();
		};
		if (window.Spotify) start();
		else {
			window.onSpotifyWebPlaybackSDKReady = start;
			if (!document.getElementById("spotify-sdk")) {
				const script = document.createElement("script");
				script.id = "spotify-sdk";
				script.src = "https://sdk.scdn.co/spotify-player.js";
				script.async = true;
				document.body.appendChild(script);
			}
		}
		return () => { cancelled = true; ownDeviceRef.current = null; playerRef.current = null; player?.disconnect(); };
	}, [hasToken, playerEpoch, inApp]);

	// ── The car's own player ─────────────────────────────────────────────────
	// Nothing is "active" on a fresh start, and Spotify then refuses every command. So when nothing is
	// playing, start on the car's player by name instead of asking the user to open Spotify somewhere.
	const listDevices = useCallback(async () => {
		const data = await spotifyFetch("/me/player/devices");
		return ((data?.devices ?? []) as { name: string; id: string | null; type: string; is_active: boolean; is_restricted: boolean }[]).filter(item => item.id && !item.is_restricted);
	}, [spotifyFetch]);
	/** The car's own player (spotifyd or librespot, called "Brava"), never this app's own in-window player (which has the same name, so the two are told apart by id). */
	const findRealCar = useCallback(async (): Promise<string | null> => {
		const own = ownDeviceRef.current;
		return (await listDevices()).find(item => item.id !== own && item.name.toLowerCase() === CAR_DEVICE_NAME)?.id ?? null;
	}, [listDevices]);
	const findCarDevice = useCallback(async (): Promise<string | null> => {
		const devices = await listDevices();
		const own = ownDeviceRef.current;
		// The car's own player if it is there, then this app's player. Otherwise, so it also works on a development PC,
		// whatever is already active, then any computer running Spotify (the desktop app counts), then any device.
		const device = devices.find(item => item.id !== own && item.name.toLowerCase() === CAR_DEVICE_NAME)
			?? devices.find(item => item.id === own)
			?? devices.find(item => item.is_active)
			?? devices.find(item => item.type === "Computer")
			?? devices[0];
		return device?.id ?? own ?? null;
	}, [listDevices]);
	/** Adds the car's player to a play request when nothing is active yet, or when something else is playing but the car's player is available. */
	const onCarDevice = useCallback(async (path: string): Promise<string> => {
		const withDevice = (id: string) => `${path}${path.includes("?") ? "&" : "?"}device_id=${id}`;
		if (track) {
			const car = await findRealCar();
			return car && car !== activeDeviceRef.current ? withDevice(car) : path;
		}
		const id = await findCarDevice();
		return id ? withDevice(id) : path;
	}, [track, findCarDevice, findRealCar]);

	// ── Optional: carry on with the last music a few seconds after start-up (Settings > Music on start) ──
	// Once per launch, and never takes over a phone or other device that is already playing.
	useEffect(() => {
		// With the in-app player, wait until it has registered; with the car's own player (spotifyd) there is nothing to wait for.
		if (resumedThisLaunch || (inApp ? !ownReady : !hasToken)) return;
		let wanted = false;
		try { wanted = localStorage.getItem(RESUME_KEY) === "true"; } catch { /* Off. */ }
		if (!wanted) return;
		const timer = setTimeout(() => {
			resumedThisLaunch = true;
			void (async () => {
				const current = await spotifyFetch("/me/player");
				if (current?.is_playing) return;
				const id = await findCarDevice();
				if (id) await spotifyFetch("/me/player", "PUT", { device_ids: [id], play: true }).catch((): void => undefined);
			})();
		}, 3000);
		return () => clearTimeout(timer);
	}, [ownReady, hasToken, inApp, spotifyFetch, findCarDevice]);

	/** True when this app is the active Spotify player, so controls can run locally and instantly. */
	const localPlayer = useCallback(async (): Promise<boolean> => !!playerRef.current && !!(await playerRef.current.getCurrentState().catch((): null => null)), []);

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
		if (await localPlayer()) { await playerRef.current!.resume(); setTrack((t) => t && { ...t, isPlaying: true }); return; }
		await spotifyFetch("/me/player/play", "PUT");
		setTrack((t) => t && { ...t, isPlaying: true });
	}, [spotifyFetch, track, findCarDevice, fetchPlayback]);

	const pause = useCallback(async () => {
		setTrack((t) => t && { ...t, isPlaying: false });
		if (await localPlayer()) { await playerRef.current!.pause(); return; }
		await spotifyFetch("/me/player/pause", "PUT");
	}, [spotifyFetch]);

	const next = useCallback(async () => {
		if (await localPlayer()) { await playerRef.current!.nextTrack(); setTimeout(() => { void fetchPlayback().catch(() => setTrack(null)); }, 250); return; }
		await spotifyFetch("/me/player/next", "POST");
		setTimeout(() => {
			void fetchPlayback().catch(() => setTrack(null));
		}, 600);
	}, [spotifyFetch, fetchPlayback]);

	const previous = useCallback(async () => {
		if (await localPlayer()) { await playerRef.current!.previousTrack(); setTimeout(() => { void fetchPlayback().catch(() => setTrack(null)); }, 250); return; }
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
			setVolumeState(pct);
			try { localStorage.setItem("brava-spotify-volume", String(pct)); } catch { /* Keep it for this session. */ }
			if (await localPlayer()) await playerRef.current!.setVolume(pct / 100);
			else await spotifyFetch(`/me/player/volume?volume_percent=${pct}`, "PUT");
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

	const playEpisodes = useCallback(
		async (episodes: SpotifyEpisode[], index: number) => {
			if (!episodes[index]) return;
			await spotifyFetch(await onCarDevice("/me/player/play"), "PUT", playBody(episodes, index));
			setTimeout(() => {
				void fetchPlayback().catch(() => setTrack(null));
			}, 600);
		},
		[spotifyFetch, fetchPlayback, onCarDevice],
	);

	return {
		error,
		shows,
		audiobooks,
		fetchShows,
		fetchAudiobooks,
		fetchEpisodes,
		fetchContinueListening,
		playEpisodes,
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
