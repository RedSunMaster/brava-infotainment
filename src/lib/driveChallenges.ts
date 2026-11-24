import type { Trip } from "./drives";

/**
 * Daily and weekly challenges and driving streaks. None of it is stored: the day's challenges are picked from the date alone,
 * and how far along each one is, and every streak, is worked out from the saved trips. So they cannot drift out of step with
 * the trips, and last week's can be looked at again.
 */

export type ChallengeKind = "distance" | "trips" | "smoothTrip" | "calmDrive" | "withinLimit" | "avgScore" | "days";
export type ChallengePeriod = "day" | "week";

export interface Challenge {
	id: string;
	period: ChallengePeriod;
	/** The day (or the Monday of the week) it belongs to, as a local YYYY-MM-DD. */
	key: string;
	kind: ChallengeKind;
	/** Kilometres, trips, days or score points, by kind. */
	target: number;
	/** A trip must be at least this long to count (smooth trips, calm drives and limit-keeping). */
	minKm: number;
	title: string;
}

export interface ChallengeProgress extends Challenge {
	value: number;
	done: boolean;
	/** 0 to 1, for the progress bar. */
	fraction: number;
	/** "6.2 of 15 km". */
	display: string;
}

interface Template { kind: ChallengeKind; targets: number[]; minKm?: number }

const DAILY: Template[] = [
	{ kind: "distance", targets: [8, 15, 25] },
	{ kind: "trips", targets: [2, 3] },
	{ kind: "smoothTrip", targets: [85, 90], minKm: 3 },
	{ kind: "calmDrive", targets: [4, 8] },
	{ kind: "withinLimit", targets: [4, 8] },
];
const WEEKLY: Template[] = [
	{ kind: "distance", targets: [60, 100, 150] },
	{ kind: "trips", targets: [6, 10] },
	{ kind: "avgScore", targets: [80, 85] },
	{ kind: "days", targets: [3, 4, 5] },
	{ kind: "smoothTrip", targets: [90], minKm: 5 },
	{ kind: "calmDrive", targets: [12, 20] },
];
/** How many of each are on offer. */
export const DAILY_COUNT = 2;
export const WEEKLY_COUNT = 1;
/** A smooth trip must score at least this for the smooth-trip streak. */
export const SMOOTH_STREAK_SCORE = 80;
/** A day counts as driven if this much was covered. */
export const DRIVEN_DAY_M = 1000;
const MIN_AVG_TRIPS = 3;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** The local day's noon, which stays on the right day across clock changes. */
const noonOf = (key: string): Date => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (key: string, days: number): string => { const d = noonOf(key); d.setDate(d.getDate() + days); return dayKey(d.getTime()); };
/** The Monday of the week a day is in. */
export const weekKey = (ms: number): string => { const d = new Date(ms); const back = (d.getDay() + 6) % 7; return addDays(dayKey(ms), -back); };

function seeded(text: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
	return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function titleOf(kind: ChallengeKind, target: number, minKm: number, period: ChallengePeriod): string {
	const when = period === "day" ? "today" : "this week";
	switch (kind) {
		case "distance": return `Drive ${target} km ${when}`;
		case "trips": return `Make ${target} trips ${when}`;
		case "smoothTrip": return `Score ${target}+ on a trip of ${minKm} km or more`;
		case "calmDrive": return `Drive ${target} km without a harsh brake, start or corner`;
		case "withinLimit": return `Drive ${target} km without going over the limit`;
		case "avgScore": return `Average ${target}+ smooth score over ${MIN_AVG_TRIPS} or more trips`;
		case "days": return `Drive on ${target} different days`;
	}
}

/** The challenges for a day or week: the same every time for the same date. */
export function challengesFor(period: ChallengePeriod, key: string): Challenge[] {
	const random = seeded(`${period}:${key}`);
	const pool = (period === "day" ? DAILY : WEEKLY).slice();
	const count = period === "day" ? DAILY_COUNT : WEEKLY_COUNT;
	const picked: Challenge[] = [];
	while (picked.length < count && pool.length) {
		const template = pool.splice(Math.floor(random() * pool.length), 1)[0];
		const target = template.targets[Math.floor(random() * template.targets.length)];
		const minKm = template.minKm ?? 0;
		picked.push({ id: `${period}:${key}:${template.kind}`, period, key, kind: template.kind, target, minKm, title: titleOf(template.kind, target, minKm, period) });
	}
	return picked;
}

const km = (trip: Trip) => trip.distanceM / 1000;
const calm = (trip: Trip) => trip.hardBrakes + trip.hardAccels + trip.hardCorners === 0;
/** The speed limit was known for most of the trip, and it was kept to. */
const keptLimit = (trip: Trip) => trip.limitedS >= trip.movingS * 0.7 && trip.speedingS <= 3;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** How far along a challenge is, given the trips of its day or week (`trips` may hold others; they are filtered here). */
export function evaluate(challenge: Challenge, trips: readonly Trip[]): ChallengeProgress {
	const inWindow = trips.filter(trip => (challenge.period === "day" ? dayKey(trip.end) : weekKey(trip.end)) === challenge.key);
	let value = 0;
	let display = "";
	const { target } = challenge;
	switch (challenge.kind) {
		case "distance": value = round1(inWindow.reduce((sum, trip) => sum + km(trip), 0)); display = `${value} of ${target} km`; break;
		case "trips": value = inWindow.length; display = `${value} of ${target}`; break;
		case "days": value = new Set(inWindow.map(trip => dayKey(trip.end))).size; display = `${value} of ${target} days`; break;
		case "smoothTrip": {
			const scores = inWindow.filter(trip => km(trip) >= challenge.minKm && trip.score !== null).map(trip => trip.score as number);
			value = scores.length ? Math.max(...scores) : 0;
			display = scores.length ? `Best ${value} of ${target}` : `No trip of ${challenge.minKm} km yet`;
			break;
		}
		case "calmDrive": value = round1(Math.max(0, ...inWindow.filter(calm).map(km))); display = `Longest ${value} of ${target} km`; break;
		case "withinLimit": value = round1(Math.max(0, ...inWindow.filter(keptLimit).map(km))); display = `Longest ${value} of ${target} km`; break;
		case "avgScore": {
			const scores = inWindow.filter(trip => trip.score !== null).map(trip => trip.score as number);
			value = scores.length >= MIN_AVG_TRIPS ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : 0;
			display = scores.length >= MIN_AVG_TRIPS ? `Average ${value} of ${target}` : `${scores.length} of ${MIN_AVG_TRIPS} trips`;
			break;
		}
	}
	const done = value >= target && (challenge.kind !== "avgScore" || value > 0);
	return { ...challenge, value, done, fraction: Math.max(0, Math.min(1, target > 0 ? value / target : 0)), display };
}

export interface ChallengeSet { daily: ChallengeProgress[]; weekly: ChallengeProgress[] }

export function currentChallenges(now: number, trips: readonly Trip[]): ChallengeSet {
	return {
		daily: challengesFor("day", dayKey(now)).map(challenge => evaluate(challenge, trips)),
		weekly: challengesFor("week", weekKey(now)).map(challenge => evaluate(challenge, trips)),
	};
}

export const doneIds = (set: ChallengeSet): Set<string> => new Set([...set.daily, ...set.weekly].filter(item => item.done).map(item => item.id));

export interface Streaks {
	/** Days in a row driven (today's is kept alive until the day ends). */
	days: number;
	bestDays: number;
	drivenToday: boolean;
	/** Trips in a row scoring SMOOTH_STREAK_SCORE or more. */
	smooth: number;
	bestSmooth: number;
	/** Days in a row on which every daily challenge was done. */
	challenges: number;
	bestChallenges: number;
}

function groupByDay(trips: readonly Trip[]): Map<string, Trip[]> {
	const days = new Map<string, Trip[]>();
	for (const trip of trips) { const key = dayKey(trip.end); const list = days.get(key); if (list) list.push(trip); else days.set(key, [trip]); }
	return days;
}

/** The run of days ending today (or yesterday, if today has not yet qualified), and the longest run ever, for a test on a day. */
function dayRuns(days: Map<string, Trip[]>, today: string, qualifies: (key: string, trips: Trip[]) => boolean): { current: number; best: number; today: boolean } {
	const keys = [...days.keys()].sort();
	const earliest = keys[0];
	if (!earliest) return { current: 0, best: 0, today: false };
	let best = 0, run = 0, current = 0, todayOk = false;
	for (let key = earliest, guard = 0; key <= today && guard < 4000; key = addDays(key, 1), guard++) {
		const ok = qualifies(key, days.get(key) ?? []);
		if (key === today) todayOk = ok;
		run = ok ? run + 1 : (key === today ? run : 0);
		// Today not being done yet does not break the run; it just is not added.
		best = Math.max(best, run);
		if (key === today) current = run;
	}
	return { current, best, today: todayOk };
}

export function computeStreaks(trips: readonly Trip[], now: number): Streaks {
	const today = dayKey(now);
	const days = groupByDay(trips);
	const driven = dayRuns(days, today, (_key, list) => list.reduce((sum, trip) => sum + trip.distanceM, 0) >= DRIVEN_DAY_M);
	const done = dayRuns(days, today, (key, list) => { const set = challengesFor("day", key); return set.length > 0 && set.every(challenge => evaluate(challenge, list).done); });
	const scored = trips.filter(trip => trip.score !== null);
	let smooth = 0, bestSmooth = 0, run = 0;
	for (const trip of scored) { run = (trip.score as number) >= SMOOTH_STREAK_SCORE ? run + 1 : 0; bestSmooth = Math.max(bestSmooth, run); }
	smooth = run;
	return { days: driven.current, bestDays: driven.best, drivenToday: driven.today, smooth, bestSmooth, challenges: done.current, bestChallenges: done.best };
}
