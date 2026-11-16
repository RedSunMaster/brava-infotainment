import { Box, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import GpsOffIcon from "@mui/icons-material/GpsOff";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import type { GpsStatus } from "../hooks/useGps";
import { statusChipSx } from "./ClockWeatherChip";
import React from "react";

const CONFIG = {
	fix: { label: "GPS", tone: "success", icon: <GpsFixedIcon fontSize="small" /> },
	"no-fix": { label: "No Fix", tone: "primary", icon: <SatelliteAltIcon fontSize="small" /> },
	disconnected: { label: "GPS Lost", tone: "error", icon: <GpsOffIcon fontSize="small" /> },
} as const;

export default function GpsIndicator({ status }: { status: GpsStatus }) {
	const theme = useTheme();
	const { label, tone, icon } = CONFIG[status];
	const color = theme.palette[tone].main;
	return (
		<Tooltip
			title={
				status === "disconnected"
					? "GPS unavailable: location is not current"
					: `GPS status: ${label}`
			}
		>
			{/* Same chip as the clock in both themes; only the border and icon carry the status colour. */}
			<Box sx={{ ...statusChipSx(theme), borderColor: color }}>
				<Box sx={{ color, display: "flex" }}>{icon}</Box>
				<Typography sx={{ fontSize: 22, fontWeight: 800 }}>{label}</Typography>
			</Box>
		</Tooltip>
	);
}
