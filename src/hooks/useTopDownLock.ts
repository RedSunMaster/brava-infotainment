import { useEffect } from "react";
import type mapboxgl from "mapbox-gl";

/**
 * Keeps the camera looking straight down while `on` (Pac-Man mode): the map's tilt limit goes to 0, so nothing can tilt it — not a
 * hand gesture, the locate / orientation button, nor the fly-down from the globe. Turning the map by hand still works.
 * A view that is tilted when the lock comes on is eased flat first (the follow camera does that itself while following), and the
 * limit is set once it is flat, so the view does not snap.
 */
export function useTopDownLock(mapRef: React.RefObject<mapboxgl.Map | null>, mapLoaded: boolean, on: boolean) {
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded || !on) return;
		const previousMax = map.getMaxPitch();
		let locked = false;
		const lockWhenFlat = () => {
			if (locked || map.getPitch() > 1) return;
			locked = true;
			map.setMaxPitch(0);
			map.off("pitch", lockWhenFlat);
		};
		map.on("pitch", lockWhenFlat);
		lockWhenFlat();
		// Not following, nothing else would bring the view down: ease it flat here.
		const settle = window.setTimeout(() => {
			if (!locked && !map.isMoving()) map.easeTo({ pitch: 0, duration: 600, essential: true });
		}, 50);
		// However long a moving view takes to come down, lock it in the end.
		const fallback = window.setTimeout(() => { if (!locked) { locked = true; map.off("pitch", lockWhenFlat); map.setMaxPitch(0); } }, 8000);
		return () => {
			window.clearTimeout(settle);
			window.clearTimeout(fallback);
			map.off("pitch", lockWhenFlat);
			map.setMaxPitch(previousMax);
		};
	}, [mapRef, mapLoaded, on]);
}
