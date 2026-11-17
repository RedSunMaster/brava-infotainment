import { bearingBetween, cumulativeMeters, metresBetween, pointAtDistance, segmentAtDistance, type Point } from "./routeLocate";

/** The parts of a route the simulated driver needs. */
export interface SimRoute {
	coords: Point[];
	speedLimits?: ({ speed?: number; unit?: string; unknown?: boolean; none?: boolean } | null)[];
	congestion?: string[];
	maneuvers?: { begin_shape_index: number; type: number | string }[];
}

/** Comfortable acceleration and braking, m/s². */
export const ACCEL = 1.8;
export const DECEL = 2.4;
/** Sideways acceleration the driver accepts in a bend, m/s². */
export const LATERAL = 2.2;
/** Limit assumed where the route does not say (urban default, 50 km/h). */
export const DEFAULT_LIMIT_MS = 50 / 3.6;
/** "No limit" roads are driven at the open-road limit. */
export const OPEN_ROAD_MS = 100 / 3.6;
/** Slowest the driver goes through a tight bend, and the speed through a roundabout entry. */
export const MIN_BEND_MS = 3;
export const ROUNDABOUT_MS = 7;
export const WAYPOINT_MS = 2;
/** The car keeps rolling at least this fast until it reaches the end, so it never stalls at a speed of zero. */
export const CRAWL_MS = 1;

const CONGESTION_FACTOR: Record<string, number> = { low: 1, moderate: 0.85, heavy: 0.6, severe: 0.35 };

export interface Profile {
	coords: Point[];
	cumulative: number[];
	/** Speed to be doing at each vertex, m/s, already limited by braking and acceleration. */
	speeds: number[];
	total: number;
}

function limitToMs(limit: NonNullable<SimRoute["speedLimits"]>[number], fallback: number): number {
	if (!limit || limit.unknown) return fallback;
	if (limit.none) return OPEN_ROAD_MS;
	if (typeof limit.speed !== "number" || !Number.isFinite(limit.speed) || limit.speed <= 0) return fallback;
	return limit.speed * (limit.unit === "mph" ? 0.44704 : 1 / 3.6);
}

function turnAngle(a: Point, b: Point, c: Point): number {
	const delta = Math.abs(bearingBetween(b, c) - bearingBetween(a, b)) % 360;
	return delta > 180 ? 360 - delta : delta;
}

/**
 * Plans how fast the car drives at every point of the route: the posted limit (carried forward
 * where it is unknown), slower in traffic, slower round bends, junction turns and roundabouts,
 * and a stop at the end. Braking is planned back from each slow spot and acceleration forward from
 * the start, so the car eases into slow zones instead of arriving at them too fast.
 */
export function buildProfile(route: SimRoute, startSpeed = 0): Profile {
	const { coords } = route;
	const cumulative = cumulativeMeters(coords);
	const count = coords.length;
	const total = cumulative[count - 1] ?? 0;
	if (count < 2) return { coords, cumulative, speeds: coords.map(() => 0), total };

	// Speed allowed on each segment.
	const segmentSpeed: number[] = [];
	let known = DEFAULT_LIMIT_MS;
	for (let i = 0; i < count - 1; i++) {
		const entry = route.speedLimits?.[i];
		known = limitToMs(entry, known);
		const factor = CONGESTION_FACTOR[route.congestion?.[i] ?? ""] ?? 1;
		segmentSpeed.push(Math.max(2.5, known * factor));
	}

	// Speed allowed at each vertex.
	const speeds = coords.map((_, i) => Math.min(segmentSpeed[i - 1] ?? Infinity, segmentSpeed[i] ?? Infinity));
	for (let i = 1; i < count - 1; i++) {
		const angle = turnAngle(coords[i - 1], coords[i], coords[i + 1]);
		if (angle < 8) continue;
		const tangent = Math.max(4, Math.min(metresBetween(coords[i - 1], coords[i]), metresBetween(coords[i], coords[i + 1]), 40) / 2);
		const radius = tangent / Math.tan((Math.min(angle, 170) * Math.PI) / 360);
		speeds[i] = Math.min(speeds[i], Math.max(MIN_BEND_MS, Math.sqrt(LATERAL * radius)));
	}
	const steps = route.maneuvers ?? [];
	steps.forEach((step, index) => {
		const at = Math.min(count - 1, Math.max(0, step.begin_shape_index));
		if (step.type === "roundabout" || step.type === "rotary") speeds[at] = Math.min(speeds[at], ROUNDABOUT_MS);
		// A stop on the way (not the last arrival) is slowed to a crawl; the real end is a full stop.
		if (step.type === "arrive" && index < steps.length - 1) speeds[at] = Math.min(speeds[at], WAYPOINT_MS);
	});

	// Brake in time for every slow spot, then accelerate only as fast as is comfortable.
	speeds[count - 1] = 0;
	for (let i = count - 2; i >= 0; i--) {
		const gap = cumulative[i + 1] - cumulative[i];
		speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[i + 1] ** 2 + 2 * DECEL * gap));
	}
	speeds[0] = Math.min(speeds[0], Math.max(0, startSpeed));
	for (let i = 1; i < count; i++) {
		const gap = cumulative[i] - cumulative[i - 1];
		speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[i - 1] ** 2 + 2 * ACCEL * gap));
	}
	return { coords, cumulative, speeds, total };
}

export interface SimState { pos: Point; bearing: number; speed: number; segment: number; arrived: boolean }

/** Where the car is, which way it faces and how fast it is going after `distance` metres. */
export function stateAt(profile: Profile, distance: number): SimState {
	const { coords, cumulative, speeds, total } = profile;
	const d = Math.min(Math.max(0, distance), total);
	const point = pointAtDistance(coords, cumulative, d);
	const i = segmentAtDistance(cumulative, d);
	const length = cumulative[i + 1] - cumulative[i];
	const t = length > 0 ? (d - cumulative[i]) / length : 0;
	// Constant acceleration within a segment: speed squared changes in a straight line.
	const squared = (speeds[i] ?? 0) ** 2 + ((speeds[i + 1] ?? 0) ** 2 - (speeds[i] ?? 0) ** 2) * t;
	const arrived = d >= total - 0.5;
	const speed = arrived ? 0 : Math.max(CRAWL_MS, Math.sqrt(Math.max(0, squared)));
	return { pos: point.pos, bearing: point.bearing, speed, segment: point.segment, arrived };
}

/** One step of driving: the new distance travelled and the state there. */
export function drive(profile: Profile, distance: number, seconds: number): { distance: number; state: SimState } {
	const here = stateAt(profile, distance);
	// Use the speed halfway through the step, which keeps hard braking from overshooting a stop.
	const next = Math.min(profile.total, distance + here.speed * seconds);
	const mid = stateAt(profile, (distance + next) / 2);
	// The midpoint may already count as arrived while the car is a hair short, so keep it rolling.
	const moved = Math.min(profile.total, distance + Math.max(mid.speed, here.arrived ? 0 : CRAWL_MS) * seconds);
	return { distance: moved, state: stateAt(profile, moved) };
}
