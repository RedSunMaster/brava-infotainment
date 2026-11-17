import polyline from "@mapbox/polyline";
import { validCoordinates, placeDetails, type Coordinates, type LocationResult } from "./locationSearch";
import { sampleRoute } from "./routeLine";

export async function searchAlongRoute(category: string, route: Coordinates[], position: Coordinates, token: string, signal: AbortSignal): Promise<LocationResult[]> {
	if (route.length < 2) throw new Error("Route not available for searching.");
	const params = new URLSearchParams({ access_token: token, country: "NZ", proximity: position.join(","), limit: "8", sar_type: "isochrone", route_geometry: "polyline6", route: polyline.encode(sampleRoute(route).map(([lng, lat]) => [lat, lng]), 6), time_deviation: "10" });
	const response = await fetch(`https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(category)}?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
	if (!response.ok) throw new Error("Along-route search is unavailable. Try destination search.");
	const data = await response.json();
	if (!Array.isArray(data.features)) throw new Error("Along-route search is unavailable. Try destination search.");
	return (data.features ?? []).flatMap((feature: any) => {
		const point = feature.geometry?.coordinates;
		const access = feature.properties?.coordinates?.routable_points?.[0];
		const coords = access ? [access.longitude, access.latitude] : point;
		if (!Array.isArray(coords) || !validCoordinates(coords as Coordinates) || !feature.properties?.name) return [];
		return [{ id: feature.properties.mapbox_id ?? feature.properties.name, name: feature.properties.name, address: feature.properties.full_address ?? feature.properties.place_formatted ?? "", coords, buildingCoords: Array.isArray(point) && validCoordinates(point as Coordinates) ? point : coords, kind: "Along route", source: "mapbox" as const, details: placeDetails(feature.properties) }];
	});
}

