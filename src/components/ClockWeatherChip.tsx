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
import GpsIndicator, { gpsDescription } from "./GpsIndicator";
import { useThemeMode } from "../ThemeContext";

function wmoIcon(code: number) {
	if (code === 0) return <WbSunnyRounded sx={{ fontSize: 28 }} />;
	if (code <= 3) return <WbTwilightRounded sx={{ fontSize: 28 }} />;
	if (code <= 48) return <BlurOnRounded sx={{ fontSize: 28 }} />;
	if (code <= 67) return <GrainRounded sx={{ fontSize: 28 }} />;
	if (code <= 77) return <AcUnitRounded sx={{ fontSize: 28 }} />;
	if (code <= 82) return <CloudRounded sx={{ fontSize: 28 }} />;
	return <FlashOnRounded sx={{ fontSize: 28 }} />;
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
	gpsStatus: GpsStatus;
	estimating?: boolean;
	/** The app is running as a display preview, not in the car. */
	previewMode?: boolean;
}

/** A thin rule between the strip's three parts. */
function Divider() {
	return <Box aria-hidden sx={{ width: "1px", height: 28, flexShrink: 0, bgcolor: (theme) => alpha(theme.palette.text.primary, 0.2) }} />;
}

/**
 * The status bar: time on the left, weather and GPS on the right, running edge to edge along the top
 * of the screen. Everything shares one size of text and icon; the only colour is the GPS status, so
 * a problem stands out, and the bar's lower edge picks up that colour too.
 */
export default function ClockWeatherChip({ gpsStatus, estimating = false, previewMode = false }: Props) {
	const theme = useTheme();
	const [time, setTime] = useState(new Date());
	const { weather } = useThemeMode();

	// The clock only shows minutes, so it only needs to tick when the minute changes.
	useEffect(() => {
		const id = setInterval(() => setTime(new Date()), 5000);
		return () => clearInterval(id);
	}, []);

	const clock = time.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
	const simulated = previewMode && gpsStatus !== "fix" && !estimating;
	const accent = gpsStatus === "fix" || simulated ? null : gpsStatus === "disconnected" && !estimating ? theme.palette.error.main : theme.palette.warning.main;
	const text = { fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" as const };

	return (
		<Box
			role="status"
			aria-label={`${clock}${weather ? `, ${weather.temp} degrees, ${wmoLabel(weather.code)}` : ""}, ${simulated ? "preview mode" : gpsDescription(gpsStatus, estimating)}`}
			sx={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 2,
				width: "100%",
				height: 48,
				px: 3,
				boxSizing: "border-box",
				background: alpha(theme.palette.surface.main, 0.94),
				backdropFilter: "blur(10px)",
				borderBottom: `${accent ? 3 : 1}px solid ${accent ?? alpha(theme.palette.text.primary, 0.16)}`,
				color: theme.palette.text.primary,
				whiteSpace: "nowrap",
			}}
		>
			<Typography sx={text}>{clock}</Typography>
			<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
				{weather && (
					<>
						<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
							{wmoIcon(weather.code)}
							<Typography sx={{ ...text, color: "text.primary" }}>{weather.temp}&deg;</Typography>
						</Box>
						<Divider />
					</>
				)}
				<GpsIndicator status={gpsStatus} estimating={estimating} preview={previewMode} />
			</Box>
		</Box>
	);
}
