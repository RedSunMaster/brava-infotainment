/**
 * The idle globe: while nothing is going on the Earth turns slowly in space; the moment the driver uses destinations or the car moves,
 * the camera flies down to where they are, and after it has been parked and untouched for a while it goes back up and turns again.
 */
/** How fast the Earth turns, in degrees of longitude a second. A full turn takes a minute and a half. */
export const SPIN_DEG_PER_S = 4;
/** The camera is rolled this far round the world at a time (one smooth, straight-line move, then the next). */
export const SPIN_STEP_DEG = 60;
/** How fast the clouds drift eastward over the ground, in degrees a second, on top of the turning Earth. */
export const CLOUD_DRIFT_DEG_PER_S = 0.5;
/** Camera height and latitude for the globe. */
export const GLOBE_ZOOM = 1.5;
export const GLOBE_LATITUDE = 15;
/** Parked, with nobody touching anything, for this long and the camera returns to the globe. */
export const IDLE_BEFORE_GLOBE_MS = 5 * 60 * 1000;

/** True when the car has been parked and the screen left alone for at least `idleMs`. `parkedSince` is null while it is not parked. */
export function idleLongEnough(parkedSince: number | null, lastActivity: number, now: number, idleMs = IDLE_BEFORE_GLOBE_MS): boolean {
	return parkedSince !== null && now - Math.max(parkedSince, lastActivity) >= idleMs;
}

/** Keeps a longitude between -180 and 180. */
export const wrapLongitude = (longitude: number): number => ((((longitude + 180) % 360) + 360) % 360) - 180;

/**
 * The longitude equal to `target` that is nearest to `from`, so a flight takes the short way round the world (never more than half a turn),
 * however far the Earth has turned while the camera was circling it.
 */
export const nearestLongitude = (target: number, from: number): number => target + 360 * Math.round((from - target) / 360);

/** Where the camera goes for the next step of the turn: west along the same latitude, so the Earth appears to turn eastward. */
export function nextSpinCentre(longitude: number): [number, number] {
	return [wrapLongitude(longitude - SPIN_STEP_DEG), GLOBE_LATITUDE];
}

/** How long one step of the turn takes, in milliseconds. */
export const SPIN_STEP_MS = (SPIN_STEP_DEG / SPIN_DEG_PER_S) * 1000;

/** The things that make the camera come down to the car instead of staying on the globe. */
export function wantsLocation(state: { driving: boolean; navigating: boolean; destinationPending: boolean; searchOpen: boolean; routing: boolean; choosingBuilding: boolean }): boolean {
	return state.driving || state.navigating || state.destinationPending || state.searchOpen || state.routing || state.choosingBuilding;
}
