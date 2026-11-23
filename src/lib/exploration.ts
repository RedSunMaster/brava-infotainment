/**
 * Explore mode: which parts of the world this driver has seen.
 *
 * The world is cut into Web Mercator cells at zoom 20 (about 28 m across in Christchurch). Every real GPS fix uncovers
 * the cells within line of sight of the road just driven (REVEAL_RADIUS_M either side). When a drive comes back round
 * to where it was earlier, the loop it drew is closed and everything inside it is uncovered too, so a park or a block
 * you drove right round is discovered even though you never drove through the middle. Loops bigger than
 * MAX_LOOP_AREA_M2 are ignored, so a ring road does not uncover a whole town.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */
import type { Milestone } from "./milestones";

export type LngLat = [number, number];

export const CELL_ZOOM = 20;
/** Cells along one side of the world. */
export const CELLS = 2 ** CELL_ZOOM;
/** How far either side of the road counts as seen. */
export const REVEAL_RADIUS_M = 50;
/** The biggest loop that fills in. About a square kilometre: a big park, never a whole suburb. */
export const MAX_LOOP_AREA_M2 = 1_000_000;
/** Smaller loops (a U-turn, a roundabout) uncover nothing that line of sight has not already. */
const MIN_LOOP_AREA_M2 = 3_000;
/** A loop closes when the car comes back within this distance of where it has been. */
const CLOSE_M = 35;
/** Track driven before a loop can close, so the last few metres never count as a loop. */
const MIN_LOOP_LENGTH_M = 300;
/** After a loop fills, driving on this far before the next one can close (the same closure is not found again). */
const LOOP_COOLDOWN_M = 120;
/** Fixes closer together than this are the car standing still. */
const MIN_STEP_M = 8;
/** A longer jump (or a longer silence) is a GPS gap: the two ends are not joined up. */
const MAX_JOIN_M = 2_000;
const MAX_JOIN_MS = 120_000;
/** How much of the current drive is kept for finding loops. */
const MAX_TRACK_M = 20_000;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const EARTH_RADIUS_M = 6_371_008.8;

export const cellKey = (x: number, y: number): number => x * CELLS + y;
export const cellX = (key: number): number => Math.floor(key / CELLS);
export const cellY = (key: number): number => key % CELLS;

/** Position in cell units (fractional): x grows east, y grows south. */
export function toCellSpace([lng, lat]: LngLat): [number, number] {
	const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
	const sin = Math.sin((clamped * Math.PI) / 180);
	const x = ((lng + 180) / 360) * CELLS;
	const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * CELLS;
	return [x, y];
}

export function fromCellSpace(x: number, y: number): LngLat {
	const lng = (x / CELLS) * 360 - 180;
	const n = Math.PI - (2 * Math.PI * y) / CELLS;
	return [lng, (180 / Math.PI) * Math.atan(Math.sinh(n))];
}

/** The centre of a cell. */
export const cellCenter = (key: number): LngLat => fromCellSpace(cellX(key) + 0.5, cellY(key) + 0.5);

/** Metres across one cell at this latitude. */
export const metersPerCell = (lat: number): number => (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / CELLS;

/** The ground area of one cell at this latitude, in square metres. */
export const cellAreaM2 = (lat: number): number => metersPerCell(lat) ** 2;

export function distanceM(a: LngLat, b: LngLat): number {
	const toRad = Math.PI / 180;
	const dLat = (b[1] - a[1]) * toRad;
	const dLng = (b[0] - a[0]) * toRad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance (squared) from point p to segment ab, all in the same flat units. */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax, dy = by - ay;
	const length2 = dx * dx + dy * dy;
	const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
	const cx = ax + t * dx - px, cy = ay + t * dy - py;
	return cx * cx + cy * cy;
}

/** Where segments ab and cd cross, as a fraction along ab, or null. */
function crossing(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number | null {
	const rX = bx - ax, rY = by - ay, sX = dx - cx, sY = dy - cy;
	const denominator = rX * sY - rY * sX;
	if (Math.abs(denominator) < 1e-12) return null;
	const t = ((cx - ax) * sY - (cy - ay) * sX) / denominator;
	const u = ((cx - ax) * rY - (cy - ay) * rX) / denominator;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Area of a ring given in cell units, in square cells (always positive). */
function ringArea(ring: [number, number][]): number {
	let sum = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
	return Math.abs(sum) / 2;
}

/** Every cell whose centre lies inside the ring (given in cell units), by scanning each row of cells. */
export function cellsInRing(ring: [number, number][]): number[] {
	const out: number[] = [];
	if (ring.length < 3) return out;
	let minY = Infinity, maxY = -Infinity;
	for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
	for (let row = Math.floor(minY); row <= Math.ceil(maxY); row++) {
		const y = row + 0.5;
		const xs: number[] = [];
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [x1, y1] = ring[j], [x2, y2] = ring[i];
			if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
		}
		xs.sort((a, b) => a - b);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			for (let col = Math.ceil(xs[k] - 0.5); col + 0.5 <= xs[k + 1]; col++) out.push(cellKey(col, row));
		}
	}
	return out;
}

export interface DiscoveredPlace {
	id: string;
	name: string;
	/** A suburb, town or city from the map's place names, or an area uncovered by driving round it. */
	kind: "neighborhood" | "locality" | "place" | "area";
	coords: LngLat;
	at: number;
	/** For areas: how much the loop uncovered. */
	areaM2?: number;
}

export interface FixResult {
	/** Cells uncovered by this fix (line of sight and any loop). */
	added: number[];
	/** Set when this fix closed a loop that uncovered something. */
	loop?: { ring: LngLat[]; centroid: LngLat; areaM2: number; added: number[] };
}

interface TrackPoint { pos: LngLat; x: number; y: number; along: number }

/** 2: zoom 20 cells. 1 (zoom 19 cells) is still read: each old cell becomes its four new ones. */
const SAVE_VERSION = 2;
export interface SavedExploration {
	v: number;
	/** Sorted cell keys, each stored as the gap from the one before, to keep the file small. */
	cells: number[];
	distanceM: number;
	newDistanceM: number;
	places: DiscoveredPlace[];
	startedAt: number;
	/** Added later: older saves have none (their milestones are then filled in quietly, without popups). */
	milestones?: Milestone[];
	/** Suburbs driven in that have an outline (the outlines themselves are kept separately, shared by all profiles). */
	suburbs?: VisitedSuburb[];
}

export interface VisitedSuburb { id: string; name: string; at: number }

export class Explorer {
	readonly cells = new Set<number>();
	/** Explored ground, in square metres. */
	areaM2 = 0;
	/** Everything driven with a GPS fix since recording began. */
	distanceM = 0;
	/** The part of that distance that was on roads not seen before. */
	newDistanceM = 0;
	places: DiscoveredPlace[] = [];
	startedAt = Date.now();
	milestones: Milestone[] = [];
	suburbs: VisitedSuburb[] = [];
	/** False for a map saved before milestones existed, until the ones it had already reached are filled in. */
	milestonesKnown = true;
	private track: TrackPoint[] = [];
	private lastTime = 0;
	/** Distance driven since this drive last uncovered anything; credited as new road once it does. */
	private sinceNew = 0;
	private loopCooldownUntil = 0;

	/** Records one real GPS fix. */
	addFix(pos: LngLat, time = Date.now()): FixResult {
		const added: number[] = [];
		const last = this.track[this.track.length - 1];
		const [x, y] = toCellSpace(pos);
		if (last) {
			const step = distanceM(last.pos, pos);
			if (time - this.lastTime > MAX_JOIN_MS || step > MAX_JOIN_M) {
				this.track = [];
			} else if (step < MIN_STEP_M) {
				this.lastTime = time;
				return { added };
			}
		}
		const previous = this.track[this.track.length - 1];
		this.lastTime = time;
		if (previous) {
			const step = distanceM(previous.pos, pos);
			this.distanceM += step;
			this.reveal(previous, { pos, x, y, along: 0 }, added);
			// On a new road every few metres uncovers more ground ahead; on a known road nothing does. Cells are bigger
			// than one step, so a step that adds nothing still counts if the next one or two do.
			this.sinceNew += step;
			if (added.length) { this.newDistanceM += this.sinceNew; this.sinceNew = 0; }
			else if (this.sinceNew > 3 * metersPerCell(pos[1])) this.sinceNew = 0;
		} else {
			this.sinceNew = 0;
			this.reveal({ pos, x, y, along: 0 }, { pos, x, y, along: 0 }, added);
		}
		const point: TrackPoint = { pos, x, y, along: previous ? previous.along + distanceM(previous.pos, pos) : 0 };
		this.track.push(point);
		const loop = this.closeLoop(point);
		if (loop) added.push(...loop.added);
		while (this.track.length > 2 && point.along - this.track[0].along > MAX_TRACK_M) this.track.shift();
		return loop ? { added, loop } : { added };
	}

	/** Forgets the drive in progress (so a loop never joins two separate drives). */
	endDrive(): void { this.track = []; }

	/** Marks a cell as explored. True when it was new. */
	add(key: number): boolean {
		if (this.cells.has(key)) return false;
		this.cells.add(key);
		this.areaM2 += cellAreaM2(cellCenter(key)[1]);
		return true;
	}

	/** Cells within line of sight of segment a→b. */
	private reveal(a: TrackPoint, b: TrackPoint, added: number[]): void {
		const radius = REVEAL_RADIUS_M / metersPerCell((a.pos[1] + b.pos[1]) / 2);
		const radius2 = radius * radius;
		const minX = Math.floor(Math.min(a.x, b.x) - radius), maxX = Math.floor(Math.max(a.x, b.x) + radius);
		const minY = Math.floor(Math.min(a.y, b.y) - radius), maxY = Math.floor(Math.max(a.y, b.y) + radius);
		for (let cx = minX; cx <= maxX; cx++) {
			for (let cy = minY; cy <= maxY; cy++) {
				if (segmentDistance2(cx + 0.5, cy + 0.5, a.x, a.y, b.x, b.y) > radius2) continue;
				const key = cellKey(cx, cy);
				if (this.add(key)) added.push(key);
			}
		}
	}

	/** If the newest point comes back to the track driven earlier, fills the loop between them. */
	private closeLoop(point: TrackPoint): FixResult["loop"] {
		const n = this.track.length;
		if (n < 4 || point.along < this.loopCooldownUntil) return undefined;
		const previous = this.track[n - 2];
		const close = CLOSE_M / metersPerCell(point.pos[1]);
		// The newest earlier segment the car crossed or came back to: the smallest loop just closed.
		for (let i = n - 3; i >= 1; i--) {
			const a = this.track[i - 1], b = this.track[i];
			if (point.along - b.along < MIN_LOOP_LENGTH_M) continue;
			const t = crossing(previous.x, previous.y, point.x, point.y, a.x, a.y, b.x, b.y);
			const near = t === null && segmentDistance2(point.x, point.y, a.x, a.y, b.x, b.y) <= close * close;
			if (t === null && !near) continue;
			const ring: [number, number][] = this.track.slice(i, n - (t === null ? 0 : 1)).map(p => [p.x, p.y]);
			if (t !== null) ring.push([previous.x + t * (point.x - previous.x), previous.y + t * (point.y - previous.y)]);
			const areaM2 = ringArea(ring) * metersPerCell(point.pos[1]) ** 2;
			if (areaM2 < MIN_LOOP_AREA_M2 || areaM2 > MAX_LOOP_AREA_M2) return undefined;
			const added = cellsInRing(ring).filter(key => this.add(key));
			this.loopCooldownUntil = point.along + LOOP_COOLDOWN_M;
			if (!added.length) return undefined;
			let sx = 0, sy = 0;
			for (const [rx, ry] of ring) { sx += rx; sy += ry; }
			return { ring: ring.map(([rx, ry]) => fromCellSpace(rx, ry)), centroid: fromCellSpace(sx / ring.length, sy / ring.length), areaM2, added };
		}
		return undefined;
	}

	/** Remembers a place. False if it was already discovered. */
	discover(place: DiscoveredPlace): boolean {
		if (this.places.some(item => item.id === place.id)) return false;
		this.places.push(place);
		return true;
	}

	hasPlace(id: string): boolean { return this.places.some(item => item.id === id); }

	/** Remembers a suburb driven in. False if it was already known. */
	visitSuburb(suburb: VisitedSuburb): boolean {
		if (this.suburbs.some(item => item.id === suburb.id)) return false;
		this.suburbs.push(suburb);
		return true;
	}

	/** Records milestones reached. Returns the ones that were new. */
	reach(milestones: Milestone[]): Milestone[] {
		const known = new Set(this.milestones.map(item => item.id));
		const added = milestones.filter(item => !known.has(item.id) && (known.add(item.id), true));
		this.milestones.push(...added);
		return added;
	}

	/** The share (0–1) of the land within radiusM of a point that has been explored. */
	shareAround(center: LngLat, radiusM: number): number {
		const [x, y] = toCellSpace(center);
		const radius = radiusM / metersPerCell(center[1]);
		let total = 0, seen = 0;
		for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
			for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
				if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > radius * radius) continue;
				total++;
				if (this.cells.has(cellKey(cx, cy))) seen++;
			}
		}
		return total ? seen / total : 0;
	}

	reset(): void {
		this.cells.clear();
		this.areaM2 = 0;
		this.distanceM = 0;
		this.newDistanceM = 0;
		this.places = [];
		this.milestones = [];
		this.suburbs = [];
		this.milestonesKnown = true;
		this.track = [];
		this.startedAt = Date.now();
		this.loopCooldownUntil = 0;
	}

	toJSON(): SavedExploration {
		const sorted = [...this.cells].sort((a, b) => a - b);
		const deltas = sorted.map((key, i) => (i === 0 ? key : key - sorted[i - 1]));
		return { v: SAVE_VERSION, cells: deltas, distanceM: this.distanceM, newDistanceM: this.newDistanceM, places: this.places, startedAt: this.startedAt, milestones: this.milestones, suburbs: this.suburbs };
	}

	/** Whether saved data is a map this version can read (anything else must never be saved over). */
	static canRead(data: unknown): boolean {
		const v = (data as Partial<SavedExploration> | null)?.v;
		return v === SAVE_VERSION || v === 1;
	}

	/** Adds everything another explorer has (explored while the saved map could not be read) into this one. */
	merge(other: Explorer): void {
		for (const key of other.cells) this.add(key);
		this.distanceM += other.distanceM;
		this.newDistanceM += other.newDistanceM;
		for (const place of other.places) this.discover(place);
		for (const suburb of other.suburbs) this.visitSuburb(suburb);
		this.reach(other.milestones);
	}

	static fromJSON(data: unknown): Explorer {
		const explorer = new Explorer();
		const saved = data as Partial<SavedExploration> | null;
		if (!saved || (saved.v !== SAVE_VERSION && saved.v !== 1)) return explorer;
		if (Array.isArray(saved.cells)) {
			// Version 1 was a zoom coarser: its cells are a quarter as many, each covering four of today's.
			const coarse = saved.v === 1;
			const side = coarse ? CELLS / 2 : CELLS;
			let key = 0;
			for (const delta of saved.cells) {
				if (!Number.isSafeInteger(delta) || delta < 0) break;
				key += delta;
				if (key >= side * side) break;
				if (!coarse) { explorer.add(key); continue; }
				const x = Math.floor(key / side) * 2, y = (key % side) * 2;
				for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) explorer.add(cellKey(x + dx, y + dy));
			}
		}
		const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
		explorer.distanceM = finite(saved.distanceM);
		explorer.newDistanceM = finite(saved.newDistanceM);
		if (typeof saved.startedAt === "number" && Number.isFinite(saved.startedAt)) explorer.startedAt = saved.startedAt;
		if (Array.isArray(saved.places)) {
			explorer.places = saved.places.filter((item): item is DiscoveredPlace => !!item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.coords) && item.coords.length === 2 && item.coords.every(Number.isFinite) && typeof item.at === "number");
		}
		if (Array.isArray(saved.milestones)) {
			explorer.milestones = saved.milestones.filter((item): item is Milestone => !!item && typeof item.id === "string" && typeof item.title === "string" && typeof item.kind === "string" && typeof item.at === "number");
		} else explorer.milestonesKnown = false;
		if (Array.isArray(saved.suburbs)) {
			explorer.suburbs = saved.suburbs.filter((item): item is VisitedSuburb => !!item && typeof item.id === "string" && typeof item.name === "string" && typeof item.at === "number");
		}
		return explorer;
	}
}
