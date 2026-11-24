/**
 * Pac-Man mode's ghosts: Blinky, Pinky, Inky and Clyde, who chase the car along the roads, and run from it after a power
 * pellet.
 *
 * Each starts well out of sight (Blinky and Pinky ahead of the car, Inky and Clyde behind it) one after another, so there
 * is time to get going. Each moves at about the car's own speed, and faster the further behind it is (so one you have left
 * behind catches you up again), and one that stays far behind is brought back in ahead of you (so you keep meeting them). All
 * stand still whenever the car is stopped, so a red light is never a loss. They differ in where they head, as in the arcade:
 *  - Blinky follows the shortest road to the car;
 *  - Pinky heads for the road ahead of the car, to meet it (and goes straight at the car once close);
 *  - Inky heads for a point as far past the road ahead of the car as Blinky is short of it, so the two close in together
 *    (and goes straight at the car once close);
 *  - Clyde chases too, but slower, and at junctions turns off down a side road now and then.
 * A ghost touching the car ends its run (and goes away for a while). After a power pellet they all turn blue for a time and
 * wander the roads at random (they do not know the way), and are eaten by touching the car, for more points each, to a fourth.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */
import type { LngLat } from "./exploration";
import { RoadGraph, distance, type Reach } from "./roadGraph";

export type GhostName = "blinky" | "pinky" | "inky" | "clyde";
export const GHOST_NAMES: readonly GhostName[] = ["blinky", "pinky", "inky", "clyde"];
export const GHOST_LABEL: Record<GhostName, string> = { blinky: "Blinky", pinky: "Pinky", inky: "Inky", clyde: "Clyde" };
/** Within this distance of the car (a little more than a car and a ghost side by side) a ghost has it. */
export const CATCH_M = 12;
/** A new ghost starts this far from the car by road. */
export const SPAWN_MIN_M = 500;
export const SPAWN_MAX_M = 800;
/** Ghosts start at least this far (as the crow flies) from each other. */
const APART_M = 180;
/** A ghost is given up on and started again when it is this far behind. */
export const LOSE_M = 1_800;
/** How far round the car the roads are searched for the ghosts. */
const SEARCH_M = 4_000;
/** The car must be this near a road to be chased. */
const SNAP_CAR_M = 60;
/** Seconds before a ghost that caught the car starts again, one that was lost, and one that was eaten. */
export const RESPAWN_S = 10;
const LOST_RESPAWN_S = 3;
export const EATEN_RESPAWN_S = 8;
/** A ghost left far behind (see RECYCLE_M) for this long comes back in ahead of the car, after this many seconds. */
export const RECYCLE_AFTER_S = 6;
const RECYCLE_RESPAWN_S = 1.5;
/** Seconds after the car first gets moving that each ghost is let out. */
export const RELEASE_S: Record<GhostName, number> = { blinky: 0, pinky: 6, inky: 14, clyde: 24 };
/** A ghost's speed is the car's times this (to at most MAX_SPEED_MS), and times FRIGHT_SPEED while it is blue; below STOPPED_MS the car is stopped and every ghost stands still. */
export const SPEED_FACTOR: Record<GhostName, number> = { blinky: 1.12, pinky: 1.08, inky: 1.05, clyde: 1.0 };
/** The further behind a ghost is (by road), the faster it goes: nothing up to RUBBER_FROM_M, then up to this much more again over RUBBER_SPAN_M. */
export const RUBBER_FROM_M = 150;
const RUBBER_SPAN_M = 450;
const RUBBER_MAX = 1;
/** A ghost further than this behind the car (by road) is recycled once it has been for RECYCLE_AFTER_S. */
export const RECYCLE_M = 700;
export const FRIGHT_SPEED = 0.55;
export const MAX_SPEED_MS = 28;
export const STOPPED_MS = 1;
/** The roads are searched again after this many seconds (or when the car has moved to another road point). */
const SEARCH_EVERY_S = 1;
/** A new ghost is only started once the car is moving along at least this fast. */
export const SPAWN_SPEED_MS = 3;
/** How long the ghosts stay blue after a power pellet, and how long before the end they start to flash. */
export const FRIGHT_S = 15;
export const FLASH_LAST_S = 4;
/** What eating ghosts in one run of blue is worth: the first, second, third, and each after. */
export const EATEN_POINTS: readonly number[] = [200, 400, 800, 1600];
/** Pinky aims this far ahead of the car, and Inky's pivot is this far ahead. */
const PINKY_AHEAD_M = 250;
const INKY_PIVOT_M = 120;
/** Within this road distance of the car, Pinky and Inky stop aiming ahead of it and go straight for it. */
const STRAIGHT_FOR_M = 350;
/** The chance that Clyde turns off the road to the car at a junction. */
const CLYDE_WANDER = 0.3;

export interface Car { pos: LngLat; /** Metres per second. */ speed: number; /** Degrees clockwise from north, or null if not known. */ bearing: number | null }
export type GhostMood = "chasing" | "frightened" | "flashing";
export interface GhostPlace { name: GhostName; pos: LngLat; /** Degrees clockwise from north, the way it is going. */ bearing: number; mood: GhostMood }
export type GhostEvent = { type: "caught"; name: GhostName } | { type: "eaten"; name: GhostName; points: number };

interface Walker { node: number; next: number | null; prev: number; along: number }
interface Ghost { name: GhostName; walker: Walker | null; home: number; respawnAt: number; lastBearing: number; /** How long it has been far behind the car. */ behindFor: number }

const bearingBetween = (a: LngLat, b: LngLat): number => {
	const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), dy = b[1] - a[1];
	return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
};
const angleBetween = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
/** A point `metres` from `pos` on a bearing. */
function pointAhead(pos: LngLat, bearing: number, metres: number): LngLat {
	const heading = (bearing * Math.PI) / 180;
	return [pos[0] + (metres * Math.sin(heading)) / (111_320 * Math.cos((pos[1] * Math.PI) / 180)), pos[1] + (metres * Math.cos(heading)) / 110_540];
}

export interface GhostOptions {
	/** Which ghosts there are (all four unless a test wants fewer). */
	names?: readonly GhostName[];
	random?: () => number;
}

export class GhostPack {
	private ghosts: Ghost[];
	private random: () => number;
	private reach: Reach | null = null;
	private reachNode = -1;
	private reachAt = -Infinity;
	/** Searches from other places than the car (a ghost's target or home), kept for a moment. */
	private fields = new Map<number, { reach: Reach; at: number }>();
	/** When the car first got moving (on the clock given to update), or null before. */
	private startedAt: number | null = null;
	private frightenedUntil = -Infinity;
	private eatenInRun = 0;
	private clock = 0;

	constructor(private graph: RoadGraph, options: GhostOptions = {}) {
		this.random = options.random ?? Math.random;
		this.ghosts = (options.names ?? GHOST_NAMES).map((name): Ghost => ({ name, walker: null, home: -1, respawnAt: 0, lastBearing: 0, behindFor: 0 }));
	}

	/** Moves on to a rebuilt road map, keeping each ghost where it is if it can be put back on a road there. */
	setGraph(graph: RoadGraph): void {
		const places = this.places();
		this.graph = graph;
		this.reach = null;
		this.reachNode = -1;
		this.fields.clear();
		for (const ghost of this.ghosts) {
			const at = places.find(place => place.name === ghost.name);
			const node = at ? graph.nearest(at.pos, 40) : null;
			ghost.walker = node === null ? null : { node, next: null, prev: -1, along: 0 };
			ghost.home = node ?? -1;
		}
	}

	/** Where each ghost is now, and whether it is blue. */
	places(): GhostPlace[] {
		const mood = this.mood();
		const out: GhostPlace[] = [];
		for (const ghost of this.ghosts) {
			const walker = ghost.walker;
			if (!walker) continue;
			const here = this.graph.nodes[walker.node];
			if (walker.next === null) { out.push({ name: ghost.name, pos: here, bearing: ghost.lastBearing, mood }); continue; }
			const there = this.graph.nodes[walker.next];
			const length = distance(here, there);
			const t = length > 0 ? Math.min(1, walker.along / length) : 0;
			out.push({ name: ghost.name, pos: [here[0] + (there[0] - here[0]) * t, here[1] + (there[1] - here[1]) * t], bearing: bearingBetween(here, there), mood });
		}
		return out;
	}

	/** Blinky's place, or null: the one ghost the tests of a single chase follow. */
	place(): GhostPlace | null { return this.places().find(place => place.name === "blinky") ?? this.places()[0] ?? null; }

	/** Whether the ghosts are blue now, and for how many more seconds. */
	frightenedFor(): number { return Math.max(0, this.frightenedUntil - this.clock); }

	private mood(): GhostMood {
		const left = this.frightenedUntil - this.clock;
		return left <= 0 ? "chasing" : left <= FLASH_LAST_S ? "flashing" : "frightened";
	}

	/** A power pellet was eaten: every ghost turns blue for FRIGHT_S, and the count of ghosts eaten starts again. */
	frighten(now: number): void {
		this.clock = now;
		this.frightenedUntil = now + FRIGHT_S;
		this.eatenInRun = 0;
		// As in the arcade, every ghost turns round.
		for (const ghost of this.ghosts) {
			const walker = ghost.walker;
			if (!walker) continue;
			if (walker.next !== null) {
				const length = distance(this.graph.nodes[walker.node], this.graph.nodes[walker.next]);
				[walker.node, walker.next] = [walker.next, walker.node];
				walker.along = Math.max(0, length - walker.along);
			}
			walker.prev = -1;
			ghost.lastBearing = (ghost.lastBearing + 180) % 360;
		}
	}

	/** Takes every ghost away (the mode was switched off). */
	clear(): void {
		for (const ghost of this.ghosts) ghost.walker = null;
		this.reach = null;
		this.reachNode = -1;
		this.fields.clear();
		this.startedAt = null;
		this.frightenedUntil = -Infinity;
	}

	/**
	 * Moves the ghosts on by `dt` seconds. `now` is the time in seconds. Returns what happened: a ghost that caught the car (and has
	 * gone, to start again after RESPAWN_S), or one the car ate.
	 */
	update(dt: number, car: Car, now: number): GhostEvent[] {
		this.clock = now;
		const events: GhostEvent[] = [];
		const graph = this.graph;
		const carNode = graph.nearest(car.pos, SNAP_CAR_M);
		if (carNode === null) return events;
		if (!this.reach || carNode !== this.reachNode || now - this.reachAt >= SEARCH_EVERY_S) {
			this.reach = graph.reach(carNode, SEARCH_M);
			this.reachNode = carNode;
			this.reachAt = now;
		}
		const reach = this.reach;
		if (this.startedAt === null && car.speed >= SPAWN_SPEED_MS) this.startedAt = now;
		const frightened = now < this.frightenedUntil;
		for (const ghost of this.ghosts) {
			if (!ghost.walker) {
				if (this.startedAt !== null && now >= Math.max(ghost.respawnAt, this.startedAt + RELEASE_S[ghost.name])) this.spawn(ghost, car, reach);
				continue;
			}
			const walker = ghost.walker;
			const away = reach.dist.get(walker.node);
			// Left far behind (or on a road the car cannot be reached from): started again, later.
			if (away === undefined || away > LOSE_M) { ghost.walker = null; ghost.respawnAt = now + LOST_RESPAWN_S; continue; }
			// One left far behind for a while is brought back in ahead of the car, so there are always ghosts to meet.
			const here = this.places().find(candidate => candidate.name === ghost.name);
			if (!frightened && car.bearing !== null && car.speed >= SPAWN_SPEED_MS && away > RECYCLE_M && here && angleBetween(bearingBetween(car.pos, here.pos), car.bearing) > 100) {
				ghost.behindFor += dt;
				if (ghost.behindFor >= RECYCLE_AFTER_S) { ghost.walker = null; ghost.behindFor = 0; ghost.respawnAt = now + RECYCLE_RESPAWN_S; continue; }
			} else ghost.behindFor = 0;
			if (car.speed >= STOPPED_MS) {
				// Nothing at first, then up to twice as fast the further behind it is, so a ghost you have left behind catches you up.
				const rubber = frightened ? 0 : Math.min(RUBBER_MAX, Math.max(0, (away - RUBBER_FROM_M) / RUBBER_SPAN_M));
				const speed = Math.min(MAX_SPEED_MS, car.speed * SPEED_FACTOR[ghost.name] * (frightened ? FRIGHT_SPEED : 1 + rubber));
				this.advance(ghost, speed * dt, reach, car, frightened, now);
			}
			const place = this.places().find(candidate => candidate.name === ghost.name);
			if (place && distance(place.pos, car.pos) < CATCH_M) {
				ghost.walker = null;
				if (frightened) {
					const points = EATEN_POINTS[Math.min(this.eatenInRun, EATEN_POINTS.length - 1)];
					this.eatenInRun++;
					ghost.respawnAt = now + EATEN_RESPAWN_S;
					events.push({ type: "eaten", name: ghost.name, points });
				} else {
					ghost.respawnAt = now + RESPAWN_S;
					events.push({ type: "caught", name: ghost.name });
				}
			}
		}
		return events;
	}

	/** A search from some node, kept for a second. */
	private field(node: number, now: number): Reach {
		const known = this.fields.get(node);
		if (known && now - known.at < SEARCH_EVERY_S) return known.reach;
		const reach = this.graph.reach(node, SEARCH_M);
		this.fields.set(node, { reach, at: now });
		if (this.fields.size > 12) for (const key of this.fields.keys()) { if (this.fields.size <= 8) break; this.fields.delete(key); }
		return reach;
	}

	/** The node nearest a place within a distance, or the car's own node if there is none. */
	private nodeNear(pos: LngLat, within: number): number {
		return this.graph.nearest(pos, within) ?? this.reachNode;
	}

	/** Where along the roads a ghost wants to go from `node`: the next node on its way, by its own way of choosing a target. */
	private choose(ghost: Ghost, node: number, prev: number, reach: Reach, car: Car, frightened: boolean, now: number): number | null {
		const graph = this.graph;
		// Blue ghosts do not know the way: at each junction they take any road but the one they came by.
		if (frightened) return this.anyRoad(node, prev);
		const toCar = (): number | null => graph.towards(node, reach, prev);
		// Close to the car, every ghost simply goes for it.
		const near = (reach.dist.get(node) ?? Infinity) < STRAIGHT_FOR_M;
		switch (ghost.name) {
			case "blinky": return toCar();
			case "pinky": {
				if (near) return toCar();
				// The road ahead of the car.
				const target = car.bearing === null ? this.reachNode : this.nodeNear(pointAhead(car.pos, car.bearing, PINKY_AHEAD_M), 150);
				return graph.towards(node, this.field(target, now), prev) ?? toCar();
			}
			case "inky": {
				if (near) return toCar();
				// As far past a point just ahead of the car as Blinky is short of it.
				const blinkyAt = this.places().find(place => place.name === "blinky")?.pos;
				if (!blinkyAt || car.bearing === null) return toCar();
				const pivot = pointAhead(car.pos, car.bearing, INKY_PIVOT_M);
				const target = this.nodeNear([2 * pivot[0] - blinkyAt[0], 2 * pivot[1] - blinkyAt[1]], 200);
				return graph.towards(node, this.field(target, now), prev) ?? toCar();
			}
			case "clyde": {
				// Chases, but at junctions now and then turns off down a side road.
				if (graph.adj[node].length >= 3 && this.random() < CLYDE_WANDER) return this.anyRoad(node, prev);
				return toCar();
			}
		}
	}

	/** Any road out of a node but the one back (that one only if there is no other). */
	private anyRoad(node: number, prev: number): number | null {
		const roads = this.graph.adj[node].map(edge => edge.to);
		const onward = roads.filter(to => to !== prev);
		const pool = onward.length ? onward : roads;
		return pool.length ? pool[Math.floor(this.random() * pool.length)] : null;
	}

	private advance(ghost: Ghost, metres: number, reach: Reach, car: Car, frightened: boolean, now: number): void {
		const graph = this.graph;
		const walker = ghost.walker!;
		let left = metres;
		for (let guard = 0; guard < 200 && left > 1e-6; guard++) {
			if (walker.next === null) {
				if ((reach.dist.get(walker.node) ?? 1) === 0 && !frightened) return;
				const next = this.choose(ghost, walker.node, walker.prev, reach, car, frightened, now);
				if (next === null) return;
				walker.next = next;
				walker.along = 0;
				ghost.lastBearing = bearingBetween(graph.nodes[walker.node], graph.nodes[next]);
			}
			const length = distance(graph.nodes[walker.node], graph.nodes[walker.next]);
			const step = Math.min(left, length - walker.along);
			walker.along += step;
			left -= step;
			if (walker.along >= length - 1e-6) { walker.prev = walker.node; walker.node = walker.next; walker.next = null; walker.along = 0; }
		}
	}

	/**
	 * Starts a ghost 500 to 800 m down the road from the car: Blinky and Pinky ahead of it, Inky and Clyde behind, and away from
	 * the others (the furthest it can manage, if the stretch is crowded).
	 */
	private spawn(ghost: Ghost, car: Car, reach: Reach): boolean {
		const graph = this.graph;
		const others = this.places().map(place => place.pos);
		const ring: number[] = [], wanted: number[] = [];
		const ahead = ghost.name === "blinky" || ghost.name === "pinky";
		for (const [node, d] of reach.dist) {
			if (d < SPAWN_MIN_M || d > SPAWN_MAX_M) continue;
			ring.push(node);
			if (car.bearing === null) continue;
			const off = angleBetween(bearingBetween(car.pos, graph.nodes[node]), car.bearing);
			if (ahead ? off < 80 : off > 100) wanted.push(node);
		}
		const room = (node: number): number => others.reduce((least, other) => Math.min(least, distance(other, graph.nodes[node])), Infinity);
		// The places in the wanted direction that are clear of the other ghosts; failing that, the clearest of them; failing that, anywhere on the ring.
		const choose = (nodes: number[]): number | null => {
			if (!nodes.length) return null;
			const clear = nodes.filter(node => room(node) >= APART_M);
			if (clear.length) return clear[Math.floor(this.random() * clear.length)];
			return nodes.reduce((best, node) => (room(node) > room(best) ? node : best));
		};
		const node = choose(wanted) ?? choose(ring);
		if (node === null) return false;
		ghost.walker = { node, next: null, prev: -1, along: 0 };
		ghost.home = node;
		return true;
	}
}
