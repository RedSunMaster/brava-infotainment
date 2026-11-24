import { distanceM, type LngLat } from "./exploration";
import { FRUIT_SPRITES } from "./fruitSprites";

/**
 * Bonus fruit, as in the arcade: every so often (after FRUIT_EVERY dots) a fruit appears on a road ahead of the car and
 * waits for a while. Driving through it scores its points (which the run's multiplier does not touch). The better the run,
 * the better the fruit: cherry, strawberry, orange, apple, melon, Galaxian ship, bell, key.
 */
export const FRUIT_EVERY = 70;
/** How long a fruit waits (milliseconds). */
export const FRUIT_LIFETIME_MS = 25_000;
/** The car eats a fruit that is this close to its path (metres): more than a dot, as it is one target and is passed at speed. */
export const FRUIT_EAT_M = 14;
/** A fruit appears this far from the car, on a road, within this angle of its heading (degrees each side). */
export const FRUIT_MIN_M = 150;
export const FRUIT_MAX_M = 320;
const FRUIT_ARC = 50;
/** One better fruit for each this many dots in the run, up to the key. */
export const FRUIT_RUN_STEP = 70;

export const FRUIT_POINTS: readonly number[] = FRUIT_SPRITES.map(sprite => sprite.points);
export const FRUIT_NAMES: readonly string[] = FRUIT_SPRITES.map(sprite => sprite.name);
/** Which fruit a run of `streak` dots earns. */
export const fruitForStreak = (streak: number): number => Math.min(FRUIT_SPRITES.length - 1, Math.floor(Math.max(0, streak) / FRUIT_RUN_STEP));

export interface LiveFruit { kind: number; pos: LngLat; /** performance.now()-style milliseconds. */ expiresAt: number }

const bearingTo = (from: LngLat, to: LngLat): number => (Math.atan2((to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180), to[1] - from[1]) * 180) / Math.PI;

/** Which of the places (road points) a fruit could appear at: ahead of the car, not too near or far. */
export function fruitSpots(car: LngLat, bearing: number | null, places: readonly LngLat[]): LngLat[] {
	return places.filter(place => {
		const d = distanceM(car, place);
		if (d < FRUIT_MIN_M || d > FRUIT_MAX_M) return false;
		if (bearing === null) return true;
		const off = Math.abs(((bearingTo(car, place) - bearing + 540) % 360) - 180);
		return off <= FRUIT_ARC;
	});
}

/** Whether the path from `from` to `to` (null: just `to`) passes within `radiusM` of `target`. */
export function passesNear(from: LngLat | null, to: LngLat, target: LngLat, radiusM: number): boolean {
	const mx = 111_320 * Math.cos((to[1] * Math.PI) / 180), my = 110_540;
	const ax = from ? (from[0] - to[0]) * mx : 0, ay = from ? (from[1] - to[1]) * my : 0;
	const px = (target[0] - to[0]) * mx, py = (target[1] - to[1]) * my;
	const length2 = ax * ax + ay * ay;
	const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * -ax + (py - ay) * -ay) / length2)) : 1;
	const dx = px - ax * (1 - t), dy = py - ay * (1 - t);
	return dx * dx + dy * dy <= radiusM * radiusM;
}

export class FruitBonus {
	live: LiveFruit | null = null;
	private since = 0;

	/** Counts dots eaten towards the next fruit. */
	addDots(count: number): void { this.since += count; }

	/** Whether it is time for a fruit (and one is not already waiting). */
	get due(): boolean { return this.since >= FRUIT_EVERY && !this.live; }

	/** Puts a fruit at one of the spots (chosen by `random`, 0 to 1), as good as the run is. Null if none can be placed (it is tried again next time). */
	spawn(spots: readonly LngLat[], streak: number, now: number, random: () => number = Math.random): LiveFruit | null {
		if (!this.due || !spots.length) return null;
		this.since = 0;
		this.live = { kind: fruitForStreak(streak), pos: spots[Math.min(spots.length - 1, Math.floor(random() * spots.length))], expiresAt: now + FRUIT_LIFETIME_MS };
		return this.live;
	}

	/** The car went from `from` to `to`: its points if it passed through the fruit (which is then gone), else 0. */
	collect(from: LngLat | null, to: LngLat, now: number): { kind: number; points: number } | null {
		const fruit = this.live;
		if (!fruit || now >= fruit.expiresAt || !passesNear(from, to, fruit.pos, FRUIT_EAT_M)) return null;
		this.live = null;
		return { kind: fruit.kind, points: FRUIT_POINTS[fruit.kind] };
	}

	/** Takes away a fruit that has waited too long. Returns whether it did. */
	expire(now: number): boolean {
		if (this.live && now >= this.live.expiresAt) { this.live = null; return true; }
		return false;
	}

	clear(): void { this.live = null; this.since = 0; }
}
