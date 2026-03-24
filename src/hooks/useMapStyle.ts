import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import {
	getTimeOfDay,
	getStyleForPeriod,
	getCurrentStyle,
	type TimeOfDay,
} from "../lib/mapStyle";

const TIME_OF_DAY_VALUES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];

function getDevOverride(): TimeOfDay | null {
	if (process.env.NODE_ENV !== "development") return null;
	const param = new URLSearchParams(window.location.search).get("tod");
	return TIME_OF_DAY_VALUES.includes(param as TimeOfDay)
		? (param as TimeOfDay)
		: null;
}

export function useMapStyle(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
) {
	const devOverride = getDevOverride();
	const [period, setPeriod] = useState<TimeOfDay>(
		devOverride ?? getTimeOfDay(),
	);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (devOverride) return;

		intervalRef.current = setInterval(() => {
			const next = getTimeOfDay();
			setPeriod((prev) => (prev !== next ? next : prev));
		}, 60_000);

		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [devOverride]);

	useEffect(() => {
		if (!mapLoaded || !mapRef.current) return;
		mapRef.current.setStyle(getStyleForPeriod(period));
	}, [period, mapLoaded]);

	return { period };
}
