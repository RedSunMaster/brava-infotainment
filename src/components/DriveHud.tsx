import React from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import SpeedRounded from "@mui/icons-material/SpeedRounded";
import FlagRounded from "@mui/icons-material/FlagRounded";
import { BAND_LABEL, scoreBand, type LiveDrive } from "../lib/drives";
import { clock, deltaLabel } from "../lib/raceGhost";
import { flashText, type DriveFlash, type RaceStatus } from "../hooks/useDrives";

interface Props {
	mode: "smooth" | "ghost";
	live: LiveDrive | null;
	race: RaceStatus | null;
	flash: DriveFlash | null;
}

const card = { pointerEvents: "none", display: "flex", alignItems: "center", gap: 1.25, px: 2, py: 1, borderRadius: 3, bgcolor: (theme: { palette: { background: { paper: string } } }) => alpha(theme.palette.background.paper, 0.92), border: "1px solid", borderColor: "divider", boxShadow: 6 } as const;

const BAND_COLOUR = { great: "success.main", good: "success.main", fair: "warning.main", rough: "error.main" } as const;

/** The live smooth-driving score, or the race against the ghost, always in view at the top of the map and silent. */
export default function DriveHud({ mode, live, race, flash }: Props) {
	if (!live) return null;
	if (mode === "smooth") {
		const band = live.score === null ? null : scoreBand(live.score);
		return (
			<Box aria-label="Smooth driving score" role="status" sx={card}>
				<SpeedRounded sx={{ fontSize: 34, color: band ? BAND_COLOUR[band] : "text.secondary" }} />
				<Box>
					<Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: band ? BAND_COLOUR[band] : "text.primary" }}>{live.score === null ? "—" : live.score}</Typography>
					<Typography sx={{ fontSize: 17, color: flash || live.speeding ? "warning.main" : "text.secondary", lineHeight: 1.2, fontWeight: flash || live.speeding ? 700 : 400 }}>
						{flash ? flashText(flash) : live.speeding ? "Over the limit" : band ? BAND_LABEL[band] : "Warming up"}
					</Typography>
				</Box>
			</Box>
		);
	}
	const ahead = race ? race.deltaS < 0 : false;
	return (
		<Box aria-label="Ghost race" role="status" sx={card}>
			<FlagRounded sx={{ fontSize: 34, color: race ? (ahead ? "success.main" : "error.main") : "text.secondary" }} />
			<Box>
				<Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: race ? (ahead ? "success.main" : "error.main") : "text.primary" }}>{race ? deltaLabel(race.deltaS) : "No ghost"}</Typography>
				<Typography sx={{ fontSize: 17, color: "text.secondary", lineHeight: 1.2 }}>
					{race ? `Best ${clock(race.ghostSeconds)} · ${Math.round(race.progress * 100)}% of the way` : live.distanceM < 500 ? "Looking for a route you know" : "New route: this run sets the time"}
				</Typography>
			</Box>
		</Box>
	);
}
