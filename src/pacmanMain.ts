import { app, ipcMain } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PbfReader } from "pbf";
import { VectorTile } from "@mapbox/vector-tile";

/**
 * Pac-Man mode's files: one save per profile (score, stats and which dots are eaten), and the roads of each map tile,
 * kept so a tile that has been seen once works offline and is not asked for again.
 *
 * Roads come from Mapbox's own vector tiles (the same roads the map draws, so the dots always line up with them), and
 * only if Mapbox cannot be reached from OpenStreetMap's Overpass service, which asks for polite use, so those lookups go
 * one at a time with a gap between them.
 */
const GAME_FOLDER = () => path.join(app.getPath("userData"), "pacman");
const ROADS_FOLDER = () => path.join(app.getPath("userData"), "pacman-roads-z14");
/** Overpass servers, tried in turn: the main one is often busy (a 502 or 504), and another usually answers. */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const OVERPASS_GAP_MS = 1_500;
/** Mapbox's roads are used as they are for this long, and OpenStreetMap's (the fallback) for a day, then Mapbox is tried again. */
const MAPBOX_FRESH_MS = 60 * 24 * 3600 * 1000;
const OSM_FRESH_MS = 24 * 3600 * 1000;
/** Map tiles are zoom 14 (about 2 km across), the same as src/lib/pacman.ts. */
const TILE_ZOOM = 14;
/** Roads a car can drive on (not paths, tracks or pedestrian streets). */
const OSM_HIGHWAYS = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service";
const MAPBOX_CLASSES = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "street", "street_limited", "service"]);
/** Service roads that are not through roads: driveways, car-park aisles and the like. */
const MAPBOX_SKIP_TYPES = /driveway|parking|drive.?through|emergency|alley/i;

const fileFor = (id: unknown): string | null => typeof id === "string" && /^[a-z0-9_-]{1,40}$/i.test(id) ? path.join(GAME_FOLDER(), `${id}.json`) : null;
const queues = new Map<string, Promise<void>>();

export type PacmanLoad = { status: "ok"; data: unknown } | { status: "missing" } | { status: "error"; message: string };
/** A tile's roads: each a flat list of lng, lat, lng, lat, … */
export interface RoadsTile { fetchedAt: number; source: "mapbox" | "osm"; ways: number[][] }

let overpassQueue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<RoadsTile | null>>();

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The west, south, east and north edges of a zoom-14 tile, in degrees. */
function tileBounds(x: number, y: number): [number, number, number, number] {
	const n = 2 ** TILE_ZOOM;
	const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
	return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

/** The drivable roads in one of Mapbox's vector tiles, or null if it could not be had. */
async function mapboxRoads(tx: number, ty: number, token: string): Promise<number[][] | null> {
	try {
		const response = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${TILE_ZOOM}/${tx}/${ty}.vector.pbf?access_token=${encodeURIComponent(token)}`, { headers: { "User-Agent": `brava-infotainment/${app.getVersion()}` }, signal: AbortSignal.timeout(20_000) });
		if (!response.ok) { console.warn(`Pac-Man roads: Mapbox answered ${response.status}`); return null; }
		return parseMapboxTile(new Uint8Array(await response.arrayBuffer()), tx, ty);
	} catch (cause) { console.warn("Pac-Man roads: Mapbox failed:", String(cause)); return null; }
}

/** The drivable roads in a Mapbox Streets vector tile. */
export function parseMapboxTile(data: Uint8Array, tx: number, ty: number): number[][] {
	const layer = new VectorTile(new PbfReader(data)).layers.road;
	const ways: number[][] = [];
	if (!layer) return ways;
	for (let i = 0; i < layer.length; i++) {
		const feature = layer.feature(i);
		const { class: kind, type } = feature.properties;
		if (typeof kind !== "string" || !MAPBOX_CLASSES.has(kind) || (typeof type === "string" && MAPBOX_SKIP_TYPES.test(type))) continue;
		const geometry = feature.toGeoJSON(tx, ty, TILE_ZOOM).geometry;
		const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
		for (const line of lines) {
			const flat: number[] = [];
			for (const point of line) flat.push(round6(point[0]), round6(point[1]));
			if (flat.length >= 4) ways.push(flat);
		}
	}
	return ways;
}

function overpassQuery(tx: number, ty: number): string {
	const pad = 0.0003;
	const [west, south, east, north] = tileBounds(tx, ty);
	const bbox = [south - pad, west - pad, north + pad, east + pad].map(value => value.toFixed(5)).join(",");
	return `[out:json][timeout:25];way["highway"~"^(${OSM_HIGHWAYS})$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"](${bbox});out geom;`;
}

function parseOverpass(data: unknown): number[][] {
	const elements = (data as { elements?: { geometry?: { lat?: number; lon?: number }[] }[] } | null)?.elements;
	if (!Array.isArray(elements)) return [];
	const ways: number[][] = [];
	for (const element of elements) {
		if (!Array.isArray(element?.geometry) || element.geometry.length < 2) continue;
		const flat: number[] = [];
		for (const point of element.geometry) if (typeof point?.lon === "number" && typeof point.lat === "number") flat.push(round6(point.lon), round6(point.lat));
		if (flat.length >= 4) ways.push(flat);
	}
	return ways;
}

/** The roads from OpenStreetMap, one lookup at a time, or null if no server answers. */
function overpassRoads(tx: number, ty: number): Promise<number[][] | null> {
	const run = async (): Promise<number[][] | null> => {
		for (const server of OVERPASS) {
			try {
				const response = await fetch(server, { method: "POST", headers: { "User-Agent": `brava-infotainment/${app.getVersion()}` }, body: new URLSearchParams({ data: overpassQuery(tx, ty) }), signal: AbortSignal.timeout(25_000) });
				if (!response.ok) { console.warn(`Pac-Man roads: ${server} answered ${response.status}`); continue; }
				return parseOverpass(await response.json());
			} catch (cause) { console.warn(`Pac-Man roads: ${server} failed:`, String(cause)); }
		}
		return null;
	};
	const result = overpassQueue.then(run, run);
	overpassQueue = result.then(() => new Promise(resolve => setTimeout(resolve, OVERPASS_GAP_MS)));
	return result;
}

async function fetchTile(tx: number, ty: number, token: string | null): Promise<RoadsTile | null> {
	const file = path.join(ROADS_FOLDER(), `${tx}_${ty}.json`);
	let cached: RoadsTile | null = null;
	try {
		const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<RoadsTile>;
		if (Array.isArray(parsed.ways) && typeof parsed.fetchedAt === "number") cached = { fetchedAt: parsed.fetchedAt, source: parsed.source === "osm" ? "osm" : "mapbox", ways: parsed.ways };
	} catch { /* Not saved yet, or damaged: looked up again. */ }
	if (cached && Date.now() - cached.fetchedAt < (cached.source === "mapbox" ? MAPBOX_FRESH_MS : OSM_FRESH_MS)) return cached;
	let fresh: RoadsTile | null = null;
	const fromMapbox = token ? await mapboxRoads(tx, ty, token) : null;
	if (fromMapbox) fresh = { fetchedAt: Date.now(), source: "mapbox", ways: fromMapbox };
	else {
		const fromOsm = await overpassRoads(tx, ty);
		if (fromOsm) fresh = { fetchedAt: Date.now(), source: "osm", ways: fromOsm };
	}
	// Offline or busy: an old copy of the tile is better than none.
	if (!fresh) return cached;
	try {
		await mkdir(ROADS_FOLDER(), { recursive: true });
		const temp = `${file}.tmp`;
		await writeFile(temp, JSON.stringify(fresh), "utf8");
		await rename(temp, file);
	} catch (cause) { console.error("Pac-Man roads not saved:", cause); }
	return fresh;
}

export function registerPacmanIpc(): void {
	ipcMain.handle("pacman:load", async (_event, id: unknown): Promise<PacmanLoad> => {
		const file = fileFor(id);
		if (!file) return { status: "error", message: "bad profile id" };
		await queues.get(file);
		try { return { status: "ok", data: JSON.parse(await readFile(file, "utf8")) as unknown }; } catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
			return { status: "error", message: String(cause) };
		}
	});
	ipcMain.handle("pacman:save", (_event, id: unknown, data: unknown) => {
		const file = fileFor(id);
		if (!file || typeof data !== "string") return false;
		const write = async () => {
			await mkdir(GAME_FOLDER(), { recursive: true });
			// Written beside the real file and then swapped in, so a power cut mid-write never loses the save.
			const temp = `${file}.tmp`;
			await writeFile(temp, data, "utf8");
			await rename(temp, file);
		};
		const next = (queues.get(file) ?? Promise.resolve()).then(write, write).catch((cause: unknown) => console.error("Pac-Man save failed:", cause));
		queues.set(file, next);
		return next.then(() => true);
	});
	ipcMain.handle("pacman:delete", async (_event, id: unknown) => {
		const file = fileFor(id);
		if (!file) return false;
		await queues.get(file);
		try { await unlink(file); } catch { /* Nothing saved yet. */ }
		return true;
	});
	// The roads of one zoom-14 map tile (with the Mapbox token to get them from Mapbox), or null if they could not be had.
	ipcMain.handle("pacman:roads", (_event, tx: unknown, ty: unknown, token: unknown): Promise<RoadsTile | null> => {
		const limit = 2 ** TILE_ZOOM;
		if (!Number.isInteger(tx) || !Number.isInteger(ty) || (tx as number) < 0 || (ty as number) < 0 || (tx as number) >= limit || (ty as number) >= limit) return Promise.resolve(null);
		const key = `${String(tx)},${String(ty)}`;
		let pending = inFlight.get(key);
		if (!pending) {
			pending = fetchTile(tx as number, ty as number, typeof token === "string" && /^[\w.-]{10,400}$/.test(token) ? token : null).finally(() => inFlight.delete(key));
			inFlight.set(key, pending);
		}
		return pending;
	});
}
