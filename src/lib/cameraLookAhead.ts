/** Zoom and tilt for the follow camera: wider and flatter-ahead at speed, closer for turns. */
export interface LookAheadInput { speedMs: number; distanceToNextM: number | null; /** False for "continue straight" type steps, which should not trigger a zoom. */ significantTurn?: boolean }
export interface LookAheadCamera { zoom: number; pitch: number }

// Speed (m/s) → zoom. 50 km/h matches the app's normal follow zoom of 16.5.
const ZOOM_BY_SPEED: [number, number][] = [[0, 17.2], [8, 16.9], [14, 16.5], [22, 15.9], [30, 15.3]];
const TURN_ZOOM_BOOST = 0.6;
/** The camera starts closing in this many seconds before a turn (bounded below), so slow streets do not pulse. */
const TURN_LEAD_SECONDS = 9;
const TURN_RANGE_MIN_M = 90;
const TURN_RANGE_MAX_M = 300;
const TURN_FULL_AT_M = 40;
const MAX_ZOOM = 17.6;
const BASE_PITCH = 45;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function interpolate(points: [number, number][], x: number): number {
	if (x <= points[0][0]) return points[0][1];
	for (let i = 1; i < points.length; i++) {
		const [x1, y1] = points[i];
		if (x <= x1) { const [x0, y0] = points[i - 1]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
	}
	return points[points.length - 1][1];
}

/** 0 when the next manoeuvre is far away, rising to 1 as you reach it. */
export function turnProximity(distanceToNextM: number | null, speedMs = 14, significant = true): number {
	if (!significant || distanceToNextM == null || !Number.isFinite(distanceToNextM)) return 0;
	const speed = Number.isFinite(speedMs) ? Math.max(0, speedMs) : 0;
	const range = clamp(speed * TURN_LEAD_SECONDS, TURN_RANGE_MIN_M, TURN_RANGE_MAX_M);
	return clamp((range - distanceToNextM) / (range - TURN_FULL_AT_M), 0, 1);
}

/** Steps that are real turns, as opposed to "continue" or a name change on a straight road. */
export function isSignificantTurn(step: { type: number | string; modifier?: string } | undefined): boolean {
	if (!step) return false;
	if (typeof step.type === "number") return true;
	if (["continue", "new name", "depart", "notification"].includes(step.type)) return false;
	return step.modifier !== "straight" || /roundabout|rotary|ramp|fork|merge/.test(step.type);
}

// At the normal follow zoom the car was about three road-widths wide, hiding junctions.
const PUCK_BASE_SCALE = 3.3;
const PUCK_REFERENCE_ZOOM = 16.5;
// Beyond these limits the car stops compensating, so it cannot become absurd at extreme zooms. Zoomed in past about 18.7
// it becomes a real object about 12 m long (the model is 16.3 units, × 0.74), a little bigger than a car so it still
// reads, and grows with the buildings around it instead of staying a fixed size on screen like a toy.
const PUCK_MAX_ZOOM_OUT = 5;
const PUCK_MAX_ZOOM_IN = 2.16;

/**
 * World-size multiplier for the car model that keeps it the same size on screen at any zoom.
 * Map content doubles in size with each zoom level, so the car's real-world size is halved for
 * every level the camera zooms in (and doubled when it zooms out).
 */
export function puckModelScale(zoom: number): number {
	return PUCK_BASE_SCALE * Math.pow(2, clamp(PUCK_REFERENCE_ZOOM - zoom, -PUCK_MAX_ZOOM_IN, PUCK_MAX_ZOOM_OUT));
}

export function lookAheadCamera({ speedMs, distanceToNextM, significantTurn = true }: LookAheadInput): LookAheadCamera {
	const speed = Number.isFinite(speedMs) ? Math.max(0, speedMs) : 0;
	const turn = turnProximity(distanceToNextM, speed, significantTurn);
	return {
		zoom: Math.min(MAX_ZOOM, interpolate(ZOOM_BY_SPEED, speed) + TURN_ZOOM_BOOST * turn),
		// Tilt further at speed to see more road ahead; flatten for junctions so the turn is clear.
		pitch: BASE_PITCH + clamp((speed - 14) / 12, 0, 1) * 7 - turn * 5,
	};
}

/** Frame-rate independent exponential smoothing, so zoom changes glide instead of jumping. */
export function smoothToward(current: number, target: number, dtMs: number, tauMs: number): number {
	if (!Number.isFinite(current)) return target;
	const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
	return current + (target - current) * alpha;
}
