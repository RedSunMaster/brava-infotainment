export type Point = [number, number];

const EARTH_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function metresBetween(a: Point, b: Point): number {
	const dLat = toRad(b[1] - a[1]);
	const dLon = toRad(b[0] - a[0]);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
	return EARTH_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingBetween(a: Point, b: Point): number {
	const dLon = toRad(b[0] - a[0]);
	const y = Math.sin(dLon) * Math.cos(toRad(b[1]));
	const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLon);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Distance along the route, in metres, at every vertex. */
export function cumulativeMeters(coords: Point[]): number[] {
	const out = new Array<number>(coords.length);
	let total = 0;
	for (let i = 0; i < coords.length; i++) {
		if (i) total += metresBetween(coords[i - 1], coords[i]);
		out[i] = total;
	}
	return out;
}

/** The segment (vertex index) containing `distance`, by binary search. */
export function segmentAtDistance(cumulative: number[], distance: number): number {
	const last = cumulative.length - 2;
	if (last < 0) return 0;
	if (distance <= 0) return 0;
	if (distance >= cumulative[last + 1]) return last;
	let low = 0;
	let high = last;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (cumulative[mid] <= distance) low = mid;
		else high = mid - 1;
	}
	return low;
}

export interface RoutePoint { pos: Point; bearing: number; segment: number }

/** Position and heading `distance` metres along the route (clamped to its ends). */
export function pointAtDistance(coords: Point[], cumulative: number[], distance: number): RoutePoint {
	if (coords.length < 2) return { pos: coords[0] ?? [0, 0], bearing: 0, segment: 0 };
	const segment = segmentAtDistance(cumulative, distance);
	const a = coords[segment];
	const b = coords[segment + 1];
	const length = cumulative[segment + 1] - cumulative[segment];
	const t = length > 0 ? Math.min(1, Math.max(0, (distance - cumulative[segment]) / length)) : 0;
	return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearingBetween(a, b), segment };
}

export interface Located {
	/** The segment the position projects onto (it runs from this vertex to the next). */
	segment: number;
	/** How far along that segment, 0 to 1. */
	t: number;
	/** Metres along the whole route. */
	along: number;
	/** How far the position is from the route, in metres. */
	offsetM: number;
}

/** A hit within this many metres of the route is trusted without searching the whole route. */
const ACCEPT_M = 60;
const WINDOW_BACK = 8;
const WINDOW_AHEAD = 500;

function project(coords: Point[], cumulative: number[], pos: Point, segment: number): Located {
	const a = coords[segment];
	const b = coords[segment + 1];
	const scale = Math.cos(toRad(pos[1]));
	const dx = (b[0] - a[0]) * scale;
	const dy = b[1] - a[1];
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (((pos[0] - a[0]) * scale) * dx + (pos[1] - a[1]) * dy) / lengthSquared));
	const projected: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	return { segment, t, along: cumulative[segment] + (cumulative[segment + 1] - cumulative[segment]) * t, offsetM: metresBetween(pos, projected) };
}

function bestIn(coords: Point[], cumulative: number[], pos: Point, from: number, to: number): Located | null {
	let best: Located | null = null;
	for (let i = from; i <= to; i++) {
		const hit = project(coords, cumulative, pos, i);
		if (!best || hit.offsetM < best.offsetM) best = hit;
	}
	return best;
}

/**
 * Where a position sits on the route. It looks near `hintSegment` first, so a route that
 * passes the same spot twice (a loop, or out and back) cannot make the position jump to the
 * other pass; only when nothing nearby is close does it search the whole route.
 */
export function locateOnRoute(coords: Point[], cumulative: number[], pos: Point, hintSegment = 0): Located {
	const last = coords.length - 2;
	if (last < 0) return { segment: 0, t: 0, along: 0, offsetM: coords[0] ? metresBetween(pos, coords[0]) : Infinity };
	const hint = Math.min(Math.max(0, hintSegment), last);
	const near = bestIn(coords, cumulative, pos, Math.max(0, hint - WINDOW_BACK), Math.min(last, hint + WINDOW_AHEAD));
	if (near && near.offsetM <= ACCEPT_M) return near;
	const all = bestIn(coords, cumulative, pos, 0, last)!;
	return near && near.offsetM <= all.offsetM ? near : all;
}

/** Index of the route vertex nearest to the position, searched near the last known place first. */
export function nearestVertex(coords: Point[], cumulative: number[], pos: Point, hintSegment = 0): number {
	const located = locateOnRoute(coords, cumulative, pos, hintSegment);
	return located.t >= 0.5 ? Math.min(coords.length - 1, located.segment + 1) : located.segment;
}

/** Caches the cumulative distances for the most recent route, so callers need not recompute them. */
export function routeCache() {
	let key: Point[] | null = null;
	let value: number[] = [];
	return (coords: Point[]): number[] => {
		if (key !== coords) { key = coords; value = cumulativeMeters(coords); }
		return value;
	};
}

/** The puck leaves the route line (and follows the GPS position and heading) beyond this many metres from it... */
export const OFF_TRACK_ENTER_M = 30;
/** ...and rejoins it once back within this many; the gap stops a car running alongside the line flickering between the two. */
export const OFF_TRACK_EXIT_M = 15;

/** Whether the car is off the route line, given whether it was and how far from the line the latest fix is. */
export function nextOffTrack(wasOff: boolean, offsetM: number): boolean {
	return wasOff ? offsetM > OFF_TRACK_EXIT_M : offsetM > OFF_TRACK_ENTER_M;
}
