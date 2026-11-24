import React from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import SportsEsportsRounded from "@mui/icons-material/SportsEsportsRounded";
import type { PacmanStats } from "../hooks/usePacman";

/** Pac-Man mode's score, always in view at the top of the map: big enough to read at a glance, and silent. */
export default function PacmanHud({ stats }: { stats: PacmanStats | null }) {
	if (!stats) return null;
	return (
		<Box aria-label="Pac-Man score" role="status" sx={{ pointerEvents: "none", display: "flex", alignItems: "center", gap: 1.25, px: 2, py: 1, borderRadius: 3, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92), border: "1px solid", borderColor: "divider", boxShadow: 6 }}>
			<SportsEsportsRounded sx={{ fontSize: 34, color: "#ffd60a" }} />
			<Box>
				<Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{stats.score.toLocaleString("en-NZ")}</Typography>
				<Typography sx={{ fontSize: 17, color: "text.secondary", lineHeight: 1.2 }}>{stats.streak > 0 ? `Run ${stats.streak} · ${stats.multiplier}×` : stats.roadsFailed && !stats.nearby ? "Can't reach road data, retrying" : stats.loading && stats.nearby === null ? "Loading roads…" : "Eat the dots"}</Typography>
			</Box>
		</Box>
	);
}
