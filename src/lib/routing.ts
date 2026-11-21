import { getValhallaRoute, snapToRoadValhalla } from "./valhalla";
import { getMapboxRoute, getMapboxRoutes, snapToRoadMapbox } from "./mapboxDirections";
import type { RoutingProvider } from "../constants";

export interface NormalizedManeuver {
	instruction: string;
	length: number;
	time: number;
	begin_shape_index: number;
	type: number | string;
	modifier?: string;
	lanes?: { indications: string[]; valid: boolean; active?: boolean; valid_indication?: string }[];
	junctions?: { distance: number; url: string }[];
}

export interface NormalizedRoute {
	coords: [number, number][];
	maneuvers: NormalizedManeuver[];
	congestion?: string[];
	speedLimits?: ({ speed?: number; unit?: string; unknown?: boolean; none?: boolean } | null)[];
	incidents?: { id: string; description: string; index: number }[];
	trafficDelaySeconds?: number;
	/** Travel time of each leg (one per waypoint), when the provider reports it. */
	legSeconds?: number[];
	closures?: { start: number; end: number }[];
}

export type RoutePreference = "toll" | "ferry" | "unpaved";
/** `headingDeg` is the way the car is facing: a route from where it is now then sets off that way, not back the way it came. */
export interface RouteOptions { avoid?: RoutePreference[]; speedMs?: number; headingDeg?: number }

export async function getRoutes(origin: [number, number], dest: [number, number], provider: RoutingProvider, stops: [number, number][] = [], target?: [number, number], options?: RouteOptions): Promise<NormalizedRoute[]> {
	if (provider !== "mapbox" && options?.avoid?.length) throw new Error("Route preferences require Mapbox routing.");
	return provider === "mapbox" ? getMapboxRoutes(origin, dest, stops, true, target, options) : [await getValhallaRoute(origin, dest, stops, options?.headingDeg)];
}

export async function getRoute(
	origin: [number, number],
	dest: [number, number],
	provider: RoutingProvider,
	stops: [number, number][] = [],
	target?: [number, number],
	options?: RouteOptions,
): Promise<NormalizedRoute> {
	if (provider !== "mapbox" && options?.avoid?.length) throw new Error("Route preferences require Mapbox routing.");
	return provider === "mapbox"
		? getMapboxRoute(origin, dest, stops, target, options)
		: getValhallaRoute(origin, dest, stops, options?.headingDeg);
}

export async function snapToRoad(
	trail: [number, number][],
	provider: RoutingProvider,
): Promise<[number, number]> {
	return provider === "mapbox"
		? snapToRoadMapbox(trail)
		: snapToRoadValhalla(trail);
}
