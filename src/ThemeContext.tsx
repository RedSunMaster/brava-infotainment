import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ThemeProvider, CssBaseline, type PaletteMode } from "@mui/material";
import { getTheme } from "./theme";
import { DEV_ORIGIN } from "./constants";
import {
	ambientAppearance,
	type AmbientWeather,
	type ThemePreference,
} from "./lib/ambientTheme";
import type { TimeOfDay } from "./lib/mapStyle";

interface ThemeContextValue {
	mode: PaletteMode;
	period: TimeOfDay;
	preference: ThemePreference;
	reason: string;
	weather: AmbientWeather | null;
	setPreference: (preference: ThemePreference) => void;
	updatePosition: (position: [number, number]) => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
export function useThemeMode(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) throw new Error("AppThemeProvider is required");
	return context;
}
function storedPreference(): ThemePreference {
	try {
		const value = localStorage.getItem("brava.theme");
		return value === "light" || value === "dark" ? value : "auto";
	} catch {
		return "auto";
	}
}
interface WeatherResponse {
	current?: {
		time: number;
		temperature_2m: number;
		weather_code: number;
		cloud_cover: number;
		precipitation: number;
	};
}
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
	const [preference, setPreferenceState] =
		useState<ThemePreference>(storedPreference);
	const [position, setPosition] = useState<[number, number]>(DEV_ORIGIN);
	const [now, setNow] = useState(() => new Date());
	const [weather, setWeather] = useState<AmbientWeather | null>(null);
	const previousMode = useRef<PaletteMode>("dark");
	const updatePosition = useCallback((next: [number, number]) => {
		if (
			!next.every(Number.isFinite) ||
			Math.abs(next[0]) > 180 ||
			Math.abs(next[1]) > 90
		)
			return;
		setPosition((previous) =>
			Math.abs(previous[0] - next[0]) + Math.abs(previous[1] - next[1]) < 0.05
				? previous
				: [...next],
		);
	}, []);
	const setPreference = useCallback((next: ThemePreference) => {
		setPreferenceState(next);
		try {
			localStorage.setItem("brava.theme", next);
		} catch {
			/* Session preference still applies. */
		}
	}, []);
	useEffect(() => {
		const tick = () => setNow(new Date());
		const timer = setInterval(tick, 60000);
		window.addEventListener("focus", tick);
		document.addEventListener("visibilitychange", tick);
		return () => {
			clearInterval(timer);
			window.removeEventListener("focus", tick);
			document.removeEventListener("visibilitychange", tick);
		};
	}, []);
	useEffect(() => {
		let active = true;
		let pending: AbortController | null = null;
		setWeather(null);
		async function refresh() {
			pending?.abort();
			const controller = new AbortController();
			pending = controller;
			const timeout = setTimeout(() => controller.abort(), 8000);
			try {
				const response = await fetch(
					`https://api.open-meteo.com/v1/forecast?latitude=${position[1]}&longitude=${position[0]}&current=temperature_2m,weather_code,cloud_cover,precipitation&timeformat=unixtime`,
					{ signal: controller.signal },
				);
				if (!response.ok) return;
				const data: WeatherResponse = await response.json();
				const current = data.current;
				if (
					!current ||
					![
						current.time,
						current.temperature_2m,
						current.weather_code,
						current.cloud_cover,
						current.precipitation,
					].every(
						(value) => typeof value === "number" && Number.isFinite(value),
					)
				)
					return;
				if (active)
					setWeather({
						temp: Math.round(current.temperature_2m),
						code: current.weather_code,
						cloudCover: current.cloud_cover,
						precipitation: current.precipitation,
						observedAt: current.time * 1000,
					});
			} catch {
				/* Solar timing remains available offline. */
			} finally {
				clearTimeout(timeout);
			}
		}
		void refresh();
		const timer = setInterval(() => void refresh(), 10 * 60000);
		return () => {
			active = false;
			pending?.abort();
			clearInterval(timer);
		};
	}, [position]);
	const automatic = ambientAppearance(
		now,
		position,
		weather,
		previousMode.current,
	);
	useEffect(() => {
		previousMode.current = automatic.mode;
	}, [automatic.mode]);
	const override =
		process.env.NODE_ENV === "development"
			? new URLSearchParams(window.location.search).get("tod")
			: null;
	const previewPeriod: TimeOfDay | null =
		override === "day" ||
		override === "dawn" ||
		override === "dusk" ||
		override === "night"
			? override
			: null;
	const mode =
		preference === "auto"
			? previewPeriod
				? previewPeriod === "day"
					? "light"
					: "dark"
				: automatic.mode
			: preference;
	const period =
		preference === "auto"
			? (previewPeriod ?? automatic.period)
			: preference === "light"
				? "day"
				: "night";
	const reason =
		preference === "auto"
			? previewPeriod
				? `Preview: ${previewPeriod}`
				: automatic.reason
			: preference === "light"
				? "Manual day"
				: "Manual night";
	const freshWeather =
		weather && now.getTime() - weather.observedAt < 30 * 60000 ? weather : null;
	const theme = useMemo(() => getTheme(mode), [mode]);
	return (
		<ThemeContext.Provider
			value={{
				mode,
				period,
				preference,
				reason,
				weather: freshWeather,
				setPreference,
				updatePosition,
			}}
		>
			<ThemeProvider theme={theme}>
				<CssBaseline />
				{children}
			</ThemeProvider>
		</ThemeContext.Provider>
	);
}
