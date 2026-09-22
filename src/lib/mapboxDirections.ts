import * as https from "https";
import polyline from "@mapbox/polyline";
import type { NormalizedRoute } from "./routing";

function httpsGet(url: string): Promise<any> {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let raw = "";
				res.on("data", (c: string) => (raw += c));
				res.on("end", () => resolve(JSON.parse(raw)));
			})
			.on("error", reject);
	});
}

export async function getMapboxRoute(
	origin: [number, number],
	dest: [number, number],
	stops: [number, number][] = [],
): Promise<NormalizedRoute> {
	const waypoints = [origin, ...stops, dest];
	const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";");
	const url =
		`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
		`?steps=true&geometries=polyline6&overview=full&access_token=${process.env.MAPBOX_TOKEN}`;

	const data = await httpsGet(url);
	let allCoords: [number, number][] = [];
	const maneuvers: NormalizedRoute["maneuvers"] = [];

	for (const leg of data.routes[0].legs) {
		for (const step of leg.steps) {
			const stepCoords: [number, number][] = polyline
				.decode(step.geometry, 6)
				.map(([lat, lon]: [number, number]) => [lon, lat]);

			const beginIdx = allCoords.length;
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
			});
		}
	}

	return { coords: allCoords, maneuvers };
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
