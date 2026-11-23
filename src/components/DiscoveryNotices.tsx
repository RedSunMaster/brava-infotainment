import React from "react";
import { Box, Typography } from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import TravelExploreRounded from "@mui/icons-material/TravelExploreRounded";
import ParkRounded from "@mui/icons-material/ParkRounded";
import LocationCityRounded from "@mui/icons-material/LocationCityRounded";
import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded";
import DonutLargeRounded from "@mui/icons-material/DonutLargeRounded";
import type { DiscoveryNotice } from "../hooks/useExploration";

const arrive = keyframes`from { opacity: 0; transform: translateY(-16px) scale(0.96); } to { opacity: 1; transform: none; }`;

interface Props { notices: DiscoveryNotice[]; onDismiss: (key: string) => void }

/** Explore mode's "place discovered" cards: glanceable, they go by themselves after a few seconds. */
export default function DiscoveryNotices({ notices, onDismiss }: Props) {
	if (!notices.length) return null;
	return (
		<Box aria-live="polite" sx={{ display: "grid", justifyItems: "center", gap: 1, pointerEvents: "none" }}>
			{notices.map(notice => {
				const Icon = notice.kind === "milestone" ? EmojiEventsRounded : notice.kind === "suburb" ? DonutLargeRounded : notice.kind === "area" ? ParkRounded : notice.kind === "place" ? LocationCityRounded : TravelExploreRounded;
				return (
					<Box key={notice.key} role="status" onClick={() => onDismiss(notice.key)}
						sx={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.5, minWidth: "min(520px, 90vw)", maxWidth: "min(720px, 92vw)", borderRadius: 3, bgcolor: (theme) => alpha(theme.palette.background.paper, 0.94), backdropFilter: "blur(12px)", border: "1px solid", borderColor: "primary.main", boxShadow: 8, animation: `${arrive} 320ms ease-out` }}>
						<Box sx={{ width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16), color: "primary.main" }}>
							<Icon sx={{ fontSize: 38 }} />
						</Box>
						<Box sx={{ minWidth: 0 }}>
							<Typography sx={{ fontSize: 19, fontWeight: 700, color: "primary.main", textTransform: "uppercase", letterSpacing: 0.5 }}>{notice.detail}</Typography>
							<Typography noWrap sx={{ fontSize: 30, fontWeight: 800 }}>{notice.name}</Typography>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}
