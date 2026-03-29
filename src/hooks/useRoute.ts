import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getRoute, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";
import { alpha, useTheme } from "@mui/material";

function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const R = 6_371_000;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useRoute(mapRef: React.RefObject<mapboxgl.Map | null>) {
	const coordsRef = useRef<[number, number][]>([]);
	const maneuversRef = useRef<NormalizedManeuver[]>([]);
	const [maneuvers, setManeuvers] = useState<NormalizedManeuver[]>([]);
	const theme = useTheme();

	async function fetchRoute(
		origin: [number, number],
		dest: [number, number],
		provider: RoutingProvider,
	) {
		const result = await getRoute(origin, dest, provider);
		coordsRef.current = result.coords;
		maneuversRef.current = result.maneuvers;
		setManeuvers(result.maneuvers);
		drawRoute(result.coords);
	}

	function drawRoute(decoded: [number, number][]) {
		const map = mapRef.current!;
		const geojson = toFeature(decoded);

		if (!map.getSource("route-bg")) {
			map.addSource("route-bg", { type: "geojson", data: geojson });
			map.addLayer({
				id: "route-bg",
				type: "line",
				source: "route-bg",
				minzoom: 5,
				layout: { "line-cap": "round" },
				paint: {
					"line-color": alpha(theme.palette.primary.main, 0.25),
					"line-width": 5,
				},
			});
		} else {
			(map.getSource("route-bg") as mapboxgl.GeoJSONSource).setData(geojson);
		}

		if (!map.getSource("route")) {
			map.addSource("route", {
				type: "geojson",
				data: geojson,
				lineMetrics: true,
			});
			map.addLayer({
				id: "route",
				type: "line",
				source: "route",
				minzoom: 5,
				layout: { "line-cap": "round" },
				paint: {
					"line-color": theme.palette.primary.main,
					"line-width": 5,
					"line-emissive-strength": 1,
				},
			});
		} else {
			(map.getSource("route") as mapboxgl.GeoJSONSource).setData(geojson);
		}
	}

	// Legacy: trim by vertex index — kept for any callers that still use it
	function trimRoute(fromIndex: number) {
		const map = mapRef.current;
		if (!map?.getSource("route")) return;
		const remaining = coordsRef.current.slice(fromIndex);
		(map.getSource("route") as mapboxgl.GeoJSONSource).setData(
			toFeature(remaining),
		);
	}

	// ── Continuous trim by exact distance along route ─────────────────────────
	// Called every rAF frame from usePositionPuck — keeps the route line
	// perfectly in sync with the puck's interpolated position.
	function trimRouteByDistance(distanceM: number) {
		const map = mapRef.current;
		if (!map?.getSource("route")) return;

		const coords = coordsRef.current;
		if (coords.length < 2) return;

		let remaining = Math.max(0, distanceM);

		for (let i = 0; i < coords.length - 1; i++) {
			const segLen = haversineMeters(coords[i], coords[i + 1]);

			if (remaining <= segLen) {
				// Interpolate a fractional start point on this segment
				const t = segLen > 0 ? remaining / segLen : 0;
				const fracStart: [number, number] = [
					coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
					coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
				];
				// Build the remaining line: fractional point + all subsequent vertices
				const trimmed: [number, number][] = [fracStart, ...coords.slice(i + 1)];
				(map.getSource("route") as mapboxgl.GeoJSONSource).setData(
					toFeature(trimmed),
				);
				return;
			}

			remaining -= segLen;
		}

		// Past end of route — empty line
		(map.getSource("route") as mapboxgl.GeoJSONSource).setData(toFeature([]));
	}

	return {
		coordsRef,
		maneuversRef,
		maneuvers,
		fetchRoute,
		trimRoute,
		trimRouteByDistance,
	};
}

function toFeature(coords: [number, number][]): GeoJSON.Feature {
	return {
		type: "Feature",
		properties: {},
		geometry: { type: "LineString", coordinates: coords },
	};
}
