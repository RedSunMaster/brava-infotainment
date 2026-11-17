import { useEffect } from "react";
import type mapboxgl from "mapbox-gl";
import { setTrafficAppearance } from "../lib/mapStyle";

/** Shows or hides live traffic, and fades it back while a route is on screen so the route's own colours lead. */
export function useTrafficLayer(mapRef: React.RefObject<mapboxgl.Map | null>, mapLoaded: boolean, visible: boolean, dimmed: boolean) {
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const apply = () => setTrafficAppearance(map, { visible, dimmed });
		apply();
		map.on("style.load", apply);
		return () => { map.off("style.load", apply); };
	}, [mapRef, mapLoaded, visible, dimmed]);
}
