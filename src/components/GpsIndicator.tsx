import { Box, Chip, Tooltip } from "@mui/material";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import GpsOffIcon from "@mui/icons-material/GpsOff";
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";
import type { GpsStatus } from "../hooks/useGps";
import React from "react";

const CONFIG = {
	fix: {
		label: "GPS",
		color: "#22c55e",
		icon: <GpsFixedIcon fontSize="small" />,
	},
	"no-fix": {
		label: "No Fix",
		color: "#f59e0b",
		icon: <SatelliteAltIcon fontSize="small" />,
	},
	disconnected: {
		label: "SIM",
		color: "#6b7280",
		icon: <GpsOffIcon fontSize="small" />,
	},
} as const;

export default function GpsIndicator({ status }: { status: GpsStatus }) {
	const { label, color, icon } = CONFIG[status];
	return (
		<Tooltip
			title={
				status === "disconnected"
					? "GPS unavailable — using simulation"
					: `GPS status: ${label}`
			}
		>
			<Chip
				size="small"
				icon={<Box sx={{ color, display: "flex" }}>{icon}</Box>}
				label={label}
				sx={{
					bgcolor: "rgba(0,0,0,0.6)",
					color: "white",
					border: `1px solid ${color}`,
					backdropFilter: "blur(4px)",
					fontWeight: 600,
					fontSize: "0.7rem",
				}}
			/>
		</Tooltip>
	);
}
