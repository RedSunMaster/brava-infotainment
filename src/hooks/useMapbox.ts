import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DEV_ORIGIN, MAPBOX_TOKEN, ZOOM_LEVEL } from "../constants";
import { getCurrentStyle } from "../lib/mapStyle";
// In useMapbox.ts — expose a loaded state

export function useMapbox(container: React.RefObject<HTMLDivElement | null>) {
	const mapRef = useRef<mapboxgl.Map | null>(null);
	const [mapLoaded, setMapLoaded] = useState(false);

	useEffect(() => {
		if (!container.current) return;
		mapboxgl.accessToken = process.env.MAPBOX_TOKEN;
		mapRef.current = new mapboxgl.Map({
			container: container.current,
			style: getCurrentStyle(),
			center: DEV_ORIGIN,
			zoom: ZOOM_LEVEL,
		});

		mapRef.current.on("load", () => setMapLoaded(true));

		return () => mapRef.current?.remove();
	}, []);

	return { mapRef, mapLoaded };
}
