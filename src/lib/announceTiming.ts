/**
 * When to speak about a turn. Each turn is announced as it comes up, reminded part-way, and
 * announced again just before it. How far ahead those points are depends on how fast the car is
 * going: at 100 km/h a turn 200 m away is seven seconds off, at 30 km/h it is twenty.
 */
export type Band = "far" | "reminder" | "now";

/** Seconds of warning for the reminder and for the final instruction, and the least distance for each. */
const REMINDER_SECONDS = 25;
const NOW_SECONDS = 5;
export const MIN_REMINDER_M = 400;
export const MIN_NOW_M = 80;
/** A turn that comes up only slightly beyond the reminder point is announced as the reminder, not twice in a row. */
const FIRST_ANNOUNCEMENT_SLACK = 1.35;

export function thresholds(speedMs: number): { reminder: number; now: number } {
	const speed = Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 0;
	return { reminder: Math.max(MIN_REMINDER_M, speed * REMINDER_SECONDS), now: Math.max(MIN_NOW_M, speed * NOW_SECONDS) };
}

const RANK: Record<Band, number> = { far: 0, reminder: 1, now: 2 };
export const bandRank = (band: Band) => RANK[band];

/** Which stage a turn is in. `first` is true the first time this turn is considered. */
export function bandFor(distanceM: number, speedMs: number, first: boolean): Band {
	const { reminder, now } = thresholds(speedMs);
	if (distanceM <= now) return "now";
	if (distanceM <= (first ? reminder * FIRST_ANNOUNCEMENT_SLACK : reminder)) return "reminder";
	return "far";
}

/** Whether a turn in `band` should be spoken, given the last stage already spoken for it (null if none). */
export function shouldAnnounce(band: Band, lastSpoken: Band | null): boolean {
	return lastSpoken === null || RANK[band] > RANK[lastSpoken];
}

/**
 * Whether a spoken notice that is not a turn instruction can be said now without talking over
 * guidance: not just after a turn announcement and not while a turn is close.
 */
export function quietForNotice(distanceToTurnM: number | null, msSinceTurnSpoken: number): boolean {
	return msSinceTurnSpoken > 6000 && (distanceToTurnM == null || distanceToTurnM > 250);
}
