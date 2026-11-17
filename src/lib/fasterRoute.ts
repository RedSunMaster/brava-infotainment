import type { NormalizedManeuver, NormalizedRoute } from "./routing";

type Coordinates = [number, number];

/** Offer a different route only when it saves real time, not a rounding error. */
export const MIN_SAVING_SECONDS = 180;
const MIN_SAVING_FRACTION = 0.08;
/** A candidate counts as a different road only if this much of it is away from the current route. */
const DIFFERENT_FRACTION = 0.15;
const NEAR_METRES = 60;

export function routeSeconds(route: Pick<NormalizedRoute, "legSeconds" | "maneuvers">): number {
	return route.legSeconds?.length ? route.legSeconds.reduce((sum, value) => sum + value, 0) : route.maneuvers.reduce((sum, step) => sum + (step.time ?? 0), 0);
}

/** Time left on the current route: to the next manoeuvre, then every step after it. */
export function remainingSeconds(maneuvers: NormalizedManeuver[], currentStep: number, timeToNextS: number): number {
	const toNext = Number.isFinite(timeToNextS) ? Math.max(0, timeToNextS) : 0;
	return toNext + maneuvers.slice(currentStep + 1).reduce((sum, step) => sum + (step.time ?? 0), 0);
}

function distanceToSegmentMetres(point: Coordinates, a: Coordinates, b: Coordinates): number {
	const scale = Math.cos((point[1] * Math.PI) / 180);
	const metres = (c: Coordinates): [number, number] => [(c[0] - point[0]) * 111320 * scale, (c[1] - point[1]) * 110540];
	const [ax, ay] = metres(a), [bx, by] = metres(b);
	const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
	return Math.hypot(ax + dx * t, ay + dy * t);
}

/** Fraction (0–1) of the candidate that lies away from the current route. */
export function routeDifference(candidate: Coordinates[], current: Coordinates[], samples = 80): number {
	if (candidate.length < 2 || current.length < 2) return 1;
	const stride = Math.max(1, Math.floor(candidate.length / samples));
	let away = 0, total = 0;
	for (let i = 0; i < candidate.length; i += stride) {
		total++;
		let nearest = Infinity;
		for (let j = 0; j < current.length - 1 && nearest >= NEAR_METRES; j++) nearest = Math.min(nearest, distanceToSegmentMetres(candidate[i], current[j], current[j + 1]));
		if (nearest >= NEAR_METRES) away++;
	}
	return away / total;
}

export interface FasterRoute { route: NormalizedRoute; savedSeconds: number; key: string }

/** Stable id for a route so a dismissed suggestion is not offered again. */
export function routeKey(route: Pick<NormalizedRoute, "coords">): string {
	const { coords } = route;
	const at = (index: number) => coords[Math.min(coords.length - 1, Math.max(0, index))]?.map(value => value.toFixed(4)).join(",");
	return [coords.length, at(Math.floor(coords.length / 3)), at(Math.floor(coords.length / 2)), at(Math.floor((coords.length * 2) / 3))].join("|");
}

export function findFasterRoute(remaining: number, current: Coordinates[], candidates: NormalizedRoute[]): FasterRoute | null {
	let best: FasterRoute | null = null;
	for (const route of candidates) {
		const savedSeconds = remaining - routeSeconds(route);
		if (savedSeconds < Math.max(MIN_SAVING_SECONDS, remaining * MIN_SAVING_FRACTION)) continue;
		if (routeDifference(route.coords, current) < DIFFERENT_FRACTION) continue;
		if (!best || savedSeconds > best.savedSeconds) best = { route, savedSeconds, key: routeKey(route) };
	}
	return best;
}

export function describeSaving(seconds: number): string {
	return `${Math.max(1, Math.round(seconds / 60))} min quicker`;
}
