import * as http from "http";
import polyline from "@mapbox/polyline";
import type { NormalizedManeuver, NormalizedRoute } from "./routing";

export function valhallaPost(path: string, body: object): Promise<any> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			{
				hostname: "localhost",
				port: 8002,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(data),
				},
			},
			(res) => {
				let raw = "";
				res.on("data", (c) => (raw += c));
				res.on("end", () => resolve(JSON.parse(raw)));
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

export async function getValhallaRoute(
	origin: [number, number],
	dest: [number, number],
	stops: [number, number][] = [],
): Promise<NormalizedRoute> {
	const data = await valhallaPost("/route", {
		locations: [origin, ...stops, dest].map(([lon, lat]) => ({ lon, lat })),
		costing: "auto",
		directions_options: { units: "kilometres" },
	});

	let coords: [number, number][] = [];
	const maneuvers: NormalizedManeuver[] = [];

	for (const leg of data.trip.legs) {
		const legStartIndex = coords.length;
		const legCoords: [number, number][] = polyline
			.decode(leg.shape, 6)
			.map(([lat, lon]: [number, number]) => [lon, lat]);
		coords =
			coords.length > 0 ? [...coords, ...legCoords.slice(1)] : [...legCoords];

		maneuvers.push(
			...leg.maneuvers.map(
				(m: any): NormalizedManeuver => ({
				instruction: m.instruction,
				length: m.length,
				time: m.time,
				begin_shape_index: legStartIndex + m.begin_shape_index,
				type: m.type,
			}),
			),
		);
	}

	return { coords, maneuvers };
}

export async function snapToRoadValhalla(
	trail: [number, number][],
): Promise<[number, number]> {
	try {
		const data = await valhallaPost("/trace_attributes", {
			shape: trail.map((p) => ({ lat: p[1], lon: p[0] })),
			costing: "auto",
			shape_match: "map_snap",
			filters: { attributes: ["matched.point"], action: "include" },
		});
		const last = (data.matched_points ?? []).at(-1);
		return last?.type === "matched"
			? [last.lon, last.lat]
			: trail[trail.length - 1]!;
	} catch {
		return trail[trail.length - 1]!;
	}
}
