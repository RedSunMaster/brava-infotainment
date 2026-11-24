import { distanceM, type LngLat } from "./exploration";

/**
 * Trip recording. Every drive, real or simulated, is cut into trips from the stream of position fixes: a trip starts when the
 * car moves, ends after a few minutes standing still (or when the fixes stop), and keeps its distance, time, a thinned track
 * and how smoothly it was driven (hard braking, hard acceleration, hard cornering, and time over the posted limit).
 */

/** One finished trip. Times are epoch milliseconds, speeds metres per second. */
export interface Trip {
	id: string;
	start: number;
	end: number;
	distanceM: number;
	/** Seconds spent actually moving (time stopped at lights or in queues is left out). */
	movingS: number;
	maxSpeed: number;
	from: LngLat;
	to: LngLat;
	/** Smooth-driving score out of 100, or null if the trip was too short to judge. */
	score: number | null;
	hardBrakes: number;
	hardAccels: number;
	hardCorners: number;
	/** Seconds over the posted limit, out of the seconds the limit was known. */
	speedingS: number;
	limitedS: number;
	/** Flat longitude, latitude, seconds since the start. Dropped from old trips to save room (see `trimTrips`). */
	track?: number[];
	/** How this trip went against the ghost it raced: seconds slower (+) or faster (−) than it at the finish. */
	race?: { ghostId: string; deltaS: number };
}

export type DriveEvent = "brake" | "accel" | "corner";

/** A trip starts above this speed, and counts as standing still below STILL_MS. */
export const START_SPEED = 2;
export const STILL_SPEED = 0.6;
/** Standing still for this long ends the trip (the stop itself is trimmed off). */
export const STILL_END_S = 180;
/** No fixes for this long ends the trip. */
export const GAP_END_S = 90;
/** A trip shorter than this is a shuffle, not a trip. */
export const MIN_TRIP_M = 400;
export const MIN_TRIP_MOVING_S = 60;
/** Harder than these (metres per second squared) counts as harsh. */
export const HARD_BRAKE = 3.2;
export const HARD_ACCEL = 3.0;
export const HARD_CORNER = 3.6;
/** Ordinary driving is back below this, so one hard stop is one event, not several. */
const REARM = 1.6;
/** Over the limit by more than the larger of these. */
const OVER_MIN_MS = 1.4;
const OVER_FRACTION = 0.05;
/** A track point is kept every this far, doubling whenever the track gets too long. */
const TRACK_SPACING_M = 20;
const TRACK_MAX_POINTS = 1200;
/** A jump faster than a car can go is a GPS glitch, not distance driven. */
const MAX_PLAUSIBLE_MS = 70;

export const newTripId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const wrap180 = (degrees: number) => ((degrees + 540) % 360) - 180;

export interface ScoreInput { distanceM: number; movingS: number; hardBrakes: number; hardAccels: number; hardCorners: number; speedingS: number; limitedS: number }

/**
 * How smoothly a trip was driven, out of 100, or null if it was too short to judge. Harsh events cost points in
 * proportion to how often they happen per kilometre (so a long trip is not punished for one stop), and time over the limit
 * costs up to a quarter of the score.
 */
export function smoothScore(input: ScoreInput): number | null {
	const km = input.distanceM / 1000;
	if (km < 0.8 || input.movingS < 60) return null;
	const weighted = 4 * input.hardBrakes + 3 * input.hardAccels + 3 * input.hardCorners;
	const events = Math.min(60, (weighted / Math.max(km, 2)) * 12);
	const speeding = input.limitedS >= 60 ? Math.min(25, (input.speedingS / input.limitedS) * 100 * 0.6) : 0;
	return Math.max(0, Math.min(100, Math.round(100 - events - speeding)));
}

export type ScoreBand = "great" | "good" | "fair" | "rough";
export const scoreBand = (score: number): ScoreBand => score >= 90 ? "great" : score >= 75 ? "good" : score >= 55 ? "fair" : "rough";
export const BAND_LABEL: Record<ScoreBand, string> = { great: "Silky", good: "Smooth", fair: "Bumpy", rough: "Rough" };

/** What the dashboard shows during a trip. */
export interface LiveDrive {
	distanceM: number;
	/** Null until the trip is long enough to judge. */
	score: number | null;
	hardBrakes: number;
	hardAccels: number;
	hardCorners: number;
	speeding: boolean;
	startedAt: number;
}

interface Fix { t: number; pos: LngLat; speed: number; bearing: number | null }

interface Current {
	startedAt: number;
	from: LngLat;
	to: LngLat;
	distanceM: number;
	movingS: number;
	maxSpeed: number;
	hardBrakes: number; hardAccels: number; hardCorners: number;
	speedingS: number; limitedS: number;
	track: number[];
	spacing: number;
	sinceTrackM: number;
	/** When the car last stopped, or null while it moves: the trip is trimmed back to here if it ends standing still. */
	stillSince: number | null;
	/** Where it was and how far it had gone at that moment. */
	stillPos: LngLat;
	stillDistanceM: number;
	stillMovingS: number;
	stillTrackLength: number;
	armed: { brake: boolean; accel: boolean; corner: boolean };
}

/**
 * Cuts a stream of fixes into trips. Feed it every fix with `fix()`; a finished trip comes back from the call that ends it
 * (or from `finish()` when the app is closing). The clock is the fix's own time, so it is the same for real and simulated drives.
 */
export class TripRecorder {
	private current: Current | null = null;
	private last: Fix | null = null;

	/** `limitMs` is the posted limit in metres per second where it is known. */
	fix(t: number, pos: LngLat, speed: number, bearing: number | null, limitMs: number | null = null): { event?: DriveEvent; finished?: Trip } {
		const now: Fix = { t, pos, speed: Number.isFinite(speed) && speed > 0 ? speed : 0, bearing: bearing != null && Number.isFinite(bearing) ? bearing : null };
		const previous = this.last;
		this.last = now;
		let finished: Trip | undefined;
		// A long silence ends whatever was running; this fix then starts afresh.
		if (this.current && previous && (t - previous.t) / 1000 > GAP_END_S) { finished = this.close(previous.t, previous.pos) ?? undefined; }
		if (!this.current) {
			if (now.speed >= START_SPEED) this.begin(previous && t - previous.t < 5000 ? previous : now, now);
			return { finished };
		}
		const result = this.advance(previous!, now, limitMs);
		if (this.current.stillSince !== null && (t - this.current.stillSince) / 1000 >= STILL_END_S) {
			finished = this.close(this.current.stillSince, this.current.stillPos, true) ?? undefined;
		}
		return { ...result, finished };
	}

	/** Ends the trip in progress (the app is closing, or the profile is changing). */
	finish(): Trip | null {
		if (!this.current || !this.last) { this.current = null; return null; }
		return this.close(this.last.t, this.last.pos);
	}

	get live(): LiveDrive | null {
		const c = this.current;
		if (!c) return null;
		const score = smoothScore({ distanceM: c.distanceM, movingS: Math.max(c.movingS, 60), hardBrakes: c.hardBrakes, hardAccels: c.hardAccels, hardCorners: c.hardCorners, speedingS: c.speedingS, limitedS: c.limitedS });
		return { distanceM: c.distanceM, score, hardBrakes: c.hardBrakes, hardAccels: c.hardAccels, hardCorners: c.hardCorners, speeding: !!this.last && c.limitedS > 0 && this.speeding, startedAt: c.startedAt };
	}
	private speeding = false;

	/** The current trip's track so far (flat longitude, latitude, seconds), for racing a ghost. */
	get track(): readonly number[] { return this.current?.track ?? []; }
	get active(): boolean { return this.current !== null; }
	get origin(): LngLat | null { return this.current?.from ?? null; }

	private begin(from: Fix, now: Fix): void {
		this.current = {
			startedAt: from.t, from: from.pos, to: now.pos, distanceM: 0, movingS: 0, maxSpeed: now.speed,
			hardBrakes: 0, hardAccels: 0, hardCorners: 0, speedingS: 0, limitedS: 0,
			track: [round5(from.pos[0]), round5(from.pos[1]), 0], spacing: TRACK_SPACING_M, sinceTrackM: 0,
			stillSince: null, stillPos: now.pos, stillDistanceM: 0, stillMovingS: 0, stillTrackLength: 3,
			armed: { brake: true, accel: true, corner: true },
		};
		this.speeding = false;
		if (from !== now) this.advance(from, now, null);
	}

	private advance(previous: Fix, now: Fix, limitMs: number | null): { event?: DriveEvent } {
		const c = this.current!;
		const dt = (now.t - previous.t) / 1000;
		if (dt <= 0) return {};
		let event: DriveEvent | undefined;
		const metres = distanceM(previous.pos, now.pos);
		const plausible = metres / dt <= MAX_PLAUSIBLE_MS;
		if (plausible) { c.distanceM += metres; c.sinceTrackM += metres; }
		c.to = now.pos;
		c.maxSpeed = Math.max(c.maxSpeed, now.speed);
		const moving = now.speed >= STILL_SPEED;
		if (moving) {
			c.movingS += Math.min(dt, 5);
			c.stillSince = null;
		} else if (c.stillSince === null) {
			c.stillSince = previous.t;
			c.stillPos = previous.pos;
			c.stillDistanceM = c.distanceM - (plausible ? metres : 0);
			c.stillMovingS = c.movingS;
			c.stillTrackLength = c.track.length;
		}

		// Harsh events are judged between fixes about a second apart; a longer gap says nothing about the car's motion.
		if (dt >= 0.4 && dt <= 3) {
			const accel = (now.speed - previous.speed) / dt;
			if (accel <= -HARD_BRAKE && previous.speed > 4) { if (c.armed.brake) { c.hardBrakes++; c.armed.brake = false; event = "brake"; } }
			else if (accel > -REARM) c.armed.brake = true;
			if (accel >= HARD_ACCEL && now.speed > 3) { if (c.armed.accel) { c.hardAccels++; c.armed.accel = false; event = event ?? "accel"; } }
			else if (accel < REARM) c.armed.accel = true;
			if (previous.bearing != null && now.bearing != null && now.speed > 6 && previous.speed > 6) {
				const lateral = Math.abs(((wrap180(now.bearing - previous.bearing) * Math.PI) / 180) / dt) * ((now.speed + previous.speed) / 2);
				if (lateral >= HARD_CORNER) { if (c.armed.corner) { c.hardCorners++; c.armed.corner = false; event = event ?? "corner"; } }
				else if (lateral < REARM) c.armed.corner = true;
			}
		}

		if (limitMs !== null && limitMs > 0) {
			c.limitedS += Math.min(dt, 5);
			this.speeding = now.speed > limitMs + Math.max(OVER_MIN_MS, limitMs * OVER_FRACTION);
			if (this.speeding) c.speedingS += Math.min(dt, 5);
		} else this.speeding = false;

		if (c.sinceTrackM >= c.spacing && plausible) {
			c.track.push(round5(now.pos[0]), round5(now.pos[1]), Math.round((now.t - c.startedAt) / 1000));
			c.sinceTrackM = 0;
			if (c.track.length / 3 > TRACK_MAX_POINTS) { thin(c.track); c.spacing *= 2; c.stillTrackLength = Math.min(c.stillTrackLength, c.track.length); }
		}
		return event ? { event } : {};
	}

	private close(endAt: number, endPos: LngLat, trimStill = false): Trip | null {
		const c = this.current;
		this.current = null;
		this.speeding = false;
		if (!c) return null;
		// Standing still at the end is not part of the trip.
		const distance = trimStill ? c.stillDistanceM : c.distanceM;
		const movingS = trimStill ? c.stillMovingS : c.movingS;
		if (distance < MIN_TRIP_M || movingS < MIN_TRIP_MOVING_S) return null;
		const track = trimStill ? c.track.slice(0, Math.min(c.stillTrackLength, c.track.length)) : c.track;
		const seconds = Math.round((endAt - c.startedAt) / 1000);
		track.push(round5(endPos[0]), round5(endPos[1]), seconds);
		const scoring: ScoreInput = { distanceM: distance, movingS, hardBrakes: c.hardBrakes, hardAccels: c.hardAccels, hardCorners: c.hardCorners, speedingS: c.speedingS, limitedS: c.limitedS };
		return {
			id: newTripId(), start: c.startedAt, end: endAt, distanceM: Math.round(distance), movingS: Math.round(movingS), maxSpeed: Math.round(c.maxSpeed * 10) / 10,
			from: c.from, to: endPos, score: smoothScore(scoring), hardBrakes: c.hardBrakes, hardAccels: c.hardAccels, hardCorners: c.hardCorners,
			speedingS: Math.round(c.speedingS), limitedS: Math.round(c.limitedS), track,
		};
	}
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/** Keeps every other point of a flat longitude, latitude, seconds track (and always the first). */
function thin(track: number[]): void {
	const kept: number[] = [];
	for (let i = 0; i < track.length; i += 6) kept.push(track[i], track[i + 1], track[i + 2]);
	const lastStart = track.length - 3;
	if (kept[kept.length - 1] !== track[lastStart + 2]) kept.push(track[lastStart], track[lastStart + 1], track[lastStart + 2]);
	track.length = 0;
	track.push(...kept);
}

// ── Saved trips ────────────────────────────────────────────────────────────

/** Trips are kept this long as summaries; only the newest keep their track (plus each route's fastest, see `trimTrips`). */
export const MAX_TRIPS = 1000;
export const TRACKS_KEPT = 150;

export interface DriveSave { version: 1; trips: Trip[] }

const isPoint = (value: unknown): value is LngLat => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === "number" && Number.isFinite(n));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A trip read from a save file, or null if it is damaged. */
export function readTrip(item: unknown): Trip | null {
	const t = item as Partial<Trip> | null;
	if (!t || typeof t.id !== "string" || !finite(t.start) || !finite(t.end) || !finite(t.distanceM) || !finite(t.movingS) || !isPoint(t.from) || !isPoint(t.to)) return null;
	const track = Array.isArray(t.track) && t.track.length >= 6 && t.track.length % 3 === 0 && t.track.every(finite) ? t.track : undefined;
	const race = t.race && typeof t.race.ghostId === "string" && finite(t.race.deltaS) ? { ghostId: t.race.ghostId, deltaS: t.race.deltaS } : undefined;
	return {
		id: t.id, start: t.start, end: t.end, distanceM: t.distanceM, movingS: t.movingS, maxSpeed: finite(t.maxSpeed) ? t.maxSpeed : 0, from: t.from, to: t.to,
		score: finite(t.score) ? t.score : null, hardBrakes: finite(t.hardBrakes) ? t.hardBrakes : 0, hardAccels: finite(t.hardAccels) ? t.hardAccels : 0, hardCorners: finite(t.hardCorners) ? t.hardCorners : 0,
		speedingS: finite(t.speedingS) ? t.speedingS : 0, limitedS: finite(t.limitedS) ? t.limitedS : 0, ...(track ? { track } : {}), ...(race ? { race } : {}),
	};
}

export function readTrips(data: unknown): Trip[] {
	const list = (data as Partial<DriveSave> | null)?.trips;
	if (!Array.isArray(list)) return [];
	return list.map(readTrip).filter((trip): trip is Trip => trip !== null).sort((a, b) => a.start - b.start);
}

/** Two trips are the same route if they start together, end together, and are about as long. */
export const ROUTE_ENDS_M = 300;
export function sameRoute(a: Trip, b: Trip): boolean {
	if (a.distanceM <= 0 || b.distanceM <= 0) return false;
	const ratio = a.distanceM / b.distanceM;
	return ratio > 0.8 && ratio < 1.25 && distanceM(a.from, b.from) <= ROUTE_ENDS_M && distanceM(a.to, b.to) <= ROUTE_ENDS_M;
}

/** The trip's time, start to end. */
export const tripSeconds = (trip: Trip) => Math.max(1, Math.round((trip.end - trip.start) / 1000));

/**
 * Keeps the most recent MAX_TRIPS, and drops the track from all but the newest TRACKS_KEPT, except the fastest run of each
 * route driven more than once (which a ghost still needs). A route driven once long ago is not worth a track.
 */
export function trimTrips(trips: Trip[]): Trip[] {
	const kept = trips.slice(-MAX_TRIPS);
	const keepTrack = new Set(kept.slice(-TRACKS_KEPT).map(trip => trip.id));
	const groups: Trip[][] = [];
	for (const trip of kept) {
		const group = groups.find(list => sameRoute(list[0], trip));
		if (group) group.push(trip); else groups.push([trip]);
	}
	for (const group of groups) {
		if (group.length < 2) continue;
		const withTrack = group.filter(trip => trip.track);
		if (withTrack.length) keepTrack.add(withTrack.reduce((best, trip) => tripSeconds(trip) < tripSeconds(best) ? trip : best).id);
	}
	return kept.map(trip => trip.track && !keepTrack.has(trip.id) ? { ...trip, track: undefined } : trip);
}

// ── Stats ──────────────────────────────────────────────────────────────────

export interface DriveStats {
	trips: number;
	distanceM: number;
	drivingS: number;
	longestM: number;
	topSpeed: number;
	scoredTrips: number;
	averageScore: number | null;
	bestScore: number | null;
	hardBrakes: number;
	/** The same totals for the last seven days. */
	week: { trips: number; distanceM: number; drivingS: number; averageScore: number | null };
}

const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;

export function driveStats(trips: readonly Trip[], now: number): DriveStats {
	const scores = trips.flatMap(trip => trip.score === null ? [] : [trip.score]);
	const weekTrips = trips.filter(trip => now - trip.end < 7 * 86_400_000);
	const weekScores = weekTrips.flatMap(trip => trip.score === null ? [] : [trip.score]);
	return {
		trips: trips.length,
		distanceM: trips.reduce((sum, trip) => sum + trip.distanceM, 0),
		drivingS: trips.reduce((sum, trip) => sum + trip.movingS, 0),
		longestM: trips.reduce((max, trip) => Math.max(max, trip.distanceM), 0),
		topSpeed: trips.reduce((max, trip) => Math.max(max, trip.maxSpeed), 0),
		scoredTrips: scores.length,
		averageScore: average(scores),
		bestScore: scores.length ? Math.max(...scores) : null,
		hardBrakes: trips.reduce((sum, trip) => sum + trip.hardBrakes, 0),
		week: { trips: weekTrips.length, distanceM: weekTrips.reduce((sum, trip) => sum + trip.distanceM, 0), drivingS: weekTrips.reduce((sum, trip) => sum + trip.movingS, 0), averageScore: average(weekScores) },
	};
}
