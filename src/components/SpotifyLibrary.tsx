import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import PlaylistAddRounded from "@mui/icons-material/PlaylistAddRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import VerticalAlignTopRounded from "@mui/icons-material/VerticalAlignTopRounded";
import QueuePlayNextRounded from "@mui/icons-material/QueuePlayNextRounded";
import GraphicEqRounded from "@mui/icons-material/GraphicEqRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import FavoriteRounded from "@mui/icons-material/FavoriteRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
	Box,
	CircularProgress,
	InputBase,
	Typography,
} from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import {
	SpotifyEpisode,
	SpotifyQueueItem,
	SpotifyShow,
	UseSpotifyReturn,
} from "../hooks/useSpotify";
import { describeProgress } from "../lib/spotifyShows";
import QuietNotice from "./QuietNotice";
import DriveButton from "./DriveButton";
import { useKeyboard } from "../contexts/KeyboardContext";

const SPOTIFY_GREEN = "#1DB954";

type LibraryTab = "playlists" | "albums" | "podcasts" | "books" | "queue" | "search";

const TABS: { id: LibraryTab; label: string }[] = [
	{ id: "playlists", label: "Playlists" },
	{ id: "albums", label: "Albums" },
	{ id: "podcasts", label: "Podcasts" },
	{ id: "books", label: "Books" },
	{ id: "queue", label: "Queue" },
	{ id: "search", label: "Search" },
];

/** What is open under Playlists or Albums: Liked Songs, a playlist or an album, shown as its list of songs. */
type Collection =
	| { kind: "liked" }
	| { kind: "playlist"; id: string; uri: string; name: string; imageUrl: string; subtitle: string }
	| { kind: "album"; id: string; uri: string; name: string; imageUrl: string; subtitle: string };

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const rowSx = {
    minHeight: "var(--car-target)",
	display: "flex",
	alignItems: "center",
	gap: 2,
	px: 1,
	py: 0.75,
	borderRadius: 2,
	cursor: "pointer",
	"&:hover": { backgroundColor: "rgba(255,255,255,0.07)" },
	"&:active": { backgroundColor: "rgba(255,255,255,0.13)" },
} as const;

const ArtBox = ({
	src,
	alt,
	size = 88,
}: {
	src: string;
	alt: string;
	size?: number;
}) =>
	src ? (
		<Box
			component="img"
			src={src}
			alt={alt}
			loading="lazy"
			decoding="async"
			sx={{
				width: size,
				height: size,
				borderRadius: 1,
				flexShrink: 0,
				objectFit: "cover",
			}}
		/>
	) : (
		<Box
			sx={{
				width: size,
				height: size,
				borderRadius: 1,
				backgroundColor: "rgba(255,255,255,0.08)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				flexShrink: 0,
			}}
		>
			<MusicNoteRounded
				sx={{ fontSize: size * 0.5, color: "text.secondary" }}
			/>
		</Box>
	);

/** A button at the end of a song row. It shows a tick for a moment once it has worked. */
interface RowAction { label: string; icon: React.ReactNode; run: () => Promise<void> }
const RowActionButton = ({ action, name }: { action: RowAction; name: string }) => {
	const [state, setState] = useState<"idle" | "busy" | "done">("idle");
	const go = async () => {
		if (state === "busy") return;
		setState("busy");
		try { await action.run(); setState("done"); setTimeout(() => setState("idle"), 1500); } catch { setState("idle"); }
	};
	return <DriveButton color={state === "done" ? "primary" : "inherit"} variant="outlined" disabled={state === "busy"} aria-label={`${action.label}: ${name}`} onClick={() => void go()} sx={{ flexShrink: 0, minWidth: 0, width: 68, minHeight: 72, borderRadius: 3, "& .MuiSvgIcon-root": { fontSize: 34 } }}>{state === "done" ? <CheckRounded /> : action.icon}</DriveButton>;
};

/** A song: tap to play it; the buttons at the end act on it (add to queue, play next, and so on). */
interface TrackRowProps {
	item: SpotifyQueueItem;
	onPlay: () => void;
	actions?: RowAction[];
	playing?: boolean;
}

// Playback progress updates every second. Keep the latest actions without rebuilding every song row.
const TrackRow = ({ item, onPlay, actions = [], playing = false }: TrackRowProps) => {
	const latest = useRef({ onPlay, actions });
	latest.current = { onPlay, actions };
	return <MemoTrackRow item={item} playing={playing} labels={actions.map(action => action.label).join("\0")} latest={latest} />;
};
const MemoTrackRow = React.memo(({ item, playing, latest }: { item: SpotifyQueueItem; playing: boolean; labels: string; latest: React.MutableRefObject<{ onPlay: () => void; actions: RowAction[] }> }) => (
	<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, contentVisibility: "auto", containIntrinsicSize: "auto 104px" }}>
		<Box sx={{ flex: 1, minWidth: 0 }}><TrackButton item={item} onPlay={() => latest.current.onPlay()} playing={playing} /></Box>
		{latest.current.actions.map((action, index) => <RowActionButton key={action.label} action={{ ...action, run: () => latest.current.actions[index].run() }} name={item.name} />)}
	</Box>
), (previous, next) => previous.item === next.item && previous.playing === next.playing && previous.labels === next.labels);

const TrackButton = ({
	item,
	onPlay,
	playing = false,
}: {
	item: SpotifyQueueItem;
	onPlay: () => void;
	playing?: boolean;
}) => (
	<Box component="button" type="button" sx={{ ...rowSx, width: "100%", border: 0, bgcolor: "transparent", textAlign: "left", font: "inherit" }} onClick={onPlay}>
		<ArtBox src={item.albumArt} alt={item.name} />
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography
				sx={{
					color: playing ? SPOTIFY_GREEN : "text.primary",
					fontSize: 24,
					fontWeight: playing ? 700 : 500,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{playing && <GraphicEqRounded aria-label="Playing now" sx={{ fontSize: 26, mr: 0.75, verticalAlign: "text-bottom" }} />}{item.name}
			</Typography>
			<Typography
				sx={{
					color: "text.secondary",
					fontSize: 24,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{item.artists}
			</Typography>
		</Box>
		<Typography
			sx={{ color: "text.secondary", fontSize: 24, flexShrink: 0 }}
		>
			{formatMs(item.durationMs)}
		</Typography>
	</Box>
);

/** A playlist, album or Liked Songs as a card; tapping it opens its songs. */
const CollectionCard = ({ name, imageUrl, subtitle, onOpen, icon }: { name: string; imageUrl: string; subtitle: string; onOpen: () => void; icon?: React.ReactNode }) => (
 <Box component="button" type="button" onClick={onOpen} sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", minWidth: 0, minHeight: "var(--car-target)", p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 3, bgcolor: "background.default", color: "text.primary", textAlign: "left", cursor: "pointer", contentVisibility: "auto", containIntrinsicSize: "auto 150px", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}>
  {icon ?? <ArtBox src={imageUrl} alt="" size={120} />}
  <Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 24, fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{name}</Typography><Typography noWrap sx={{ color: "text.secondary", fontSize: 20 }}>{subtitle}</Typography></Box>
 </Box>
);

const ShowRow = ({ show, onOpen }: { show: SpotifyShow; onOpen: () => void }) => (
 <Box component="button" type="button" onClick={onOpen} sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", minWidth: 0, minHeight: "var(--car-target)", p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 3, bgcolor: "background.default", color: "text.primary", textAlign: "left", cursor: "pointer", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}>
  <ArtBox src={show.imageUrl} alt="" size={120} />
  <Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 24, fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{show.name}</Typography><Typography noWrap sx={{ color: "text.secondary", fontSize: 20 }}>{show.publisher}</Typography></Box>
 </Box>
);

/** An episode or chapter, with how much is left and a thin bar showing how far you got. */
const EpisodeRow = ({ episode, onPlay }: { episode: SpotifyEpisode; onPlay: () => void }) => (
	<Box component="button" type="button" sx={{ ...rowSx, width: "100%", border: 0, bgcolor: "transparent", textAlign: "left", font: "inherit", opacity: episode.fullyPlayed ? 0.6 : 1 }} onClick={onPlay}>
		<ArtBox src={episode.imageUrl} alt="" />
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography sx={{ color: "text.primary", fontSize: 24, fontWeight: 500, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{episode.name}</Typography>
			<Typography noWrap sx={{ color: episode.resumeMs > 0 ? SPOTIFY_GREEN : "text.secondary", fontSize: 22, fontWeight: episode.resumeMs > 0 ? 700 : 400 }}>{episode.showName && episode.resumeMs > 0 ? `${episode.showName} · ` : ""}{describeProgress(episode)}</Typography>
			{episode.resumeMs > 0 && episode.durationMs > 0 && <Box aria-hidden sx={{ mt: 0.5, height: 4, borderRadius: 2, bgcolor: "rgba(255,255,255,0.15)" }}><Box sx={{ height: "100%", width: `${Math.min(100, (episode.resumeMs / episode.durationMs) * 100)}%`, borderRadius: 2, bgcolor: SPOTIFY_GREEN }} /></Box>}
		</Box>
	</Box>
);

/** Calls onVisible when it scrolls into view: how a long list loads another page just before you reach the end. */
const LoadMore = ({ onVisible, loading }: { onVisible: () => void; loading: boolean }) => {
	const ref = useRef<HTMLDivElement>(null);
	const latest = useRef(onVisible);
	latest.current = onVisible;
	useEffect(() => {
		const node = ref.current;
		if (!node || loading || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => { if (entries.some(entry => entry.isIntersecting)) latest.current(); }, { rootMargin: "400px" });
		observer.observe(node);
		return () => observer.disconnect();
	}, [loading]);
	return <Box ref={ref} sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center", py: 2, minHeight: 40 }}>{loading && <CircularProgress size={24} sx={{ color: SPOTIFY_GREEN }} />}</Box>;
};

const EmptyState = ({ text }: { text: string }) => (
	<Typography
		sx={{
			color: "text.secondary",
			fontSize: 24,
			textAlign: "center",
			pt: 4,
			px: 2,
		}}
	>
		{text}
	</Typography>
);

interface SpotifyLibraryProps {
	spotify: UseSpotifyReturn;
	onBack: () => void;
	isDriving: boolean;
}

const SpotifyLibrary = ({
	spotify,
	onBack,
	isDriving,
}: SpotifyLibraryProps) => {
	const {
		queue,
		playlists,
		searchResults,
		isLibraryLoading,
		fetchQueue,
		fetchPlaylists,
		search,
		playTrack,
		playContext,
		playLiked,
		addToQueue,
		albums,
		fetchAlbums,
		queueNow,
		removeFromQueue,
		moveToNext,
		playNext,
		fetchMorePlaylists,
		playlistsLoading,
		hasMorePlaylists,
		fetchCollectionTracks,
		shows,
		audiobooks,
		fetchShows,
		fetchAudiobooks,
		fetchEpisodes,
		fetchContinueListening,
		playEpisodes,
	} = spotify;

	const playingId = spotify.track?.id ?? null;
	// Every song can be added to the end of the queue or put next.
	const queueActions = (item: SpotifyQueueItem): RowAction[] => [
		{ label: "Add to queue", icon: <PlaylistAddRounded />, run: () => addToQueue(item.uri) },
		{ label: "Play next", icon: <QueuePlayNextRounded />, run: () => playNext(item) },
	];
	// One prompt covers every missing permission, instead of a message in each tab.
	const permissionProblem = spotify.needsReconnect || /permission|reconnect/i.test(spotify.error ?? "");

	const { showKeyboard, hideKeyboard } = useKeyboard();
	const [tab, setTab] = useState<LibraryTab>("playlists");
	// A playlist, album or Liked Songs opened to see its songs.
	const [collection, setCollection] = useState<Collection | null>(null);
	const [collectionTracks, setCollectionTracks] = useState<SpotifyQueueItem[]>([]);
	const [collectionLoading, setCollectionLoading] = useState(false);
	const [nextOffset, setNextOffset] = useState<number | null>(null);
	const collectionGeneration = useRef(0);
	const loadingPage = useRef(false);
	useEffect(() => { setCollection(null); }, [tab]);
	useEffect(() => {
		const generation = ++collectionGeneration.current;
		setCollectionTracks([]); setNextOffset(null); loadingPage.current = false;
		if (!collection) { setCollectionLoading(false); return; }
		loadingPage.current = true; setCollectionLoading(true);
		const id = collection.kind === "liked" ? "" : collection.id;
		const art = collection.kind === "liked" ? "" : collection.imageUrl;
		void fetchCollectionTracks(collection.kind, id, art, 0).then(page => {
			if (generation === collectionGeneration.current) { setCollectionTracks(page.items); setNextOffset(page.nextOffset); }
		}).catch((): void => undefined).finally(() => { if (generation === collectionGeneration.current) { loadingPage.current = false; setCollectionLoading(false); } });
		return () => { collectionGeneration.current++; };
	}, [collection, fetchCollectionTracks]);
	async function loadMoreSongs() {
		if (!collection || nextOffset === null || loadingPage.current) return;
		const generation = collectionGeneration.current;
		loadingPage.current = true; setCollectionLoading(true);
		try {
			const page = await fetchCollectionTracks(collection.kind, collection.kind === "liked" ? "" : collection.id, collection.kind === "liked" ? "" : collection.imageUrl, nextOffset);
			if (generation === collectionGeneration.current) { setCollectionTracks(previous => [...previous, ...page.items]); setNextOffset(page.nextOffset); }
		} catch { /* Spotify reports the error in the library banner. */ }
		finally { if (generation === collectionGeneration.current) { loadingPage.current = false; setCollectionLoading(false); } }
	}
	const [actionError, setActionError] = useState<string | null>(null);
	async function playItem(action: () => Promise<void>, thenGoBack = false) {
		setActionError(null);
		try {
			await action();
			if (thenGoBack) { hideKeyboard(); onBack(); }
		} catch (error) { setActionError(error instanceof Error ? error.message : "Playback unavailable. Try again."); }
	}
	// Podcasts and books: a list of shows, and one opened to see its episodes or chapters.
	const [openShow, setOpenShow] = useState<SpotifyShow | null>(null);
	const [episodes, setEpisodes] = useState<SpotifyEpisode[]>([]);
	const [continueList, setContinueList] = useState<SpotifyEpisode[]>([]);
	const [episodesLoading, setEpisodesLoading] = useState(false);
	useEffect(() => { setOpenShow(null); }, [tab]);
	useEffect(() => {
		if (!openShow) return;
		let cancelled = false;
		setEpisodes([]);
		setEpisodesLoading(true);
		fetchEpisodes(openShow).then(list => { if (!cancelled) setEpisodes(list); }).finally(() => { if (!cancelled) setEpisodesLoading(false); });
		return () => { cancelled = true; };
	}, [openShow, fetchEpisodes]);
	useEffect(() => {
		if (tab !== "podcasts") return;
		let cancelled = false;
		fetchContinueListening().then(list => { if (!cancelled) setContinueList(list); }).catch((): void => undefined);
		return () => { cancelled = true; };
	}, [tab]); // eslint-disable-line
	const [searchQuery, setSearchQuery] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (tab === "queue") fetchQueue();
		else if (tab === "albums") fetchAlbums();
		else if (tab === "playlists") fetchPlaylists();
		else if (tab === "podcasts") fetchShows();
		else if (tab === "books") fetchAudiobooks();
		else if (tab !== "search") hideKeyboard();
	}, [tab, fetchQueue, fetchAlbums, fetchPlaylists, fetchShows, fetchAudiobooks, hideKeyboard, isDriving]);

	useEffect(() => {
		if (tab !== "search") return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (!searchQuery.trim()) {
			search("");
			return;
		}
		debounceRef.current = setTimeout(() => search(searchQuery), 400);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [searchQuery, search, tab]);

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
			{(actionError || (spotify.error && !permissionProblem)) && <Box sx={{ mb: 1 }}><QuietNotice onClose={actionError ? () => setActionError(null) : undefined}>{actionError || spotify.error}</QuietNotice></Box>}
			{permissionProblem && <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: "action.hover", border: "1px solid", borderColor: "warning.main" }}>
				<WarningAmberRounded aria-hidden sx={{ color: "warning.main", fontSize: 30, flexShrink: 0 }} />
				<Typography sx={{ flex: 1, minWidth: 0, fontSize: 22 }}>{isDriving ? "Spotify needs permission for some features. Reconnect when parked." : "Spotify needs permission for some features."}</Typography>
				<DriveButton variant="contained" disabled={isDriving} onClick={() => void spotify.connect()} sx={{ flexShrink: 0, minHeight: 64, px: 3 }}>Reconnect Spotify</DriveButton>
			</Box>}
			{/* ── Header ── */}
			<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1.5 }}>
				<DriveButton aria-label="Back to now playing"
					onClick={onBack}
					size="small"
					sx={{
						color: "text.secondary",
						p: 0.5,
						flexShrink: 0,
						"&:hover": { color: "text.primary" },
					}}
				>
					<ArrowBackRounded sx={{ fontSize: 32 }} />
				</DriveButton>

				<Box sx={{ display: "flex", flex: 1, gap: 0.5 }}>
					{TABS.map((t) => (
						<DriveButton
                            aria-pressed={tab === t.id}
							key={t.id}
							onClick={() => setTab(t.id)}
							sx={{
								flex: 1,
								textAlign: "center",
								py: 0.6,
								borderRadius: 2,
								cursor: "pointer",
								backgroundColor:
									tab === t.id ? "rgba(255,255,255,0.1)" : "transparent",
								transition: "background-color 0.15s",
								"&:hover": { backgroundColor: "rgba(255,255,255,0.07)" },
							}}
						>
							<Typography
								sx={{
									fontSize: 22,
									fontWeight: tab === t.id ? 700 : 400,
									color: tab === t.id ? "text.primary" : "text.secondary",
								}}
							>
								{t.label}
							</Typography>
						</DriveButton>
					))}
				</Box>
			</Box>

			{/* ── Search input ── */}
			{tab === "search" && (
				<Box
					sx={{
						display: "flex",
						alignItems: "center",
						gap: 1,
						backgroundColor: "rgba(255,255,255,0.08)",
						borderRadius: 2,
						px: 1.5,
						py: 0.75,
						mb: 1,
					}}
				>
					<SearchRounded
						sx={{
							fontSize: 28,
							color: "text.secondary",
							flexShrink: 0,
						}}
					/>
					<InputBase
						autoFocus
						placeholder="Artists, songs..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						inputProps={{ inputMode: "none" }}
						onFocus={() => showKeyboard()}
						onClick={() => showKeyboard()}
						sx={{
							flex: 1,
							color: "text.primary",
							fontSize: 24,
							"& .MuiInputBase-input::placeholder": {
								color: "text.secondary",
								opacity: 1,
							},
						}}
					/>
				</Box>
			)}

			{/* ── Scrollable list ── */}
			<Box
				sx={{
					flex: 1,
					overflowY: "auto",
					overflowX: "hidden",
					"&::-webkit-scrollbar": { width: 3 },
					"&::-webkit-scrollbar-track": { background: "transparent" },
					"&::-webkit-scrollbar-thumb": {
						background: "rgba(255,255,255,0.15)",
						borderRadius: 2,
					},
				}}
			>
				{collection && (tab === "playlists" || tab === "albums") ? (() => {
					const songs = collectionTracks;
					const loading = collectionLoading && songs.length === 0;
					const playFrom = (i: number) => collection.kind === "liked" ? playLiked(songs, i) : playContext(collection.uri, songs[i]?.uri);
					return <Box>
						<Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
							<DriveButton color="inherit" aria-label="Back to the list" onClick={() => setCollection(null)} sx={{ flexShrink: 0, minWidth: 0, width: 64, minHeight: 64 }}><ArrowBackRounded /></DriveButton>
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography noWrap sx={{ fontSize: 26, fontWeight: 800 }}>{collection.kind === "liked" ? "Liked Songs" : collection.name}</Typography>
								<Typography noWrap sx={{ fontSize: 20, color: "text.secondary" }}>{collection.kind === "liked" ? `${songs.length}${nextOffset !== null ? "+" : ""} songs loaded` : collection.subtitle}</Typography>
							</Box>
							<DriveButton variant="contained" disabled={songs.length === 0} onClick={() => void playItem(() => (collection.kind === "liked" ? playLiked(songs, 0) : playContext(collection.uri)), true)} startIcon={<PlayArrowRounded />} sx={{ flexShrink: 0, minHeight: 64, px: 3, fontSize: 24, fontWeight: 700 }}>Play</DriveButton>
						</Box>
						{loading ? <Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}><CircularProgress size={24} sx={{ color: SPOTIFY_GREEN }} /></Box>
							: songs.length === 0 && nextOffset === null ? <EmptyState text={collection.kind === "liked" ? "No liked songs yet." : "No songs to show here."} />
							: <>{songs.map((item, i) => <TrackRow key={`${item.id}-${i}`} item={item} onPlay={() => void playItem(() => playFrom(i), true)} actions={queueActions(item)} playing={item.id === playingId} />)}
							{nextOffset !== null && <LoadMore onVisible={() => void loadMoreSongs()} loading={collectionLoading} />}</>}
					</Box>;
				})() : isLibraryLoading ? (
					<Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}>
						<CircularProgress size={24} sx={{ color: SPOTIFY_GREEN }} />
					</Box>
				) : tab === "queue" ? (
					<Box>
						<Typography sx={{ fontSize: 22, fontWeight: 700, color: "text.secondary", px: 1, mb: 0.5 }}>Now playing</Typography>
						{(queueNow ?? null) || spotify.track ? <TrackRow item={queueNow ?? { id: spotify.track!.id, name: spotify.track!.name, artists: spotify.track!.artists, albumArt: spotify.track!.albumArt, durationMs: spotify.track!.durationMs, uri: "" }} onPlay={() => undefined} playing /> : <EmptyState text="Nothing is playing" />}
						<Typography sx={{ fontSize: 22, fontWeight: 700, color: "text.secondary", px: 1, mt: 1.5, mb: 0.5 }}>Next up</Typography>
						{queue.length === 0 ? <EmptyState text="Nothing queued next" /> : queue.map((item, i) => (
							<TrackRow
								key={`${item.id}-${i}`}
								item={item}
								onPlay={() => void playItem(() => playTrack(item.uri))}
								actions={[
									...(i > 0 ? [{ label: "Play next", icon: <VerticalAlignTopRounded />, run: () => moveToNext(i) }] : []),
									{ label: "Remove from queue", icon: <CloseRounded />, run: () => removeFromQueue(i) },
								]}
							/>
						))}
					</Box>
				) : tab === "albums" ? (
					albums.length === 0 ? (
						<EmptyState text="No saved albums yet. Save albums in Spotify and they will show up here." />
					) : (
						<Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>{albums.map((album) => (
							<CollectionCard
								key={album.id}
								name={album.name}
								imageUrl={album.imageUrl}
								subtitle={album.artists}
								onOpen={() => setCollection({ kind: "album", id: album.id, uri: album.uri, name: album.name, imageUrl: album.imageUrl, subtitle: album.artists })}
							/>
						))}</Box>
					)
				) : tab === "playlists" ? (
					<Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>
						<CollectionCard
							name="Liked Songs"
							imageUrl=""
							subtitle="Your liked songs"
							icon={<Box sx={{ width: 120, height: 120, borderRadius: 1, flexShrink: 0, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #4510d8, #a8b6ff)" }}><FavoriteRounded sx={{ fontSize: 60, color: "#fff" }} /></Box>}
							onOpen={() => setCollection({ kind: "liked" })}
						/>
						{playlists.map((pl) => (
							<CollectionCard
								key={pl.id}
								name={pl.name}
								imageUrl={pl.imageUrl}
								subtitle={`${pl.tracksTotal} songs`}
								onOpen={() => setCollection({ kind: "playlist", id: pl.id, uri: pl.uri, name: pl.name, imageUrl: pl.imageUrl, subtitle: `${pl.tracksTotal} songs` })}
							/>
						))}
						{(hasMorePlaylists || playlistsLoading) && <LoadMore onVisible={() => void fetchMorePlaylists()} loading={playlistsLoading} />}
					</Box>
				) : tab === "podcasts" || tab === "books" ? (
					openShow ? (
						<Box>
							<DriveButton color="inherit" onClick={() => setOpenShow(null)} startIcon={<ArrowBackRounded />} sx={{ mb: 1, minHeight: 56, justifyContent: "flex-start", maxWidth: "100%" }}><Typography noWrap sx={{ fontSize: 22, fontWeight: 700 }}>{openShow.name}</Typography></DriveButton>
							{episodesLoading ? <Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}><CircularProgress size={24} sx={{ color: SPOTIFY_GREEN }} /></Box>
								: episodes.length === 0 ? <EmptyState text="Nothing to play here" />
								: episodes.map((episode, i) => <EpisodeRow key={episode.id} episode={episode} onPlay={() => void playItem(() => (openShow.kind === "audiobook" ? playEpisodes(episodes, i) : playEpisodes([episode], 0)), true)} />)}
						</Box>
					) : (() => {
						const list = tab === "podcasts" ? shows : audiobooks;
						return <>
							{tab === "podcasts" && continueList.length > 0 && <Box sx={{ mb: 1.5 }}>
								<Typography sx={{ fontSize: 22, fontWeight: 700, color: "text.secondary", px: 1 }}>Continue listening</Typography>
								{continueList.map(episode => <EpisodeRow key={episode.id} episode={episode} onPlay={() => void playItem(() => playEpisodes([episode], 0), true)} />)}
							</Box>}
							{list.length === 0 ? <Box sx={{ display: "grid", justifyItems: "center", gap: 2, pt: 1 }}>
									<EmptyState text={tab === "podcasts" ? "Follow podcasts in Spotify and they will show up here." : "Save audiobooks in Spotify and they will show up here."} />
								</Box>
								: <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>{list.map(show => <ShowRow key={show.id} show={show} onOpen={() => setOpenShow(show)} />)}</Box>}
						</>;
					})()
				) : !searchQuery.trim() ? (
					<EmptyState text="Type to search" />
				) : searchResults.length === 0 ? (
					<EmptyState text="No results found" />
				) : (
					searchResults.map((item, i) => (
						<TrackRow
							key={`${item.id}-${i}`}
							item={item}
							onPlay={() => void playItem(() => playTrack(item.uri), true)}
							actions={queueActions(item)}
							playing={item.id === playingId}
						/>
					))
				)}
			</Box>
		</Box>
	);
};

export default SpotifyLibrary;
