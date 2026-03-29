import { useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { getRoute, NormalizedManeuver } from "../lib/routing";
import type { RoutingProvider } from "../constants";
import { alpha, useTheme } from "@mui/material";

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

		// Background (faded) route — full path, never trimmed
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
			// Reroute — update existing source in place
			(map.getSource("route-bg") as mapboxgl.GeoJSONSource).setData(geojson);
		}

		// Foreground (remaining) route — trimmed each position tick
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
			// Reroute — update existing source in place
			(map.getSource("route") as mapboxgl.GeoJSONSource).setData(geojson);
		}
	}

	function trimRoute(fromIndex: number) {
		const map = mapRef.current;
		if (!map?.getSource("route")) return;
		const remaining = coordsRef.current.slice(fromIndex);
		(map.getSource("route") as mapboxgl.GeoJSONSource).setData(
			toFeature(remaining),
		);
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
