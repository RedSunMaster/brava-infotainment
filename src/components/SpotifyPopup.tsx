import {
	LibraryMusicRounded,
	MusicNoteRounded,
	PauseRounded,
	PlayArrowRounded,
	QueueMusicRounded,
	RepeatOneRounded,
	RepeatRounded,
	ShuffleRounded,
	SkipNextRounded,
	SkipPreviousRounded,
} from "@mui/icons-material";
import {
	Box,
	CircularProgress,
	IconButton,
	Popover,
	Slider,
	Typography,
} from "@mui/material";
import React, { useState } from "react";
import { UseSpotifyReturn } from "../hooks/useSpotify";
import SpotifyLibrary from "./SpotifyLibrary";

interface SpotifyPopupProps {
	anchorEl: HTMLElement | null;
	onClose: () => void;
	spotify: UseSpotifyReturn;
	isDriving: boolean;
}

function formatMs(ms: number): string {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const SPOTIFY_GREEN = "#1DB954";

const ctrlBtn = {
	color: "white",
	p: 0.75,
	"&:hover": { color: "rgba(255,255,255,0.7)" },
} as const;

const SpotifyPopup = ({
	anchorEl,
	onClose,
	spotify,
	isDriving,
}: SpotifyPopupProps) => {
	const {
		track,
		isConnected,
		isLoading,
		connect,
		play,
		pause,
		next,
		previous,
		toggleShuffle,
		cycleRepeat,
	} = spotify;

	const [libraryOpen, setLibraryOpen] = useState(false);

	const handleClose = () => {
		setLibraryOpen(false);
		onClose();
	};

	return (
		<Popover
			open={Boolean(anchorEl)}
			anchorEl={anchorEl}
			onClose={handleClose}
			anchorOrigin={{ vertical: "top", horizontal: "center" }}
			transformOrigin={{ vertical: "bottom", horizontal: "center" }}
			disablePortal
			marginThreshold={0}
			sx={{ pointerEvents: "none" }} // ← FIX: Modal root won't intercept clicks
			slotProps={{
				paper: {
					sx: {
						pointerEvents: "auto", // ← FIX: popup content stays interactive
						backgroundColor: "#12161A",
						border: "1px solid rgba(255,255,255,0.24)",
						borderRadius: 3,
						overflow: "hidden",
						position: "relative",
						display: "flex",
						flexDirection: "column",
						width: libraryOpen ? "90vw" : 300,
						height: libraryOpen ? 560 : "auto",
						transition:
							"width 0.28s cubic-bezier(0.4,0,0.2,1), height 0.28s cubic-bezier(0.4,0,0.2,1)",
					},
				},
			}}
		>
			{/* ── Now-playing panel ────────────────────────────────────────────── */}
			<Box sx={{ p: 2.5 }}>
				{/* ── Not connected ── */}
				{!isConnected ? (
					<Box
						sx={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 2,
							py: 1,
						}}
					>
						<LibraryMusicRounded sx={{ fontSize: 48, color: SPOTIFY_GREEN }} />
						<Typography sx={{ color: "white", fontWeight: 600 }}>
							Connect to Spotify
						</Typography>
						<Box
							sx={{
								backgroundColor: SPOTIFY_GREEN,
								borderRadius: 10,
								px: 3,
								py: 1,
								cursor: "pointer",
								"&:hover": { backgroundColor: "#1ed760" },
							}}
							onClick={connect}
						>
							<Typography
								sx={{ color: "black", fontWeight: 700, fontSize: 14 }}
							>
								{isLoading ? "Connecting…" : "Connect"}
							</Typography>
						</Box>
					</Box>
				) : !track ? (
					/* ── Connected, no active device ── */
					<Box
						sx={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							gap: 1.5,
							py: 1,
						}}
					>
						{isLoading ? (
							<CircularProgress size={32} sx={{ color: SPOTIFY_GREEN }} />
						) : (
							<>
								<Typography
									sx={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}
								>
									No active playback
								</Typography>
								<Typography
									sx={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}
								>
									Open Spotify on a device to start
								</Typography>
								{!isDriving && (
								<Box
									sx={{
										display: "flex",
										alignItems: "center",
										gap: 0.75,
										mt: 0.5,
										cursor: "pointer",
										color: SPOTIFY_GREEN,
										"&:hover": { color: "#1ed760" },
									}}
									onClick={() => setLibraryOpen(true)}
								>
									<QueueMusicRounded sx={{ fontSize: 18 }} />
									<Typography
										sx={{ fontSize: 12, fontWeight: 600, color: "inherit" }}
									>
										Browse Library
									</Typography>
								</Box>
								)}
							</>
						)}
					</Box>
				) : (
					/* ── Now playing ── */
					<Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
						{/* Album art + track info + library button */}
						<Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
							{track.albumArt ? (
								<Box
									component="img"
									src={track.albumArt}
									alt={track.albumName}
									sx={{
										width: 72,
										height: 72,
										borderRadius: 2,
										flexShrink: 0,
										objectFit: "cover",
										boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
									}}
								/>
							) : (
								<Box
									sx={{
										width: 72,
										height: 72,
										borderRadius: 2,
										backgroundColor: "rgba(255,255,255,0.08)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										flexShrink: 0,
									}}
								>
									<MusicNoteRounded
										sx={{ color: "rgba(255,255,255,0.3)", fontSize: 32 }}
									/>
								</Box>
							)}

							<Box sx={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
								<Typography
									sx={{
										color: "white",
										fontWeight: 700,
										fontSize: 14,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{track.name}
								</Typography>
								<Typography
									sx={{
										color: "rgba(255,255,255,0.6)",
										fontSize: 12,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{track.artists}
								</Typography>
								<Typography
									sx={{
										color: "rgba(255,255,255,0.3)",
										fontSize: 11,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										mt: 0.25,
									}}
								>
									{track.albumName}
								</Typography>
							</Box>

							{!isDriving && (
							<IconButton
								onClick={() => setLibraryOpen(true)}
								size="small"
								sx={{
									color: "rgba(255,255,255,0.5)",
									p: 0.5,
									alignSelf: "flex-start",
									flexShrink: 0,
									"&:hover": { color: "white" },
								}}
							>
								<QueueMusicRounded sx={{ fontSize: 20 }} />
							</IconButton>
							)}
						</Box>

						{/* Progress */}
						<Box>
							<Slider
								value={track.progressMs}
								min={0}
								max={track.durationMs}
								size="small"
								sx={{
									color: SPOTIFY_GREEN,
									height: 3,
									padding: "8px 0",
									"& .MuiSlider-thumb": {
										width: 12,
										height: 12,
										transition: "none",
										"&:hover, &.Mui-active": {
											boxShadow: "0 0 0 6px rgba(29,185,84,0.2)",
										},
									},
									"& .MuiSlider-rail": {
										backgroundColor: "rgba(255,255,255,0.15)",
									},
								}}
							/>
							<Box
								sx={{
									display: "flex",
									justifyContent: "space-between",
									mt: -1,
								}}
							>
								<Typography
									sx={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
								>
									{formatMs(track.progressMs)}
								</Typography>
								<Typography
									sx={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
								>
									{formatMs(track.durationMs)}
								</Typography>
							</Box>
						</Box>

						{/* Controls row */}
						<Box
							sx={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<IconButton
								onClick={toggleShuffle}
								sx={{
									...ctrlBtn,
									color: track.shuffle
										? SPOTIFY_GREEN
										: "rgba(255,255,255,0.5)",
								}}
							>
								<ShuffleRounded sx={{ fontSize: 20 }} />
							</IconButton>

							<IconButton onClick={previous} sx={ctrlBtn}>
								<SkipPreviousRounded sx={{ fontSize: 32 }} />
							</IconButton>

							<IconButton
								onClick={track.isPlaying ? pause : play}
								sx={{
									color: "black",
									backgroundColor: "white",
									p: 1,
									"&:hover": { backgroundColor: "rgba(255,255,255,0.85)" },
								}}
							>
								{track.isPlaying ? (
									<PauseRounded sx={{ fontSize: 28 }} />
								) : (
									<PlayArrowRounded sx={{ fontSize: 28 }} />
								)}
							</IconButton>

							<IconButton onClick={next} sx={ctrlBtn}>
								<SkipNextRounded sx={{ fontSize: 32 }} />
							</IconButton>

							<IconButton
								onClick={cycleRepeat}
								sx={{
									...ctrlBtn,
									color:
										track.repeat !== "off"
											? SPOTIFY_GREEN
											: "rgba(255,255,255,0.5)",
								}}
							>
								{track.repeat === "track" ? (
									<RepeatOneRounded sx={{ fontSize: 20 }} />
								) : (
									<RepeatRounded sx={{ fontSize: 20 }} />
								)}
							</IconButton>
						</Box>
					</Box>
				)}
			</Box>

			{/* ── Library overlay panel ─────────────────────────────────────────── */}
			<Box
				sx={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					p: 2,
					backgroundColor: "#12161A",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					transform: libraryOpen ? "translateX(0)" : "translateX(100%)",
					transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
					pointerEvents: libraryOpen ? "auto" : "none",
				}}
			>
				<SpotifyLibrary
					spotify={spotify}
					onBack={() => setLibraryOpen(false)}
					isDriving={isDriving}
				/>
			</Box>
		</Popover>
	);
};

export default SpotifyPopup;
