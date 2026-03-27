import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import {
	WbSunnyRounded,
	CloudRounded,
	GrainRounded,
	AcUnitRounded,
	FlashOnRounded,
	BlurOnRounded,
	WbTwilightRounded,
} from "@mui/icons-material";
import React from "react";
import { GpsStatus } from "../hooks/useGps";
import GpsIndicator from "./GpsIndicator";

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

interface Props {
	position: [number, number];
	gpsStatus: GpsStatus; // ← add
}

export default function ClockWeatherChip({ position, gpsStatus }: Props) {
	const theme = useTheme();
	const [time, setTime] = useState(new Date());
	const [weather, setWeather] = useState<{ temp: number; code: number } | null>(
		null,
	);

	// Clock — tick every second
	useEffect(() => {
		const id = setInterval(() => setTime(new Date()), 1000);
		return () => clearInterval(id);
	}, []);

	// Weather — fetch once on mount, refresh every 10 min
	useEffect(() => {
		const [lng, lat] = position;
		async function fetchWeather() {
			try {
				const res = await fetch(
					`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
						`&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto`,
				);
				const data = await res.json();
				setWeather({
					temp: Math.round(data.current.temperature_2m),
					code: data.current.weather_code,
				});
			} catch {
				// Do Nothing
			}
		}
		fetchWeather();
		const id = setInterval(fetchWeather, 10 * 60 * 1000);
		return () => clearInterval(id);
	}, []); // intentionally once — weather doesn't need position reactivity

	const chipSx = {
		display: "flex",
		alignItems: "center",
		gap: 0.75,
		px: 1.5,
		py: 0.6,
		background: alpha(theme.palette.background.default, 0.85),
		backdropFilter: "blur(10px)",
		border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
		borderRadius: "10px",
		boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
		color: theme.palette.text.primary,
		whiteSpace: "nowrap" as const,
	};

	return (
		<Box
			sx={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 0.75,
			}}
		>
			{/* Clock */}
			<Box sx={chipSx}>
				<Typography
					sx={{
						fontSize: 15,
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
					<Typography sx={{ fontSize: 13, fontWeight: 600 }}>
						{weather.temp}
						{"\u00B0"}C
					</Typography>
					<Typography
						sx={{ fontSize: 11, color: theme.palette.text.secondary }}
					>
						{wmoLabel(weather.code)}
					</Typography>
				</Box>
			)}

			<GpsIndicator status={gpsStatus} />
		</Box>
	);
}
