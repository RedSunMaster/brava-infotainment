/**
 * A map of the roads for the ghosts to move along: junctions and the points along each road as nodes, the stretches
 * between them as edges. Two roads are joined only where they share a point (as at a junction), so a bridge over another
 * road stays apart from it. Long stretches are cut into short pieces, so a car (or a ghost) is never far from a node.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */
import type { LngLat } from "./exploration";

/** Longest stretch between two nodes, in metres. */
export const MAX_EDGE_M = 10;
/**
 * A road that ends within this distance of another road is joined to it: the map's tiles often leave out the point on the
 * main road where a side street meets it, so the side street stops a little short.
 */
export const JOIN_M = 9;
/** Points this close (about a metre) are the same point: the same junction seen from two map tiles. */
const SNAP = 1e5;
/** Spatial grid for finding the node nearest a place, in degrees (about 50 m). */
const CELL = 0.0005;

const DEG_LAT_M = 110_540;
const metresPerDegLng = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180);

export interface Reach {
	/** Road distance in metres from the start, for every node reached. */
	dist: Map<number, number>;
}

export class RoadGraph {
	nodes: LngLat[] = [];
	/** Neighbours of each node and the distance to each. */
	adj: { to: number; len: number }[][] = [];
	private ids = new Map<string, number>();
	private edges = new Set<string>();
	private grid = new Map<string, number[]>();

	get size(): number { return this.nodes.length; }

	private nodeAt(lng: number, lat: number): number {
		const key = `${Math.round(lng * SNAP)},${Math.round(lat * SNAP)}`;
		let id = this.ids.get(key);
		if (id === undefined) {
			id = this.nodes.length;
			this.ids.set(key, id);
			this.nodes.push([lng, lat]);
			this.adj.push([]);
			const cell = `${Math.floor(lng / CELL)},${Math.floor(lat / CELL)}`;
			const list = this.grid.get(cell);
			if (list) list.push(id); else this.grid.set(cell, [id]);
		}
		return id;
	}

	private connect(a: number, b: number): void {
		if (a === b) return;
		const key = a < b ? `${a}-${b}` : `${b}-${a}`;
		if (this.edges.has(key)) return;
		this.edges.add(key);
		const len = distance(this.nodes[a], this.nodes[b]);
		this.adj[a].push({ to: b, len });
		this.adj[b].push({ to: a, len });
	}

	/** Adds roads, each a flat list: lng, lat, lng, lat, … */
	addWays(ways: readonly (readonly number[])[]): void {
		const firstNew = this.nodes.length;
		for (const way of ways) {
			let previous: LngLat | null = null;
			let previousNode = -1;
			for (let i = 0; i + 1 < way.length; i += 2) {
				const lng = way[i], lat = way[i + 1];
				if (!Number.isFinite(lng) || !Number.isFinite(lat)) { previous = null; continue; }
				const here: LngLat = [lng, lat];
				if (previous) {
					// A long stretch is cut into pieces no longer than MAX_EDGE_M.
					const pieces = Math.max(1, Math.ceil(distance(previous, here) / MAX_EDGE_M));
					let from = previousNode;
					for (let k = 1; k <= pieces; k++) {
						const t = k / pieces;
						const node = k === pieces ? this.nodeAt(lng, lat) : this.nodeAt(previous[0] + (lng - previous[0]) * t, previous[1] + (lat - previous[1]) * t);
						this.connect(from, node);
						from = node;
					}
					previousNode = from;
				} else previousNode = this.nodeAt(lng, lat);
				previous = here;
			}
		}
		this.joinDeadEnds(firstNew);
	}

	/** Joins roads that stop just short of another road (see JOIN_M), among the nodes added since `from`. */
	private joinDeadEnds(from: number): void {
		for (let id = from; id < this.nodes.length; id++) {
			if (this.adj[id].length !== 1) continue;
			const pos = this.nodes[id];
			const cx = Math.floor(pos[0] / CELL), cy = Math.floor(pos[1] / CELL);
			let best = -1, bestDist = JOIN_M;
			for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
				for (const other of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
					if (other === id || this.adj[id][0].to === other) continue;
					const d = distance(pos, this.nodes[other]);
					if (d < bestDist) { best = other; bestDist = d; }
				}
			}
			if (best >= 0) this.connect(id, best);
		}
	}

	/** The node nearest a place, if one is within `maxM` of it. */
	nearest(pos: LngLat, maxM: number): number | null {
		const cx = Math.floor(pos[0] / CELL), cy = Math.floor(pos[1] / CELL);
		const reach = Math.max(1, Math.ceil(maxM / 45));
		let best: number | null = null, bestDist = maxM;
		for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
			for (const id of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
				const d = distance(pos, this.nodes[id]);
				if (d <= bestDist) { best = id; bestDist = d; }
			}
		}
		return best;
	}

	/** Road distance from a node to every node within `maxM` of it (Dijkstra's search). */
	reach(start: number, maxM: number): Reach {
		const dist = new Map<number, number>([[start, 0]]);
		const heap = new MinHeap();
		heap.push(start, 0);
		while (heap.size) {
			const [node, d] = heap.pop();
			if (d > (dist.get(node) ?? Infinity)) continue;
			for (const edge of this.adj[node]) {
				const next = d + edge.len;
				if (next > maxM || next >= (dist.get(edge.to) ?? Infinity)) continue;
				dist.set(edge.to, next);
				heap.push(edge.to, next);
			}
		}
		return { dist };
	}

	/** The neighbour of `node` that is furthest from the start of `reach` (the way to run from it), not going back to `avoid` unless there is nowhere else. */
	awayFrom(node: number, reach: Reach, avoid = -1): number | null {
		let best: number | null = null, bestScore = -Infinity;
		for (const edge of this.adj[node]) {
			// Roads beyond the search are further than any in it.
			const far = reach.dist.get(edge.to) ?? 1e9;
			// Going back is only a last resort (a dead end), not something to prefer to going on a few metres less far.
			const score = far - (edge.to === avoid ? 15 : 0);
			if (score > bestScore) { best = edge.to; bestScore = score; }
		}
		return best;
	}

	/** The neighbour of `node` that is the way towards the start of `reach` (the shortest road to it), not going back to `avoid`. */
	towards(node: number, reach: Reach, avoid = -1): number | null {
		let best: number | null = null, bestCost = Infinity;
		for (const edge of this.adj[node]) {
			const rest = reach.dist.get(edge.to);
			if (rest === undefined) continue;
			// Turning round is the last resort.
			const cost = rest + (edge.to === avoid ? 60 : 0);
			if (cost < bestCost) { best = edge.to; bestCost = cost; }
		}
		return best;
	}
}

/** Distance between two places in metres (flat-earth, which is exact enough over a few kilometres). */
export function distance(a: LngLat, b: LngLat): number {
	const dx = (b[0] - a[0]) * metresPerDegLng((a[1] + b[1]) / 2), dy = (b[1] - a[1]) * DEG_LAT_M;
	return Math.hypot(dx, dy);
}

/** A bare-bones priority queue of [node, distance]. */
class MinHeap {
	private items: [number, number][] = [];
	get size(): number { return this.items.length; }
	push(node: number, d: number): void {
		const items = this.items;
		items.push([node, d]);
		let i = items.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (items[parent][1] <= items[i][1]) break;
			[items[parent], items[i]] = [items[i], items[parent]];
			i = parent;
		}
	}
	pop(): [number, number] {
		const items = this.items;
		const top = items[0];
		const last = items.pop()!;
		if (items.length) {
			items[0] = last;
			let i = 0;
			for (;;) {
				const left = 2 * i + 1, right = left + 1;
				let smallest = i;
				if (left < items.length && items[left][1] < items[smallest][1]) smallest = left;
				if (right < items.length && items[right][1] < items[smallest][1]) smallest = right;
				if (smallest === i) break;
				[items[smallest], items[i]] = [items[i], items[smallest]];
				i = smallest;
			}
		}
		return top;
	}
}
