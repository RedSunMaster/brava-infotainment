import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getRoute, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";
import { alpha, useTheme } from "@mui/material";

function calcDistanceProgress(
	coords: [number, number][],
	fromIndex: number,
): number {
	if (coords.length < 2) return 0;

	// ✅ Haversine accumulator
	let total = 0;
	let covered = 0;

	for (let i = 1; i < coords.length; i++) {
		const d = haversineMeters(coords[i - 1], coords[i]);
		if (i <= fromIndex) covered += d;
		total += d;
	}

	return total === 0 ? 0 : covered / total;
}

function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const R = 6_371_000;
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
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

		if (map.getSource("route")) {
			(map.getSource("route") as mapboxgl.GeoJSONSource).setData(geojson);
		} else {
			map.addSource("route", {
				type: "geojson",
				data: geojson,
				lineMetrics: true,
			});
			map.addLayer(
				{
					id: "route",
					type: "line",
					source: "route",
					layout: { "line-cap": "round" },
					paint: {
						"line-color": theme.palette.primary.main,
						"line-width": 5,
						"line-emissive-strength": 1,
						"line-gradient": [
							"interpolate",
							["linear"],
							["line-progress"],
							0,
							theme.palette.primary.main,
							1,
							theme.palette.primary.main,
						],
					},
				},
				map.getLayer("puck-matrix-capture") ? "puck-matrix-capture" : undefined,
			);
		}
	}

	function trimRoute(fromIndex: number) {
		const map = mapRef.current;
		if (!map?.getLayer("route")) return;

		const progress = calcDistanceProgress(coordsRef.current, fromIndex);

		map.setPaintProperty("route", "line-gradient", [
			"interpolate",
			["linear"],
			["line-progress"],
			0,
			alpha(theme.palette.primary.main, 0),
			Math.max(0, progress - 0.002),
			alpha(theme.palette.primary.main, 0),
			progress,
			theme.palette.primary.main,
			1,
			theme.palette.primary.main,
		]);
	}

	return { coordsRef, maneuversRef, maneuvers, fetchRoute, trimRoute };
}
function toFeature(coords: [number, number][]): GeoJSON.Feature {
	return {
		type: "Feature",
		properties: {},
		geometry: { type: "LineString", coordinates: coords },
	};
}
