import {
	ArrowBackRounded,
	MusicNoteRounded,
	SearchRounded,
} from "@mui/icons-material";
import {
	Box,
	CircularProgress,
	IconButton,
	InputBase,
	Typography,
} from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import {
	SpotifyPlaylist,
	SpotifyQueueItem,
	UseSpotifyReturn,
} from "../hooks/useSpotify";
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
	display: "flex",
	alignItems: "center",
	gap: 1.5,
	px: 0.5,
	py: 0.75,
	borderRadius: 2,
	cursor: "pointer",
	"&:hover": { backgroundColor: "rgba(255,255,255,0.07)" },
	"&:active": { backgroundColor: "rgba(255,255,255,0.13)" },
} as const;

const ArtBox = ({
	src,
	alt,
	size = 40,
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
				sx={{ fontSize: size * 0.5, color: "rgba(255,255,255,0.3)" }}
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
	<Box sx={rowSx} onClick={onPlay}>
		<ArtBox src={item.albumArt} alt={item.name} />
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography
				sx={{
					color: "white",
					fontSize: 13,
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
					color: "rgba(255,255,255,0.5)",
					fontSize: 11,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{item.artists}
			</Typography>
		</Box>
		<Typography
			sx={{ color: "rgba(255,255,255,0.3)", fontSize: 11, flexShrink: 0 }}
		>
			{formatMs(item.durationMs)}
		</Typography>
	</Box>
);

const PlaylistRow = ({
	playlist,
	onPlay,
}: {
	playlist: SpotifyPlaylist;
	onPlay: () => void;
}) => (
	<Box sx={rowSx} onClick={onPlay}>
		<ArtBox src={playlist.imageUrl} alt={playlist.name} />
		<Box sx={{ flex: 1, minWidth: 0 }}>
			<Typography
				sx={{
					color: "white",
					fontSize: 13,
					fontWeight: 500,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{playlist.name}
			</Typography>
			<Typography sx={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
				{playlist.tracksTotal} tracks
			</Typography>
		</Box>
	</Box>
);

const EmptyState = ({ text }: { text: string }) => (
	<Typography
		sx={{
			color: "rgba(255,255,255,0.35)",
			fontSize: 12,
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
}

const SpotifyLibrary = ({ spotify, onBack }: SpotifyLibraryProps) => {
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
	const [searchQuery, setSearchQuery] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (tab === "queue") fetchQueue();
		else if (tab === "playlists") fetchPlaylists();
		else if (tab !== "search") hideKeyboard();
	}, [tab, fetchQueue, fetchPlaylists, hideKeyboard]);

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
			{/* ── Header ── */}
			<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1.5 }}>
				<IconButton
					onClick={onBack}
					size="small"
					sx={{
						color: "rgba(255,255,255,0.6)",
						p: 0.5,
						flexShrink: 0,
						"&:hover": { color: "white" },
					}}
				>
					<ArrowBackRounded sx={{ fontSize: 18 }} />
				</IconButton>

				<Box sx={{ display: "flex", flex: 1, gap: 0.5 }}>
					{TABS.map((t) => (
						<Box
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
									fontSize: 11,
									fontWeight: tab === t.id ? 700 : 400,
									color: tab === t.id ? "white" : "rgba(255,255,255,0.45)",
								}}
							>
								{t.label}
							</Typography>
						</Box>
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
							fontSize: 16,
							color: "rgba(255,255,255,0.45)",
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
						sx={{
							flex: 1,
							color: "white",
							fontSize: 13,
							"& .MuiInputBase-input::placeholder": {
								color: "rgba(255,255,255,0.3)",
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
								onPlay={() => playTrack(item.uri)}
							/>
						))
					)
				) : tab === "playlists" ? (
					playlists.length === 0 ? (
						<EmptyState text="No playlists found" />
					) : (
						playlists.map((pl) => (
							<PlaylistRow
								key={pl.id}
								playlist={pl}
								onPlay={() => playContext(pl.uri)}
							/>
						))
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
							onPlay={() => playTrack(item.uri)}
						/>
					))
				)}
			</Box>
		</Box>
	);
};

export default SpotifyLibrary;
