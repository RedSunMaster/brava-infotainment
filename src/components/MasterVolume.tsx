import React from "react";
import { Box, Typography } from "@mui/material";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import VolumeOffRounded from "@mui/icons-material/VolumeOffRounded";
import DriveButton from "./DriveButton";
import { useMasterVolume } from "../hooks/useMasterVolume";

/** Steps the master volume moves by from the buttons. */
export const VOLUME_STEP = 10;

/** Quieter / louder buttons with a mute toggle between them. The master volume works with or without Spotify. */
export default function MasterVolume({ buttonHeight = 64 }: { buttonHeight?: number }) {
	const { level, muted, setLevel, toggleMute } = useMasterVolume();
	const shown = muted ? 0 : level;
	return <Box role="group" aria-label={muted ? "Master volume, muted" : `Master volume ${level}%`} sx={{ display: "flex", alignItems: "center" }}>
		<DriveButton color="inherit" aria-label="Decrease volume" disabled={level <= 0} onClick={() => setLevel(Math.max(0, Math.ceil(level / VOLUME_STEP) * VOLUME_STEP - VOLUME_STEP))} sx={{ minWidth: 0, flex: "0 0 52px", minHeight: buttonHeight }}><ChevronLeftRounded /></DriveButton>
		<DriveButton color="inherit" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={toggleMute} sx={{ minWidth: 92, minHeight: buttonHeight, gap: 0.5 }}>
			{muted ? <VolumeOffRounded aria-hidden sx={{ fontSize: 30, color: "warning.main" }} /> : <VolumeUpRounded aria-hidden sx={{ fontSize: 30, color: "text.secondary" }} />}
			<Typography aria-live="polite" sx={{ fontSize: 28, fontWeight: 500 }}>{shown}</Typography>
		</DriveButton>
		<DriveButton color="inherit" aria-label="Increase volume" disabled={level >= 100 && !muted} onClick={() => setLevel(Math.min(100, Math.floor(level / VOLUME_STEP) * VOLUME_STEP + VOLUME_STEP))} sx={{ minWidth: 0, flex: "0 0 52px", minHeight: buttonHeight }}><ChevronRightRounded /></DriveButton>
	</Box>;
}
