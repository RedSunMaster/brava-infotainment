import { locateOnRoute, metresBetween, type Point } from "./routeLocate";

export type HazardKind = "speed_camera" | "red_light_camera" | "level_crossing" | "hazard";
export interface RoadHazard { id: string; kind: HazardKind; coords: Point; /** Posted limit for a speed camera, when mapped. */ maxspeed?: string; label: string }
export interface RouteHazard extends RoadHazard { /** Route vertex nearest the hazard. */ index: number }

export const HAZARD_LABELS: Record<HazardKind, string> = { speed_camera: "Speed camera", red_light_camera: "Red light camera", level_crossing: "Railway crossing", hazard: "Road hazard" };

/** A mapped camera or hazard counts as being on the route within this many metres of it. */
const ON_ROUTE_M = 35;
const CHUNK_M = 20_000;
const MAX_CHUNKS = 8;
const PAD_DEG = 0.0007;
const OVERPASS = "https://overpass-api.de/api/interpreter";

interface OverpassElement { type?: string; id?: number; lat?: number; lon?: number; tags?: Record<string, string> }

/** Overpass query for the cameras and hazards inside each bounding box (south, west, north, east). */
export function buildOverpassQuery(boxes: [number, number, number, number][]): string {
	const parts = boxes.map(([s, w, n, e]) => {
		const bbox = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
		return `node["highway"="speed_camera"](${bbox});node["enforcement"~"^(maxspeed|traffic_signals)$"](${bbox});node["railway"="level_crossing"](${bbox});node["hazard"](${bbox});`;
	});
	return `[out:json][timeout:15];(${parts.join("")});out body;`;
}

/** Bounding boxes that follow the route in ~20 km pieces, so a long drive does not ask for a huge empty rectangle. */
export function routeBoxes(coords: Point[], meters: number[]): [number, number, number, number][] {
	if (coords.length < 2) return [];
	const boxes: [number, number, number, number][] = [];
	let start = 0;
	for (let i = 1; i < coords.length && boxes.length < MAX_CHUNKS; i++) {
		if (meters[i] - meters[start] < CHUNK_M && i < coords.length - 1) continue;
		let s = 90, w = 180, n = -90, e = -180;
		for (let j = start; j <= i; j++) { s = Math.min(s, coords[j][1]); n = Math.max(n, coords[j][1]); w = Math.min(w, coords[j][0]); e = Math.max(e, coords[j][0]); }
		boxes.push([s - PAD_DEG, w - PAD_DEG, n + PAD_DEG, e + PAD_DEG]);
		start = i;
	}
	return boxes;
}

export function parseOverpass(data: unknown): RoadHazard[] {
	const elements = (data as { elements?: OverpassElement[] } | null)?.elements;
	if (!Array.isArray(elements)) return [];
	const out: RoadHazard[] = [];
	for (const el of elements) {
		if (typeof el?.lat !== "number" || typeof el.lon !== "number" || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
		const tags = el.tags ?? {};
		let kind: HazardKind | null = null;
		if (tags.highway === "speed_camera" || tags.enforcement === "maxspeed") kind = "speed_camera";
		else if (tags.enforcement === "traffic_signals") kind = "red_light_camera";
		else if (tags.railway === "level_crossing") kind = "level_crossing";
		else if (tags.hazard) kind = "hazard";
		if (!kind) continue;
		out.push({ id: `${el.type ?? "node"}${el.id ?? `${el.lat},${el.lon}`}`, kind, coords: [el.lon, el.lat], maxspeed: tags.maxspeed, label: HAZARD_LABELS[kind] });
	}
	return out;
}

/** The hazards that sit on the route itself, in route order, one per spot (mapped cameras are often doubled up). */
export function hazardsOnRoute(hazards: RoadHazard[], coords: Point[], meters: number[]): RouteHazard[] {
	const found: (RouteHazard & { along: number })[] = [];
	for (const hazard of hazards) {
		const hit = locateOnRoute(coords, meters, hazard.coords);
		if (hit.offsetM > ON_ROUTE_M) continue;
		const index = hit.t >= 0.5 ? Math.min(coords.length - 1, hit.segment + 1) : hit.segment;
		if (found.some(other => other.kind === hazard.kind && metresBetween(other.coords, hazard.coords) < 40)) continue;
		found.push({ ...hazard, index, along: hit.along });
	}
	return found.sort((a, b) => a.along - b.along).map(item => ({ id: item.id, kind: item.kind, coords: item.coords, maxspeed: item.maxspeed, label: item.label, index: item.index }));
}

export async function fetchRouteHazards(coords: Point[], meters: number[], signal: AbortSignal): Promise<RouteHazard[]> {
	const boxes = routeBoxes(coords, meters);
	if (!boxes.length) return [];
	const response = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: buildOverpassQuery(boxes) }), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
	if (!response.ok) throw new Error(`Hazard lookup failed (${response.status})`);
	return hazardsOnRoute(parseOverpass(await response.json()), coords, meters);
}
