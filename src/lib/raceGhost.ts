import { distanceM, type LngLat } from "./exploration";
import { ROUTE_ENDS_M, sameRoute, tripSeconds, type Trip } from "./drives";

/**
 * Ghost racing. When a drive follows a route you have driven before, your fastest earlier run of it drives along as a ghost
 * on the map, and the dashboard says how far ahead or behind it you are. The ghost is picked from the saved trips by where
 * the drive started and the road it takes (and where it is going, when navigation knows), so there is nothing to set up.
 */

/** The live car further than this from a candidate's road is not following it. */
export const OFF_ROUTE_M = 90;
/** Once the ghost is chosen, being this far from its road ends the race: you took another way. */
export const LOST_M = 300;
/** A route is judged after this much driving (or this much when navigation names the destination). */
export const MATCH_AFTER_M = 500;
export const MATCH_AFTER_KNOWN_M = 150;
/** The destination must be within this of where the candidate ended. */
const DESTINATION_M = 500;
/** The search for the car on a ghost's road looks this far back and forward, in track points. */
const WINDOW_BACK = 4;
const WINDOW_FORWARD = 80;

interface Projection { index: number; along: number; offsetM: number }

/** A ghost's road: the saved track as points with the time and distance at each. */
export class RaceGhost {
	readonly trip: Trip;
	private readonly points: LngLat[] = [];
	private readonly times: number[] = [];
	private readonly cum: number[] = [];
	private hint = 0;
	/** Seconds the ghost took, start to finish. */
	readonly duration: number;
	readonly length: number;

	constructor(trip: Trip) {
		this.trip = trip;
		const track = trip.track ?? [];
		for (let i = 0; i + 2 < track.length; i += 3) {
			const point: LngLat = [track[i], track[i + 1]];
			this.cum.push(this.points.length ? this.cum[this.cum.length - 1] + distanceM(this.points[this.points.length - 1], point) : 0);
			this.points.push(point);
			this.times.push(track[i + 2]);
		}
		this.duration = this.times.length ? this.times[this.times.length - 1] : 0;
		this.length = this.cum.length ? this.cum[this.cum.length - 1] : 0;
	}

	get usable(): boolean { return this.points.length >= 2 && this.duration > 0 && this.length > 100; }

	/** Where the ghost is `seconds` after the start (it waits at the end once it has finished). */
	positionAt(seconds: number): LngLat {
		const n = this.points.length;
		if (seconds <= this.times[0]) return this.points[0];
		if (seconds >= this.times[n - 1]) return this.points[n - 1];
		let lo = 0, hi = n - 1;
		while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.times[mid] <= seconds) lo = mid; else hi = mid; }
		const span = this.times[hi] - this.times[lo];
		const f = span > 0 ? (seconds - this.times[lo]) / span : 0;
		return [this.points[lo][0] + (this.points[hi][0] - this.points[lo][0]) * f, this.points[lo][1] + (this.points[hi][1] - this.points[lo][1]) * f];
	}

	/** When the ghost was `along` metres into the route. */
	timeAt(along: number): number {
		const n = this.cum.length;
		if (along <= 0) return this.times[0];
		if (along >= this.cum[n - 1]) return this.times[n - 1];
		let lo = 0, hi = n - 1;
		while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= along) lo = mid; else hi = mid; }
		const span = this.cum[hi] - this.cum[lo];
		const f = span > 0 ? (along - this.cum[lo]) / span : 0;
		return this.times[lo] + (this.times[hi] - this.times[lo]) * f;
	}

	/** Where the car is on the ghost's road. Searches near where it was last (the car only moves along), or all of it at first. */
	project(pos: LngLat, wide = false): Projection {
		const n = this.points.length;
		const from = wide ? 0 : Math.max(0, this.hint - WINDOW_BACK);
		const to = wide ? n - 2 : Math.min(n - 2, this.hint + WINDOW_FORWARD);
		const mPerLng = 111_320 * Math.cos((pos[1] * Math.PI) / 180);
		let best: Projection = { index: this.hint, along: this.cum[this.hint] ?? 0, offsetM: Infinity };
		for (let i = from; i <= to; i++) {
			const ax = (this.points[i][0] - pos[0]) * mPerLng, ay = (this.points[i][1] - pos[1]) * 110_540;
			const bx = (this.points[i + 1][0] - pos[0]) * mPerLng, by = (this.points[i + 1][1] - pos[1]) * 110_540;
			const dx = bx - ax, dy = by - ay;
			const len2 = dx * dx + dy * dy;
			const f = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
			const offset = Math.hypot(ax + dx * f, ay + dy * f);
			if (offset < best.offsetM) best = { index: i, along: this.cum[i] + (this.cum[i + 1] - this.cum[i]) * f, offsetM: offset };
		}
		return best;
	}

	/** Moves the search window on once a projection is accepted. */
	accept(projection: Projection): void { this.hint = projection.index; }

	/**
	 * How the car stands against the ghost: seconds behind (+) or ahead (−) of where the ghost was at this point on the road,
	 * `elapsed` seconds into the drive. Null if the car is not on the ghost's road.
	 */
	compare(pos: LngLat, elapsed: number): { deltaS: number; along: number; offsetM: number } | null {
		const projection = this.project(pos);
		if (projection.offsetM > LOST_M) return null;
		this.accept(projection);
		return { deltaS: elapsed - this.timeAt(projection.along), along: projection.along, offsetM: projection.offsetM };
	}

	/** The car has reached the end of the ghost's road. */
	finished(pos: LngLat): boolean { return distanceM(pos, this.points[this.points.length - 1]) <= ROUTE_ENDS_M; }
}

/**
 * Narrows the earlier trips that started where this one did down to the ones the drive is following, and then picks the
 * fastest. Feed it each fix until it gives a ghost (or runs out of candidates).
 */
export class RaceMatcher {
	private candidates: RaceGhost[];

	constructor(trips: readonly Trip[], origin: LngLat) {
		this.candidates = trips
			.filter(trip => trip.track && distanceM(trip.from, origin) <= ROUTE_ENDS_M)
			.map(trip => new RaceGhost(trip))
			.filter(ghost => ghost.usable);
	}

	get any(): boolean { return this.candidates.length > 0; }

	/** The ghost to race once the route is clear, or null while it is not (check `any` for whether it can still come). */
	update(pos: LngLat, travelledM: number, destination: LngLat | null): RaceGhost | null {
		this.candidates = this.candidates.filter(ghost => {
			const projection = ghost.project(pos, travelledM < 100);
			if (projection.offsetM > OFF_ROUTE_M) return false;
			ghost.accept(projection);
			return !destination || distanceM(ghost.trip.to, destination) <= DESTINATION_M;
		});
		if (travelledM < (destination ? MATCH_AFTER_KNOWN_M : MATCH_AFTER_M) || !this.candidates.length) return null;
		return this.candidates.reduce((best, ghost) => tripSeconds(ghost.trip) < tripSeconds(best.trip) ? ghost : best);
	}
}

/** A time as "1:05" (or "12:05" for a longer one), for deltas and lap times. */
export function clock(seconds: number): string {
	const total = Math.max(0, Math.round(Math.abs(seconds)));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "12 s ahead" / "1:05 behind" / "level". */
export function deltaLabel(deltaS: number): string {
	if (Math.abs(deltaS) < 1) return "Level";
	const text = Math.abs(deltaS) < 60 ? `${Math.round(Math.abs(deltaS))} s` : clock(deltaS);
	return `${text} ${deltaS < 0 ? "ahead" : "behind"}`;
}

export interface RouteRecord {
	/** The fastest run of this route. */
	best: Trip;
	runs: number;
	wins: number;
}

/** Every route driven more than once, with its fastest run, how often it has been driven, and how often a ghost was beaten. */
export function routeRecords(trips: readonly Trip[]): RouteRecord[] {
	const groups: Trip[][] = [];
	for (const trip of trips) {
		const group = groups.find(list => sameRoute(list[0], trip));
		if (group) group.push(trip); else groups.push([trip]);
	}
	return groups.filter(group => group.length > 1).map(group => ({
		best: group.reduce((best, trip) => tripSeconds(trip) < tripSeconds(best) ? trip : best),
		runs: group.length,
		wins: group.filter(trip => trip.race && trip.race.deltaS < 0).length,
	})).sort((a, b) => b.runs - a.runs);
}
