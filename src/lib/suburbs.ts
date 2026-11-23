/**
 * Suburb outlines for Explore mode's progress ("Northwood 34% explored"), from OpenStreetMap.
 *
 * An outline is looked up once when the car enters a suburb it has no outline for, then kept. Progress is the share of
 * the suburb's cells (the same zoom 20 cells the explored map uses) that have been explored. Not all of a suburb can be
 * seen from its roads, so a suburb counts as fully explored at FULLY_EXPLORED.
 *
 * Pure logic with no map or storage, so it can be tested on its own.
 */
import { CELLS, cellKey, toCellSpace, type LngLat } from "./exploration";

/** The share of a suburb that counts as all of it: the backs of the biggest sections can never be seen from a road. */
export const FULLY_EXPLORED = 0.9;
/** Outlines bigger than this are a rural district or a whole town, not a suburb: no progress is kept for them. */
const MAX_AREA_M2 = 30_000_000;
/** OpenStreetMap place kinds that count as a suburb. */
const SUBURB_TYPES = new Set(["suburb", "neighbourhood", "quarter", "village", "town", "hamlet", "isolated_dwelling", "locality", "city_district", "borough"]);

export interface SuburbOutline {
	/** OpenStreetMap's id, such as "relation:2726686". */
	id: string;
	name: string;
	/** Polygon rings (outer rings and holes together), as longitude and latitude. */
	rings: LngLat[][];
	/** West, south, east, north. */
	bbox: [number, number, number, number];
}

type Geometry = { type?: string; coordinates?: unknown };
interface NominatimResult { osm_type?: unknown; osm_id?: unknown; name?: unknown; addresstype?: unknown; type?: unknown; geojson?: Geometry }

const isPoint = (value: unknown): value is LngLat => Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
const isRing = (value: unknown): value is LngLat[] => Array.isArray(value) && value.length >= 4 && value.every(isPoint);

/** The suburb in a Nominatim reverse lookup (made with polygon_geojson), or null if it found none worth tracking. */
export function outlineFromNominatim(data: unknown): SuburbOutline | null {
	const result = data as NominatimResult | null;
	if (!result || typeof result.name !== "string" || !result.name.trim()) return null;
	const kind = typeof result.addresstype === "string" ? result.addresstype : typeof result.type === "string" ? result.type : "";
	if (!SUBURB_TYPES.has(kind)) return null;
	const geometry = result.geojson;
	const polygons: unknown[] = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
	const rings: LngLat[][] = [];
	for (const polygon of polygons) if (Array.isArray(polygon)) for (const ring of polygon) if (isRing(ring)) rings.push(ring.map(([lng, lat]) => [lng, lat] as LngLat));
	if (!rings.length) return null;
	let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
	for (const ring of rings) for (const [lng, lat] of ring) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
	// Across the date line, or far too big: not a suburb.
	if (east - west > 1 || north - south > 1) return null;
	const outline: SuburbOutline = { id: `${String(result.osm_type)}:${String(result.osm_id)}`, name: result.name.trim(), rings, bbox: [west, south, east, north] };
	if (areaM2(outline) > MAX_AREA_M2) return null;
	return outline;
}

/** Whether a point is inside an outline (holes excluded). */
export function contains(outline: SuburbOutline, [lng, lat]: LngLat): boolean {
	const [west, south, east, north] = outline.bbox;
	if (lng < west || lng > east || lat < south || lat > north) return false;
	let inside = false;
	for (const ring of outline.rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i], [xj, yj] = ring[j];
			if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}

/**
 * Every cell whose centre is inside an outline, row by row: where each row's centre line crosses the rings, the cells
 * between alternate crossings are inside (so holes are left out).
 */
export function cellsInside(outline: SuburbOutline): number[] {
	const rings = outline.rings.map(ring => ring.map(toCellSpace));
	let top = Infinity, bottom = -Infinity;
	for (const ring of rings) for (const [, y] of ring) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
	const out: number[] = [];
	for (let row = Math.floor(top); row <= Math.ceil(bottom); row++) {
		const y = row + 0.5;
		const crossings: number[] = [];
		for (const ring of rings) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [xi, yi] = ring[i], [xj, yj] = ring[j];
				if ((yi > y) !== (yj > y)) crossings.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
			}
		}
		crossings.sort((a, b) => a - b);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			// Cells whose centres (column + 0.5) fall between the two crossings.
			for (let column = Math.ceil(crossings[k] - 0.5); column + 0.5 < crossings[k + 1]; column++) {
				if (column >= 0 && column < CELLS && row >= 0 && row < CELLS) out.push(cellKey(column, row));
			}
		}
	}
	return out;
}

/** The outline's area on the ground, roughly (good to a few per cent at suburb size). */
export function areaM2(outline: SuburbOutline): number {
	const midLat = (outline.bbox[1] + outline.bbox[3]) / 2;
	const mLng = 111_320 * Math.cos((midLat * Math.PI) / 180), mLat = 110_574;
	let area = 0;
	for (const ring of outline.rings) {
		let sum = 0;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * mLng * ring[i][1] * mLat - ring[i][0] * mLng * ring[j][1] * mLat;
		area += Math.abs(sum) / 2;
	}
	// Holes are added rather than taken away here; they are rare and small, and this only screens out huge outlines.
	return area;
}

/**
 * Progress through a suburb, 0 to 1, from its cells: the share explored, scaled so FULLY_EXPLORED of the ground is 1
 * (all of it that can be seen).
 */
export function shareExplored(cells: readonly number[], explored: ReadonlySet<number>): number {
	if (!cells.length) return 0;
	let seen = 0;
	for (const key of cells) if (explored.has(key)) seen++;
	return Math.min(1, seen / cells.length / FULLY_EXPLORED);
}
