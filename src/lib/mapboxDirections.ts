import * as https from "https";
import polyline from "@mapbox/polyline";
import type { NormalizedRoute, RouteOptions } from "./routing";

function httpsGet(url: string): Promise<any> {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let raw = "";
				res.on("data", (c: string) => (raw += c));
				res.on("end", () => {
					try {
						if (res.statusCode !== 200)
							throw new Error("Routing is unavailable. Try again.");
						resolve(JSON.parse(raw));
					} catch (error) {
						reject(error);
					}
				});
			})
			.on("error", reject)
			.setTimeout(10000, function () {
				this.destroy(new Error("Route calculation timed out. Try again."));
			});
	});
}

/**
 * Mapbox gives a guidance-view as `imageBaseURL` (no size or extension); the picture itself
 * is that address plus a density, a format and the access token.
 */
export function junctionImageUrl(component: { imageUrl?: unknown; imageBaseURL?: unknown }, token = process.env.MAPBOX_TOKEN): string | null {
	if (typeof component.imageUrl === "string" && /^https:\/\//.test(component.imageUrl)) return component.imageUrl;
	if (typeof component.imageBaseURL === "string" && /^https:\/\//.test(component.imageBaseURL) && token) return `${component.imageBaseURL}@2x.png?access_token=${encodeURIComponent(token)}`;
	return null;
}

export async function getMapboxRoute(
	origin: [number, number],
	dest: [number, number],
	stops: [number, number][] = [],
	target?: [number, number],
	options?: RouteOptions,
): Promise<NormalizedRoute> {
	return (await getMapboxRoutes(origin, dest, stops, false, target, options))[0];
}

export async function getMapboxRoutes(origin: [number, number], dest: [number, number], stops: [number, number][] = [], alternatives = true, target?: [number, number], options?: RouteOptions): Promise<NormalizedRoute[]> {
	const waypoints = [origin, ...stops, dest];
	const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";");
	const url =
		`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}` +
		`?steps=true&geometries=polyline6&overview=full&annotations=congestion,maxspeed,closure&banner_instructions=true&alternatives=${alternatives}` +
		(options?.avoid?.length ? `&exclude=${options.avoid.join(",")}` : "") +
		(Number.isFinite(options?.speedMs) && options!.speedMs! > 1 ? `&avoid_maneuver_radius=${Math.min(250, Math.max(30, Math.round(options!.speedMs! * 8)))}` : "") +
		(target ? `&waypoint_targets=${";".repeat(stops.length + 1)}${target.join(",")}` : "") +
		`&access_token=${process.env.MAPBOX_TOKEN}`;

	const data = await httpsGet(url);
	if (!data.routes?.length)
		throw new Error("No drivable route was found for this location.");
	return data.routes.map((route: any) => {
	let allCoords: [number, number][] = [];
	const maneuvers: NormalizedRoute["maneuvers"] = [];
	const congestion: string[] = [];
	const speedLimits: NonNullable<NormalizedRoute["speedLimits"]> = [];
	const incidents: NonNullable<NormalizedRoute["incidents"]> = [];
	const closures: NonNullable<NormalizedRoute["closures"]> = [];

	for (const leg of route.legs) {
		const legStart = Math.max(0, allCoords.length - 1);
		for (const step of leg.steps) {
			const stepCoords: [number, number][] = polyline
				.decode(step.geometry, 6)
				.map(([lat, lon]: [number, number]) => [lon, lat]);

			const beginIdx = Math.max(0, allCoords.length - 1);
			allCoords =
				allCoords.length > 0
					? [...allCoords, ...stepCoords.slice(1)]
					: [...stepCoords];

			maneuvers.push({
				instruction: step.maneuver.instruction,
				length: step.distance / 1000,
				time: step.duration,
				begin_shape_index: beginIdx,
				type: step.maneuver.type,
				modifier: step.maneuver.modifier,
				lanes: step.intersections?.[0]?.lanes,
				junctions: (step.bannerInstructions ?? []).flatMap((banner: any) => {
					const components = [banner.view, banner.quaternary].flatMap(view => view?.components ?? []);
					return components.filter(component => component.type === "guidance-view" && Number.isFinite(banner.distanceAlongGeometry)).flatMap(component => { const url = junctionImageUrl(component); return url ? [{ distance: banner.distanceAlongGeometry, url }] : []; });
				}),
			});
		}
		const segmentCount = allCoords.length - 1 - legStart;
		for (let i = 0; i < segmentCount; i++) {
			congestion.push(leg.annotation?.congestion?.[i] ?? "unknown");
			speedLimits.push(leg.annotation?.maxspeed?.[i] ?? null);
		}
		for (const incident of leg.incidents ?? []) {
			if (Number.isInteger(incident.geometry_index_start) && incident.geometry_index_start >= 0 && incident.geometry_index_start <= segmentCount)
				incidents.push({ id: String(incident.id), description: incident.description || incident.type || "Traffic incident", index: legStart + incident.geometry_index_start });
		}
		for (const closure of leg.closures ?? []) {
			if (Number.isInteger(closure.geometry_index_start) && Number.isInteger(closure.geometry_index_end) && closure.geometry_index_start >= 0 && closure.geometry_index_end <= segmentCount && closure.geometry_index_end > closure.geometry_index_start)
				closures.push({ start: legStart + closure.geometry_index_start, end: legStart + closure.geometry_index_end });
		}
	}

	const trafficDelaySeconds = Number.isFinite(route.duration) && Number.isFinite(route.duration_typical) ? Math.max(0, route.duration - route.duration_typical) : undefined;
	const legSeconds: number[] = route.legs.map((leg: any) => leg.duration).filter((value: unknown) => Number.isFinite(value));
		return { coords: allCoords, maneuvers, congestion, speedLimits, incidents, closures, trafficDelaySeconds, legSeconds: legSeconds.length === route.legs.length ? legSeconds : undefined };
	});
}

export async function snapToRoadMapbox(
	trail: [number, number][],
): Promise<[number, number]> {
	try {
		const coordStr = trail.map((p) => `${p[0]},${p[1]}`).join(";");
		const url =
			`https://api.mapbox.com/matching/v5/mapbox/driving/${coordStr}` +
			`?geometries=polyline6&access_token=${process.env.MAPBOX_TOKEN}`;

		const data = await httpsGet(url);
		const matched = data.matchings?.[0];
		if (!matched) return trail[trail.length - 1]!;

		const pts: [number, number][] = polyline
			.decode(matched.geometry, 6)
			.map(([lat, lon]: [number, number]) => [lon, lat]);

		return pts[pts.length - 1] ?? trail[trail.length - 1]!;
	} catch {
		return trail[trail.length - 1]!;
	}
}
