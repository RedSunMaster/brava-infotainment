import { useEffect } from "react";
import mapboxgl from "mapbox-gl";

// Only select a footprint containing the destination, never an unrelated nearby building.
export function containsDestination(geometry: GeoJSON.Geometry, point: [number, number]): boolean {
	const insideRing = (ring: number[][]) => {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [x, y] = ring[i], [px, py] = ring[j];
			if ((y > point[1]) !== (py > point[1]) && point[0] < (px - x) * (point[1] - y) / (py - y) + x) inside = !inside;
		}
		return inside;
	};
	const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
	return polygons.some(rings => insideRing(rings[0]) && !rings.slice(1).some(insideRing));
}

export function useDestinationHighlight(mapRef: React.RefObject<mapboxgl.Map | null>, loaded: boolean, destination: [number, number] | null) {
	const lng = destination?.[0], lat = destination?.[1];
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !loaded || lng == null || lat == null) return;
		const point: [number, number] = [lng, lat];
		const marker = new mapboxgl.Marker({ color: "#2563eb" }).setLngLat(point).addTo(map);
		marker.getElement().setAttribute("aria-label", "Destination");
		let selected: mapboxgl.TargetFeature | undefined;
		let needsUpdate = true;
		// The follow camera ends a move every frame while driving, so a refresh is asked for every frame: look again at most a few
		// times a second, and only at the destination's own spot (querying the whole screen's buildings cost several ms a frame).
		let lastQuery = 0;
		const refresh = () => { needsUpdate = true; };
		const clear = () => {
			if (selected) {
				try { map.removeFeatureState(selected, "select"); } catch { /* Style may already have been replaced. */ }
				selected = undefined;
			}
		};
		const restore = () => { selected = undefined; refresh(); };
		const update = () => {
			if (!needsUpdate || !map.isStyleLoaded()) return;
			const now = performance.now();
			if (now - lastQuery < 400) { map.triggerRepaint(); return; }
			lastQuery = now;
			needsUpdate = false;
			const pixel = map.project(point);
			const { clientWidth, clientHeight } = map.getContainer();
			if (pixel.x < 0 || pixel.y < 0 || pixel.x > clientWidth || pixel.y > clientHeight) return;
			const features = map.queryRenderedFeatures([[pixel.x - 3, pixel.y - 3], [pixel.x + 3, pixel.y + 3]], { target: { featuresetId: "buildings", importId: "basemap" } });
			const feature = features.find(item => item.id != null && containsDestination(item.geometry, point));
			if (selected?.id === feature?.id && selected?.namespace === feature?.namespace) return;
			clear();
			selected = feature;
			if (selected) map.setFeatureState(selected, { select: true });
		};
		map.on("moveend", refresh);
		map.on("sourcedata", refresh);
		map.on("style.load", restore);
		map.on("render", update);
		return () => {
			map.off("moveend", refresh);
			map.off("sourcedata", refresh);
			map.off("style.load", restore);
			map.off("render", update);
			clear();
			marker.remove();
		};
	}, [mapRef, loaded, lng, lat]);
}
