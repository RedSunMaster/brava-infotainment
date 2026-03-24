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
): Promise<NormalizedRoute> {
	const data = await valhallaPost("/route", {
		locations: [
			{ lon: origin[0], lat: origin[1] },
			{ lon: dest[0], lat: dest[1] },
		],
		costing: "auto",
		directions_options: { units: "kilometres" },
	});

	const leg = data.trip.legs[0];
	const coords: [number, number][] = polyline
		.decode(leg.shape, 6)
		.map(([lat, lon]: [number, number]) => [lon, lat]);

	return {
		coords,
		maneuvers: leg.maneuvers.map(
			(m: any): NormalizedManeuver => ({
				instruction: m.instruction,
				length: m.length,
				time: m.time,
				begin_shape_index: m.begin_shape_index,
				type: m.type,
			}),
		),
	};
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
