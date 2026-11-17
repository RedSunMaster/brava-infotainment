export type Point = [number, number];

/** No fix for this long means the signal is lost (a tunnel, a car park), not just a late update. */
export const STALE_MS = 3000;
/** Below this the car is treated as stopped, so a lost signal does not make it drift. */
export const MIN_SPEED_MS = 2;
/** Give up estimating after this long; a guess that old is not a position. */
export const MAX_ESTIMATE_MS = 120_000;

export interface LastFix { pos: Point; time: number; speed: number }

const EARTH_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function metres(a: Point, b: Point): number {
	const dLat = toRad(b[1] - a[1]);
	const dLon = toRad(b[0] - a[0]);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
	return EARTH_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: Point, b: Point): number {
	const dLon = toRad(b[0] - a[0]);
	const y = Math.sin(dLon) * Math.cos(toRad(b[1]));
	const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLon);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Estimate { pos: Point; bearing: number; /** True once the estimate has run out of route. */ atEnd: boolean }

/**
 * Where the car is after driving `distanceM` further along the route from `from`.
 * `from` is first projected onto the nearest part of the route, then the distance is walked forward.
 */
export function advanceAlongRoute(coords: Point[], from: Point, distanceM: number): Estimate | null {
	if (coords.length < 2 || !Number.isFinite(distanceM)) return null;
	const scale = Math.cos(toRad(from[1]));
	let bestSegment = 0;
	let bestT = 0;
	let bestDistance = Infinity;
	for (let i = 0; i < coords.length - 1; i++) {
		const [ax, ay] = coords[i];
		const dx = (coords[i + 1][0] - ax) * scale;
		const dy = coords[i + 1][1] - ay;
		const lengthSquared = dx * dx + dy * dy;
		const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (((from[0] - ax) * scale) * dx + (from[1] - ay) * dy) / lengthSquared));
		const projected: Point = [ax + (coords[i + 1][0] - ax) * t, ay + (coords[i + 1][1] - ay) * t];
		const distance = metres(from, projected);
		if (distance < bestDistance) { bestDistance = distance; bestSegment = i; bestT = t; }
	}
	let remaining = Math.max(0, distanceM);
	let segment = bestSegment;
	let t = bestT;
	for (; segment < coords.length - 1; segment++) {
		const a = coords[segment];
		const b = coords[segment + 1];
		const left = metres(a, b) * (1 - t);
		if (remaining <= left) {
			const length = metres(a, b);
			const along = length === 0 ? 1 : t + remaining / length;
			return { pos: [a[0] + (b[0] - a[0]) * along, a[1] + (b[1] - a[1]) * along], bearing: bearing(a, b), atEnd: false };
		}
		remaining -= left;
		t = 0;
	}
	const last = coords[coords.length - 1];
	return { pos: last, bearing: bearing(coords[coords.length - 2], last), atEnd: true };
}

/**
 * How far the car has probably travelled since the last real fix, or null when it should
 * not be estimated: the signal is fine, the car was stopped, or too long has passed.
 */
export function estimatedDistance(now: number, fix: LastFix | null): number | null {
	if (!fix || !Number.isFinite(fix.speed) || fix.speed < MIN_SPEED_MS) return null;
	const elapsed = now - fix.time;
	if (elapsed < STALE_MS || elapsed > MAX_ESTIMATE_MS) return null;
	return (fix.speed * elapsed) / 1000;
}
