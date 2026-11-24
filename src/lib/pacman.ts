/**
 * Pac-Man mode: dots along every road, eaten by driving over them.
 *
 * Roads come from Mapbox (or OpenStreetMap) in map tiles at zoom TILE_ZOOM (about 2 km across). Dots are placed along each road every
 * DOT_SPACING_M, starting half a spacing in, so two roads meeting at a junction never put dots on top of each other.
 * A dot's id comes from where it is (a cell about 14 m across), so what has been eaten stays eaten when a tile is loaded
 * again. A road that crosses into the next tile is in both, so each tile keeps only the dots inside its own edges.
 *
 * Eaten dots grow back after a time the driver chooses. Score is points per dot, times a multiplier that builds with
 * a run of dots; it does not depend on how fast the car is going.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */
import { CELLS, cellKey, distanceM, toCellSpace, type LngLat } from "./exploration";

/** Roads are fetched by map tile at this zoom (about 2 km across). */
export const TILE_ZOOM = 14;
/** Metres between dots along a road. */
export const DOT_SPACING_M = 30;
/** A dot is eaten when the car passes within this distance of it: about where the Pac-Man's edge meets it on screen. */
export const EAT_RADIUS_M = 9;
export const POINTS_DOT = 10;
export const POINTS_PELLET = 50;
/** Points lost when a ghost catches the car (never below zero). */
export const GHOST_PENALTY = 50;
/** About one dot in this many is a big one. */
const PELLET_EVERY = 40;
/** A run of dots ends when this long passes without eating one. */
export const STREAK_GAP_MS = 45_000;
/** A jump longer than this between fixes is a GPS gap: dots between the two ends are not eaten. */
const MAX_STEP_M = 300;
/** Dots eaten along a path are looked for at this spacing. */
const SAMPLE_M = 12;

export type Regrow = "day" | "week" | "month" | "never";
export const REGROW_OPTIONS: readonly (readonly [Regrow, string])[] = [["day", "1 day"], ["week", "1 week"], ["month", "1 month"], ["never", "Never"]];
export const REGROW_MS: Record<Regrow, number | null> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, never: null };
export const DEFAULT_REGROW: Regrow = "week";
export const isRegrow = (value: unknown): value is Regrow => value === "day" || value === "week" || value === "month" || value === "never";

export interface Dot { id: number; pos: LngLat; pellet: boolean }

/** The multiplier for a run of this many dots: 1x, then one more for every 50, up to 5x. */
export const multiplierFor = (streak: number): number => Math.min(5, 1 + Math.floor(streak / 50));

// ── Tiles ────────────────────────────────────────────────────────────────────────────────────────────────

const TILES = 2 ** TILE_ZOOM;
const mercatorY = (lat: number): number => (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
export const tileOf = ([lng, lat]: LngLat): [number, number] => [Math.max(0, Math.min(TILES - 1, Math.floor(((lng + 180) / 360) * TILES))), Math.max(0, Math.min(TILES - 1, Math.floor(mercatorY(Math.max(-85.05, Math.min(85.05, lat))) * TILES)))];
export const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;
/** The tiles that a circle (centre, radius in metres) touches, the centre's own first and then by distance, at most `max`. */
export function tilesAround(center: LngLat, radiusM: number, max = 16): [number, number][] {
	const dLat = radiusM / 110_540;
	const dLng = radiusM / (111_320 * Math.max(0.05, Math.cos((center[1] * Math.PI) / 180)));
	const [x0, y0] = tileOf([center[0] - dLng, center[1] + dLat]);
	const [x1, y1] = tileOf([center[0] + dLng, center[1] - dLat]);
	const [cx, cy] = tileOf(center);
	const out: [number, number][] = [];
	for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) out.push([x, y]);
	return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy)).slice(0, max);
}

/** The west, south, east and north edges of a tile, in degrees. */
export function tileBounds(tx: number, ty: number): [number, number, number, number] {
	const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / TILES))) * 180) / Math.PI;
	return [(tx / TILES) * 360 - 180, lat(ty + 1), ((tx + 1) / TILES) * 360 - 180, lat(ty)];
}

// ── Dots ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A dot's id: the half-size cell it is in (zoom 21, about 14 m), unique and stable. */
export function dotId(pos: LngLat): number {
	const [x, y] = toCellSpace(pos);
	return Math.floor(x * 2) * (CELLS * 2) + Math.floor(y * 2);
}

/** Which dots are big ones: a mix of the dot's cell, so they are scattered, and the same dot is always the same. */
function isPellet(id: number): boolean {
	const cellsAcross = CELLS * 2;
	let h = Math.imul(Math.floor(id / cellsAcross) | 0, 0x9e3779b1) ^ Math.imul((id % cellsAcross) | 0, 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
	h ^= h >>> 15;
	return (h >>> 0) % PELLET_EVERY === 0;
}

/** Dots along one road, DOT_SPACING_M apart, the first half a spacing in. Roads shorter than one spacing get none. */
export function dotsAlong(line: LngLat[]): Dot[] {
	if (line.length < 2) return [];
	const lengths: number[] = [];
	let total = 0;
	for (let i = 1; i < line.length; i++) { const length = distanceM(line[i - 1], line[i]); lengths.push(length); total += length; }
	const out: Dot[] = [];
	const half = DOT_SPACING_M / 2;
	let segment = 0, segmentStart = 0;
	for (let along = half; along <= total - half + 1e-6; along += DOT_SPACING_M) {
		while (segment < lengths.length - 1 && segmentStart + lengths[segment] < along) { segmentStart += lengths[segment]; segment++; }
		const t = lengths[segment] > 0 ? (along - segmentStart) / lengths[segment] : 0;
		const a = line[segment], b = line[segment + 1];
		const pos: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
		const id = dotId(pos);
		out.push({ id, pos, pellet: isPellet(id) });
	}
	return out;
}

/**
 * The dots of a whole tile's roads, each only once. A road is a flat list: lng, lat, lng, lat, … With `bounds` (west,
 * south, east, north), only dots inside them are kept: roads reach a little past a tile's edge, and the next tile has
 * those dots.
 */
export function dotsFromWays(ways: readonly (readonly number[])[], bounds?: readonly [number, number, number, number]): Dot[] {
	const byId = new Map<number, Dot>();
	for (const way of ways) {
		if (!Array.isArray(way) || way.length < 4) continue;
		const line: LngLat[] = [];
		for (let i = 0; i + 1 < way.length; i += 2) if (Number.isFinite(way[i]) && Number.isFinite(way[i + 1])) line.push([way[i], way[i + 1]]);
		for (const dot of dotsAlong(line)) if (!byId.has(dot.id) && (!bounds || (dot.pos[0] >= bounds[0] && dot.pos[0] < bounds[2] && dot.pos[1] >= bounds[1] && dot.pos[1] < bounds[3]))) byId.set(dot.id, dot);
	}
	return [...byId.values()];
}

// ── The game ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PacmanSaved {
	version: 1;
	startedAt: number;
	score: number;
	dots: number;
	pellets: number;
	bestStreak: number;
	/** How many times a ghost has caught the car, and how many ghosts the car has eaten. */
	caught?: number;
	ghostsEaten?: number;
	/** How many bonus fruit the car has eaten. */
	fruit?: number;
	today: { day: string; dots: number };
	bestDay: { day: string; dots: number };
	/** Eaten dots as pairs: id, then the minute (since 1970) it was eaten. */
	eaten: number[];
}

export interface PacmanSummary {
	score: number;
	dots: number;
	pellets: number;
	streak: number;
	bestStreak: number;
	caught: number;
	ghostsEaten: number;
	fruit: number;
	multiplier: number;
	today: number;
	bestDay: number;
	startedAt: number;
}

export interface EatResult { eaten: Dot[]; points: number; pellets: number; /** The points from the big dots alone. */ pelletPoints: number; multiplier: number; multiplierUp: boolean }

const dayOf = (time: number): string => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const finite = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

export class Pacman {
	/** Dots on the loaded tiles, by id, and how many loaded tiles hold each. */
	private dots = new Map<number, { dot: Dot; tiles: number }>();
	private tiles = new Map<string, number[]>();
	/** Loaded dots by the cell (zoom 20) they are in, to find those near a point. */
	private buckets = new Map<number, Set<number>>();
	private eaten = new Map<number, number>();
	regrow: Regrow = DEFAULT_REGROW;
	startedAt = Date.now();
	score = 0;
	dotsEaten = 0;
	pelletsEaten = 0;
	streak = 0;
	bestStreak = 0;
	caughtCount = 0;
	ghostsEatenCount = 0;
	fruitCount = 0;
	private lastEatAt = 0;
	private today = { day: "", dots: 0 };
	private bestDay = { day: "", dots: 0 };

	// Tiles ───────────────────────────────────────────────────────────────────────────────────────────────
	hasTile(key: string): boolean { return this.tiles.has(key); }
	get tileCount(): number { return this.tiles.size; }
	loadedTiles(): string[] { return [...this.tiles.keys()]; }

	addTile(key: string, dots: readonly Dot[]): void {
		if (this.tiles.has(key)) return;
		const ids: number[] = [];
		for (const dot of dots) {
			const have = this.dots.get(dot.id);
			if (have) have.tiles++;
			else { this.dots.set(dot.id, { dot, tiles: 1 }); this.bucket(dot).add(dot.id); }
			ids.push(dot.id);
		}
		this.tiles.set(key, ids);
	}

	removeTile(key: string): void {
		const ids = this.tiles.get(key);
		if (!ids) return;
		this.tiles.delete(key);
		for (const id of ids) {
			const have = this.dots.get(id);
			if (!have || --have.tiles > 0) continue;
			this.dots.delete(id);
			const bucket = this.buckets.get(this.bucketKey(have.dot.pos));
			bucket?.delete(id);
			if (bucket && !bucket.size) this.buckets.delete(this.bucketKey(have.dot.pos));
		}
	}

	private bucketKey(pos: LngLat): number { const [x, y] = toCellSpace(pos); return cellKey(Math.floor(x), Math.floor(y)); }
	private bucket(dot: Dot): Set<number> {
		const key = this.bucketKey(dot.pos);
		let set = this.buckets.get(key);
		if (!set) this.buckets.set(key, set = new Set());
		return set;
	}

	// Eaten dots ──────────────────────────────────────────────────────────────────────────────────────────
	/** Whether a dot is there to eat: not eaten, or eaten long enough ago to have grown back. */
	isAvailable(id: number, now: number): boolean {
		const at = this.eaten.get(id);
		if (at === undefined) return true;
		const regrow = REGROW_MS[this.regrow];
		return regrow !== null && now - at >= regrow;
	}

	/** The dots to eat within `radiusM` of a point (what the map draws). */
	dotsNear(center: LngLat, radiusM: number, now: number): Dot[] {
		const out: Dot[] = [];
		// Flat metres: far quicker than true distances, and exact enough at these ranges.
		const mx = 111_320 * Math.cos((center[1] * Math.PI) / 180), my = 110_540;
		const limit = radiusM * radiusM;
		for (const { dot } of this.dots.values()) {
			const dx = (dot.pos[0] - center[0]) * mx, dy = (dot.pos[1] - center[1]) * my;
			if (dx * dx + dy * dy <= limit && this.isAvailable(dot.id, now)) out.push(dot);
		}
		return out;
	}

	/** How many dots are left to eat within `radiusM` of a point. */
	countNear(center: LngLat, radiusM: number, now: number): number { return this.dotsNear(center, radiusM, now).length; }

	/**
	 * The car has gone from `from` to `to` (null at the start of a drive): eats every dot within EAT_RADIUS_M of that
	 * path, so none is skipped between two fixes at speed.
	 */
	eatAlong(from: LngLat | null, to: LngLat, now: number): EatResult {
		const result: EatResult = { eaten: [], points: 0, pellets: 0, pelletPoints: 0, multiplier: multiplierFor(this.streak), multiplierUp: false };
		const step = from ? distanceM(from, to) : 0;
		const start = from && step <= MAX_STEP_M ? from : to;
		// Flat metres around the path.
		const mx = 111_320 * Math.cos((to[1] * Math.PI) / 180), my = 110_540;
		const ax = (start[0] - to[0]) * mx, ay = (start[1] - to[1]) * my;
		const length2 = ax * ax + ay * ay;
		const near = (pos: LngLat): boolean => {
			const px = (pos[0] - to[0]) * mx, py = (pos[1] - to[1]) * my;
			// Distance from the point to the segment from (ax, ay) to the origin.
			const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * -ax + (py - ay) * -ay) / length2)) : 1;
			const dx = px - (ax + (0 - ax) * t), dy = py - (ay + (0 - ay) * t);
			return dx * dx + dy * dy <= EAT_RADIUS_M * EAT_RADIUS_M;
		};
		const candidates = new Set<number>();
		const samples = Math.max(1, Math.ceil(Math.min(step, MAX_STEP_M) / SAMPLE_M));
		for (let i = 0; i <= samples; i++) {
			const t = i / samples;
			const [x, y] = toCellSpace([start[0] + (to[0] - start[0]) * t, start[1] + (to[1] - start[1]) * t]);
			for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (const id of this.buckets.get(cellKey(Math.floor(x) + dx, Math.floor(y) + dy)) ?? []) candidates.add(id);
		}
		const hits: Dot[] = [];
		for (const id of candidates) {
			const have = this.dots.get(id);
			if (have && this.isAvailable(id, now) && near(have.dot.pos)) hits.push(have.dot);
		}
		// In the order the car met them, so the run builds the way it was driven.
		hits.sort((a, b) => distanceM(start, a.pos) - distanceM(start, b.pos));
		for (const dot of hits) {
			if (now - this.lastEatAt > STREAK_GAP_MS) this.streak = 0;
			this.lastEatAt = now;
			const before = multiplierFor(this.streak);
			this.streak++;
			const multiplier = multiplierFor(this.streak);
			if (multiplier > before) result.multiplierUp = true;
			const points = (dot.pellet ? POINTS_PELLET : POINTS_DOT) * multiplier;
			this.eaten.set(dot.id, now);
			this.score += points;
			this.dotsEaten++;
			if (dot.pellet) this.pelletsEaten++;
			const day = dayOf(now);
			if (this.today.day !== day) this.today = { day, dots: 0 };
			this.today.dots++;
			if (this.today.dots > this.bestDay.dots) this.bestDay = { day, dots: this.today.dots };
			this.bestStreak = Math.max(this.bestStreak, this.streak);
			result.eaten.push(dot);
			result.points += points;
			if (dot.pellet) { result.pellets++; result.pelletPoints += points; }
			result.multiplier = multiplier;
		}
		return result;
	}

	/** A ghost caught the car: the run is over and some points are lost. Returns the points lost. */
	caughtByGhost(): number {
		const lost = Math.min(this.score, GHOST_PENALTY);
		this.score -= lost;
		this.streak = 0;
		this.lastEatAt = 0;
		this.caughtCount++;
		return lost;
	}

	/** The car ate a ghost: its points are added (they do not touch the run). */
	ateGhost(points: number): void {
		this.score += points;
		this.ghostsEatenCount++;
	}

	/** The car ate a bonus fruit: its points are added (they do not touch the run). */
	ateFruit(points: number): void {
		this.score += points;
		this.fruitCount++;
	}

	/** The run is over once this long has passed with no dot eaten (checked by the screen as well as by eating). */
	liveStreak(now: number): number { return now - this.lastEatAt > STREAK_GAP_MS ? 0 : this.streak; }

	summary(now: number): PacmanSummary {
		const streak = this.liveStreak(now);
		return { score: this.score, dots: this.dotsEaten, pellets: this.pelletsEaten, streak, bestStreak: this.bestStreak, caught: this.caughtCount, ghostsEaten: this.ghostsEatenCount, fruit: this.fruitCount, multiplier: multiplierFor(streak), today: this.today.day === dayOf(now) ? this.today.dots : 0, bestDay: this.bestDay.dots, startedAt: this.startedAt };
	}

	/** Forgets everything: score, stats and eaten dots. The loaded tiles stay. */
	reset(): void {
		this.eaten.clear();
		this.score = this.dotsEaten = this.pelletsEaten = this.streak = this.bestStreak = this.caughtCount = this.ghostsEatenCount = this.fruitCount = this.lastEatAt = 0;
		this.today = { day: "", dots: 0 };
		this.bestDay = { day: "", dots: 0 };
		this.startedAt = Date.now();
	}

	// Saving ──────────────────────────────────────────────────────────────────────────────────────────────
	/** Dots that have already grown back are left out, so the file only holds what is still eaten. */
	toJSON(now = Date.now()): PacmanSaved {
		const regrow = REGROW_MS[this.regrow];
		const eaten: number[] = [];
		for (const [id, at] of this.eaten) if (regrow === null || now - at < regrow) eaten.push(id, Math.floor(at / 60_000));
		return { version: 1, startedAt: this.startedAt, score: this.score, dots: this.dotsEaten, pellets: this.pelletsEaten, bestStreak: this.bestStreak, caught: this.caughtCount, ghostsEaten: this.ghostsEatenCount, fruit: this.fruitCount, today: { ...this.today }, bestDay: { ...this.bestDay }, eaten };
	}

	static canRead(data: unknown): boolean {
		return !!data && typeof data === "object" && (data as { version?: unknown }).version === 1 && Array.isArray((data as { eaten?: unknown }).eaten);
	}

	static fromJSON(data: unknown, regrow: Regrow = DEFAULT_REGROW): Pacman {
		const game = new Pacman();
		game.regrow = regrow;
		if (!Pacman.canRead(data)) return game;
		const saved = data as Partial<PacmanSaved>;
		game.startedAt = finite(saved.startedAt, Date.now());
		game.score = finite(saved.score);
		game.dotsEaten = finite(saved.dots);
		game.pelletsEaten = finite(saved.pellets);
		game.bestStreak = finite(saved.bestStreak);
		game.caughtCount = finite(saved.caught);
		game.ghostsEatenCount = finite(saved.ghostsEaten);
		game.fruitCount = finite(saved.fruit);
		const day = (value: unknown) => ({ day: typeof (value as { day?: unknown })?.day === "string" ? (value as { day: string }).day : "", dots: finite((value as { dots?: unknown })?.dots) });
		game.today = day(saved.today);
		game.bestDay = day(saved.bestDay);
		const eaten = saved.eaten ?? [];
		for (let i = 0; i + 1 < eaten.length; i += 2) if (Number.isFinite(eaten[i]) && Number.isFinite(eaten[i + 1])) game.eaten.set(eaten[i], eaten[i + 1] * 60_000);
		return game;
	}
}
