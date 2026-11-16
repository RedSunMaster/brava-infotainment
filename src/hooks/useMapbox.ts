import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DEV_ORIGIN, ZOOM_LEVEL } from "../constants";
import { MAP_STYLE } from "../lib/mapStyle";
import { useThemeMode } from "../ThemeContext";
// In useMapbox.ts — expose a loaded state

export function useMapbox(container: React.RefObject<HTMLDivElement | null>) {
	const { period } = useThemeMode();
	const initialPeriod = useRef(period);
	const mapRef = useRef<mapboxgl.Map | null>(null);
	const [mapLoaded, setMapLoaded] = useState(false);

	useEffect(() => {
		if (!container.current) return;
		mapboxgl.accessToken = process.env.MAPBOX_TOKEN;
		mapRef.current = new mapboxgl.Map({
			container: container.current,
			style: MAP_STYLE,
			config: { basemap: { lightPreset: initialPeriod.current, showPointOfInterestLabels: false, show3dObjects: true } },
			center: DEV_ORIGIN,
			zoom: ZOOM_LEVEL,
            pitch: 45,
		});

		mapRef.current.on("load", () => setMapLoaded(true));

		const resize = new ResizeObserver(() => mapRef.current?.resize());
        resize.observe(container.current);
        return () => { resize.disconnect(); mapRef.current?.remove(); };
	}, []);

	return { mapRef, mapLoaded };
}
