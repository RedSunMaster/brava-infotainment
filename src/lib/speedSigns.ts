/** Speed limit from the route's per-segment annotations, as the Directions API reports it. */
export interface RouteSpeedLimit { speed?: number; unit?: string; unknown?: boolean; none?: boolean }
export type SpeedUnit = "km/h" | "mph";
export type LimitValue = { kind: "limit"; speed: number; unit: SpeedUnit } | { kind: "none" } | null;

/** Show the limit sign red only when the displayed speed is clearly over, not at the limit itself. */
export const OVER_LIMIT_TOLERANCE = 2;

const MS_TO_KMH = 3.6;
const MS_TO_MPH = 2.23694;

/**
 * The limit for the road segment at `index`. Only trusted while the car is actually on the route
 * (`onRoute`); a wrong sign is worse than no sign.
 */
export function limitAt(limits: (RouteSpeedLimit | null)[] | undefined, index: number, onRoute: boolean): LimitValue {
	if (!onRoute || !limits?.length) return null;
	const entry = limits[Math.max(0, Math.min(index, limits.length - 1))];
	if (!entry || entry.unknown) return null;
	if (entry.none) return { kind: "none" };
	if (typeof entry.speed !== "number" || !Number.isFinite(entry.speed) || entry.speed <= 0) return null;
	return { kind: "limit", speed: entry.speed, unit: entry.unit === "mph" ? "mph" : "km/h" };
}

export interface SpeedSignState {
	/** Current speed in the same unit as the limit (km/h unless the road is signed in mph). */
	speed: number;
	unit: SpeedUnit;
	limit: LimitValue;
	over: boolean;
}

export function speedSignState(speedMs: number, limit: LimitValue): SpeedSignState {
	const unit: SpeedUnit = limit?.kind === "limit" ? limit.unit : "km/h";
	const safe = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 0;
	const speed = Math.round(safe * (unit === "mph" ? MS_TO_MPH : MS_TO_KMH));
	const over = limit?.kind === "limit" && speed > limit.speed + OVER_LIMIT_TOLERANCE;
	return { speed, unit, limit, over };
}
