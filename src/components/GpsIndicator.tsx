import { Box, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import GpsOffIcon from "@mui/icons-material/GpsOff";
import GpsNotFixedIcon from "@mui/icons-material/GpsNotFixed";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import PlayCircleOutlineRounded from "@mui/icons-material/PlayCircleOutlineRounded";
import type { GpsStatus } from "../hooks/useGps";
import React from "react";

const ICON = { fontSize: 28 };

const CONFIG = {
	fix: { label: "GPS", tone: "success", icon: <GpsFixedIcon sx={ICON} /> },
	"no-fix": { label: "No fix", tone: "warning", icon: <SatelliteAltIcon sx={ICON} /> },
	disconnected: { label: "GPS lost", tone: "error", icon: <GpsOffIcon sx={ICON} /> },
	// No signal, but the position is being carried along the route at the last speed.
	estimating: { label: "Estimating", tone: "warning", icon: <GpsNotFixedIcon sx={ICON} /> },
} as const;

export function gpsDescription(status: GpsStatus, estimating: boolean): string {
	const shown = estimating && status !== "fix" ? "estimating" : status;
	if (shown === "estimating") return "GPS signal lost: position is estimated along your route";
	if (shown === "disconnected") return "GPS unavailable: location is not current";
	if (shown === "no-fix") return "GPS is searching for a fix";
	return "GPS has a fix";
}

interface Props { status: GpsStatus; estimating?: boolean; /** Running as a display preview with no real GPS. */ preview?: boolean }

/**
 * The GPS part of the status strip. It looks like the other parts (same icon size, same text), and
 * only its colour changes: green while there is a fix, amber or red with a word when there is a problem.
 */
export default function GpsIndicator({ status, estimating = false, preview = false }: Props) {
	const theme = useTheme();
	// With no receiver in a preview there is nothing wrong to report, so say what this is instead.
	if (preview && status !== "fix" && !estimating) {
		return (
			<Tooltip title="Preview: positions are simulated">
				<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
					<PlayCircleOutlineRounded sx={ICON} />
					<Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: "text.primary" }}>Preview</Typography>
				</Box>
			</Tooltip>
		);
	}
	const shown = estimating && status !== "fix" ? "estimating" : status;
	const { label, tone, icon } = CONFIG[shown];
	const color = theme.palette[tone].main;
	return (
		<Tooltip title={gpsDescription(status, estimating)}>
			<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color }}>
				{icon}
				{shown !== "fix" && <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color }}>{label}</Typography>}
			</Box>
		</Tooltip>
	);
}
