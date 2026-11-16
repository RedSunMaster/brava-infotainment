import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { PaletteMode } from "@mui/material";
import { getStyleForTheme, type TimeOfDay } from "../lib/mapStyle";

export function useMapStyle(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
	mode: PaletteMode,
	period: TimeOfDay,
	onStyleLoaded?: () => void,
) {
	const callback = useRef(onStyleLoaded);
	callback.current = onStyleLoaded;
	const applied = useRef<string | null>(null);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const restore = () => callback.current?.();
		map.on("style.load", restore);
		return () => {
			map.off("style.load", restore);
		};
	}, [mapRef, mapLoaded]);
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const desired = getStyleForTheme(mode, period);
		if (applied.current === desired) return;
		applied.current = desired;
		map.setStyle(desired);
	}, [mapRef, mapLoaded, mode, period]);
	return { period };
}
