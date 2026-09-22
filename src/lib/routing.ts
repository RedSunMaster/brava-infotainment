import { getValhallaRoute, snapToRoadValhalla } from "./valhalla";
import { getMapboxRoute, snapToRoadMapbox } from "./mapboxDirections";
import type { RoutingProvider } from "../constants";

export interface NormalizedManeuver {
	instruction: string;
	length: number;
	time: number;
	begin_shape_index: number;
	type: number | string;
	modifier?: string;
}

export interface NormalizedRoute {
	coords: [number, number][];
	maneuvers: NormalizedManeuver[];
}

export async function getRoute(
	origin: [number, number],
	dest: [number, number],
	provider: RoutingProvider,
	stops: [number, number][] = [],
): Promise<NormalizedRoute> {
	return provider === "mapbox"
		? getMapboxRoute(origin, dest, stops)
		: getValhallaRoute(origin, dest, stops);
}

export async function snapToRoad(
	trail: [number, number][],
	provider: RoutingProvider,
): Promise<[number, number]> {
	return provider === "mapbox"
		? snapToRoadMapbox(trail)
		: snapToRoadValhalla(trail);
}
