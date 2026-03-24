import * as https from "https";
import polyline from "@mapbox/polyline";
import { MAPBOX_TOKEN } from "../constants";
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
): Promise<NormalizedRoute> {
	const coords = `${origin[0]},${origin[1]};${dest[0]},${dest[1]}`;
	const url =
		`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
		`?steps=true&geometries=polyline6&overview=full&access_token=${process.env.MAPBOX_TOKEN}`;

	const data = await httpsGet(url);
	const leg = data.routes[0].legs[0];

	// Build unified coords + maneuvers by concatenating each step's geometry
	let allCoords: [number, number][] = [];
	const maneuvers: NormalizedRoute["maneuvers"] = [];

	for (const step of leg.steps) {
		const stepCoords: [number, number][] = polyline
			.decode(step.geometry, 6)
			.map(([lat, lon]: [number, number]) => [lon, lat]);

		const beginIdx = allCoords.length;
		// Skip first point on subsequent steps to avoid duplicates
		allCoords =
			allCoords.length > 0
				? [...allCoords, ...stepCoords.slice(1)]
				: [...stepCoords];

		maneuvers.push({
			instruction: step.maneuver.instruction,
			length: step.distance / 1000,
			time: step.duration,
			begin_shape_index: beginIdx,
			type: step.maneuver.type, // ✅ "turn", "depart", "arrive" etc.
			modifier: step.maneuver.modifier, // ✅ "left", "slight right" etc.
		});
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
