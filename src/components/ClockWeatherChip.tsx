import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme, type Theme } from "@mui/material/styles";
import WbSunnyRounded from "@mui/icons-material/WbSunnyRounded";
import CloudRounded from "@mui/icons-material/CloudRounded";
import GrainRounded from "@mui/icons-material/GrainRounded";
import AcUnitRounded from "@mui/icons-material/AcUnitRounded";
import FlashOnRounded from "@mui/icons-material/FlashOnRounded";
import BlurOnRounded from "@mui/icons-material/BlurOnRounded";
import WbTwilightRounded from "@mui/icons-material/WbTwilightRounded";
import { GpsStatus } from "../hooks/useGps";
import GpsIndicator from "./GpsIndicator";
import { useThemeMode } from "../ThemeContext";

function wmoIcon(code: number) {
	if (code === 0) return <WbSunnyRounded fontSize="small" />;
	if (code <= 3) return <WbTwilightRounded fontSize="small" />;
	if (code <= 48) return <BlurOnRounded fontSize="small" />;
	if (code <= 67) return <GrainRounded fontSize="small" />;
	if (code <= 77) return <AcUnitRounded fontSize="small" />;
	if (code <= 82) return <CloudRounded fontSize="small" />;
	return <FlashOnRounded fontSize="small" />;
}

function wmoLabel(code: number) {
	if (code === 0) return "Clear";
	if (code <= 3) return "Cloudy";
	if (code <= 48) return "Foggy";
	if (code <= 67) return "Rain";
	if (code <= 77) return "Snow";
	if (code <= 82) return "Showers";
	return "Storm";
}

// Shared look for read-only status chips (clock, weather, GPS, drive state).
// Smaller and flatter than buttons so they do not read as tappable.
export function statusChipSx(theme: Theme) {
	return {
		display: "flex",
		alignItems: "center",
		gap: 0.75,
		px: 1.5,
		height: 56,
		boxSizing: "border-box" as const,
		background: alpha(theme.palette.surface.main, 0.94),
		backdropFilter: "blur(10px)",
		border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
		borderRadius: "10px",
		color: theme.palette.text.primary,
		whiteSpace: "nowrap" as const,
	};
}

interface Props {
	position: [number, number];
	gpsStatus: GpsStatus; // ← add
	estimating?: boolean;
}

export default function ClockWeatherChip({ gpsStatus, estimating }: Props) {
	const theme = useTheme();
	const [time, setTime] = useState(new Date());
	const { weather } = useThemeMode();

	// Clock — tick every second
	useEffect(() => {
		const id = setInterval(() => setTime(new Date()), 1000);
		return () => clearInterval(id);
	}, []);

	const chipSx = statusChipSx(theme);

	return (
		<Box
			sx={{
				display: "flex",
				flexDirection: "row",
                flexWrap: "wrap",
				alignItems: "center",
				gap: 0.75,
			}}
		>
			{/* Clock */}
			<Box sx={chipSx}>
				<Typography
					sx={{
						fontSize: 28,
						fontWeight: 700,
						letterSpacing: "0.04em",
						fontVariantNumeric: "tabular-nums",
					}}
				>
					{time.toLocaleTimeString("en-NZ", {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</Typography>
			</Box>

			{/* Weather */}
			{weather && (
				<Box sx={{ ...chipSx, gap: 0.6 }}>
					<Box sx={{ display: "flex", color: theme.palette.primary.main }}>
						{wmoIcon(weather.code)}
					</Box>
					<Typography sx={{ fontSize: 24, fontWeight: 600 }}>
						{weather.temp}&deg;C
					</Typography>
					<Typography
						sx={{ fontSize: 22, color: theme.palette.text.secondary }}
					>
						{wmoLabel(weather.code)}
					</Typography>
				</Box>
			)}

			<GpsIndicator status={gpsStatus} estimating={estimating} />
		</Box>
	);
}
