import type { PaletteMode } from "@mui/material";
import type { TimeOfDay } from "./mapStyle";

export type ThemePreference = "auto" | "light" | "dark";
export interface AmbientWeather {
	temp: number;
	code: number;
	cloudCover: number;
	precipitation: number;
	observedAt: number;
}
export interface AmbientAppearance {
	mode: PaletteMode;
	period: TimeOfDay;
	reason: string;
}

// NOAA fractional-year solar position, evaluated in UTC to avoid DST/timezone errors.
export function solarElevation(
	date: Date,
	[longitude, latitude]: [number, number],
): number {
	const year = date.getUTCFullYear();
	const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
	const elapsed = (date.getTime() - Date.UTC(year, 0, 1)) / 86400000;
	const g = ((2 * Math.PI) / days) * (elapsed - 0.5);
	const equation =
		229.18 *
		(0.000075 +
			0.001868 * Math.cos(g) -
			0.032077 * Math.sin(g) -
			0.014615 * Math.cos(2 * g) -
			0.040849 * Math.sin(2 * g));
	const declination =
		0.006918 -
		0.399912 * Math.cos(g) +
		0.070257 * Math.sin(g) -
		0.006758 * Math.cos(2 * g) +
		0.000907 * Math.sin(2 * g) -
		0.002697 * Math.cos(3 * g) +
		0.00148 * Math.sin(3 * g);
	const minutes =
		date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
	const angle = (minutes + equation + 4 * longitude) / 4 - 180;
	const radians = Math.PI / 180;
	const sine =
		Math.sin(latitude * radians) * Math.sin(declination) +
		Math.cos(latitude * radians) *
			Math.cos(declination) *
			Math.cos(angle * radians);
	return Math.asin(Math.max(-1, Math.min(1, sine))) / radians;
}

export function ambientAppearance(
	date: Date,
	position: [number, number],
	weather: AmbientWeather | null,
	previousMode: PaletteMode = "dark",
): AmbientAppearance {
	const elevation = solarElevation(date, position);
	const rising =
		solarElevation(new Date(date.getTime() + 300000), position) > elevation;
	const fresh =
		weather &&
		date.getTime() - weather.observedAt >= 0 &&
		date.getTime() - weather.observedAt < 30 * 60000;
	const fog = fresh && (weather.code === 45 || weather.code === 48);
	const gloomy =
		fresh &&
		weather.cloudCover >= 85 &&
		weather.precipitation >= 0.5 &&
		elevation < 20;
	const period: TimeOfDay =
		elevation < -6
			? "night"
			: elevation < 6
				? rising
					? "dawn"
					: "dusk"
				: fog || gloomy
					? "dusk"
					: "day";
	// A one-degree daylight deadband prevents repeated switches around the horizon.
	const mode: PaletteMode =
		fog || gloomy || elevation < 0
			? "dark"
			: elevation > 1
				? "light"
				: previousMode;
	return {
		mode,
		period,
		reason: fog
			? "Fog"
			: gloomy
				? "Rain and heavy cloud"
				: period === "day"
					? "Daylight"
					: period === "night"
						? "Night"
						: rising
							? "Dawn"
							: "Dusk",
	};
}
