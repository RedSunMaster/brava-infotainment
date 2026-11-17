import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import MusicNoteRounded from "@mui/icons-material/MusicNoteRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
	Alert,
	Box,
	CircularProgress,
	InputBase,
	Typography,
} from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import {
	SpotifyPlaylist,
	SpotifyQueueItem,
	UseSpotifyReturn,
} from "../hooks/useSpotify";
import QuietNotice from "./QuietNotice";
import DriveButton from "./DriveButton";
import { useKeyboard } from "../contexts/KeyboardContext";

const SPOTIFY_GREEN = "#1DB954";

type LibraryTab = "queue" | "playlists" | "search";

const TABS: { id: LibraryTab; label: string }[] = [
	{ id: "queue", label: "Queue" },
	{ id: "playlists", label: "Playlists" },
	{ id: "search", label: "Search" },
];

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

const TrackRow = ({
	item,
	onPlay,
}: {
	item: SpotifyQueueItem;
	onPlay: () => void;
}) => (
	<Box component="button" type="button" sx={{ ...rowSx, width: "100%", border: 0, bgcolor: "transparent", textAlign: "left", font: "inherit" }} onClick={onPlay}>
		<ArtBox src={item.albumArt} alt={item.name} />
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography
				sx={{
					color: "text.primary",
					fontSize: 24,
					fontWeight: 500,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{item.name}
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

const PlaylistRow = ({ playlist, onPlay }: { playlist: SpotifyPlaylist; onPlay: () => void }) => (
 <Box component="button" type="button" onClick={onPlay} sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", minWidth: 0, minHeight: "var(--car-target)", p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 3, bgcolor: "background.default", color: "text.primary", textAlign: "left", cursor: "pointer", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main" } }}>
  <ArtBox src={playlist.imageUrl} alt="" size={120} />
  <Box sx={{ minWidth: 0 }}><Typography sx={{ fontSize: 24, fontWeight: 700, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{playlist.name}</Typography><Typography sx={{ color: "text.secondary", fontSize: 20 }}>{playlist.tracksTotal} tracks</Typography></Box>
 </Box>
);

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
	} = spotify;

	const { showKeyboard, hideKeyboard } = useKeyboard();
	const [tab, setTab] = useState<LibraryTab>("queue");
	const [actionError, setActionError] = useState<string | null>(null);
	async function playItem(action: () => Promise<void>) {
		setActionError(null);
		try { await action(); } catch (error) { setActionError(error instanceof Error ? error.message : "Playback unavailable. Try again."); }
	}
	const [searchQuery, setSearchQuery] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (isDriving && tab === "search") {
			setTab("queue");
			hideKeyboard();
			return;
		}
		if (tab === "queue") fetchQueue();
		else if (tab === "playlists") fetchPlaylists();
		else if (tab !== "search") hideKeyboard();
	}, [tab, fetchQueue, fetchPlaylists, hideKeyboard, isDriving]);

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
			{(actionError || spotify.error) && <Box sx={{ mb: 1 }}><QuietNotice onClose={actionError ? () => setActionError(null) : undefined}>{actionError || spotify.error}</QuietNotice></Box>}
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
                            disabled={isDriving && t.id === "search"}
							key={t.id}
							onClick={() => {
								if (!(isDriving && t.id === "search")) setTab(t.id);
							}}
							sx={{
								flex: 1,
								textAlign: "center",
								py: 0.6,
								borderRadius: 2,
								cursor:
									isDriving && t.id === "search" ? "not-allowed" : "pointer",
								opacity: isDriving && t.id === "search" ? 0.35 : 1,
								backgroundColor:
									tab === t.id ? "rgba(255,255,255,0.1)" : "transparent",
								transition: "background-color 0.15s",
								"&:hover": { backgroundColor: "rgba(255,255,255,0.07)" },
							}}
						>
							<Typography
								sx={{
									fontSize: 24,
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
				{isLibraryLoading ? (
					<Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}>
						<CircularProgress size={24} sx={{ color: SPOTIFY_GREEN }} />
					</Box>
				) : tab === "queue" ? (
					queue.length === 0 ? (
						<EmptyState text="Queue is empty" />
					) : (
						queue.map((item, i) => (
							<TrackRow
								key={`${item.id}-${i}`}
								item={item}
								onPlay={() => void playItem(() => playTrack(item.uri))}
							/>
						))
					)
				) : tab === "playlists" ? (
					playlists.length === 0 ? (
						<EmptyState text="No playlists found" />
					) : (
						<Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>{playlists.map((pl) => (
							<PlaylistRow
								key={pl.id}
								playlist={pl}
								onPlay={() => void playItem(() => playContext(pl.uri))}
							/>
						))}</Box>
					)
				) : !searchQuery.trim() ? (
					<EmptyState text="Type to search" />
				) : searchResults.length === 0 ? (
					<EmptyState text="No results found" />
				) : (
					searchResults.map((item, i) => (
						<TrackRow
							key={`${item.id}-${i}`}
							item={item}
							onPlay={() => void playTrack(item.uri).catch((): void => {})}
						/>
					))
				)}
			</Box>
		</Box>
	);
};

export default SpotifyLibrary;
