import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DEV_ORIGIN } from "../constants";
import { MAP_STYLE, applyClouds, applyNight, applyTerrain, applyTraffic, cloudsWanted, nightWanted, setCloudAppearance } from "../lib/mapStyle";
import cloudsUrl from "../../public/textures/earth-clouds.webp";
import lightsUrl from "../../public/textures/city-lights.webp";
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
			config: { basemap: { lightPreset: initialPeriod.current, showPointOfInterestLabels: true, show3dObjects: true, showHdRoads: true, showLandmarkIcons: true } },
			center: DEV_ORIGIN,
			zoom: 1.5,
			pitch: 0,
			projection: "globe",
		});

		// Lets the dev tools (and UI tests) inspect the live map; never exposed in packaged builds.
		if (process.env.NODE_ENV !== "production") (window as unknown as { __bravaMap?: mapboxgl.Map }).__bravaMap = mapRef.current;
		mapRef.current.on("style.load", () => { applyTerrain(mapRef.current!); applyTraffic(mapRef.current!); applyClouds(mapRef.current!, cloudsUrl, cloudsWanted()); void applyNight(mapRef.current!, nightWanted(), new Date(), lightsUrl); setCloudAppearance(mapRef.current!, initialPeriod.current); });
		// Live: the terminator creeps west a quarter of a degree a minute, so redraw the night side every minute, and straight away when the
		// screen wakes up or the app comes back to the front (the clock may have jumped).
		const drawNight = () => { const map = mapRef.current; if (map && map.isStyleLoaded() && nightWanted()) void applyNight(map, true, new Date(), lightsUrl); };
		const nightTimer = window.setInterval(drawNight, 60 * 1000);
		const onVisible = () => { if (document.visibilityState === "visible") drawNight(); };
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", drawNight);
		mapRef.current.on("load", () => setMapLoaded(true));

		const resize = new ResizeObserver(() => mapRef.current?.resize());
        resize.observe(container.current);
        return () => {
			window.clearInterval(nightTimer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", drawNight);
			resize.disconnect();
			// Remove the map after the other hooks have cleaned up their layers and markers (they run later in this same unmount),
			// otherwise they touch a map that no longer has a style. This matters now that switching profiles remounts the app.
			const map = mapRef.current;
			setTimeout(() => map?.remove(), 0);
		};
	}, []);

	return { mapRef, mapLoaded };
}
