import { useCallback, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import type mapboxgl from "mapbox-gl";
import { Explorer, cellKey, distanceM, toCellSpace, type DiscoveredPlace, type LngLat } from "../lib/exploration";
import { FOG_LAYER_ID, FogLayer } from "../lib/fogLayer";
import type { ExplorationLoad } from "../explorationMain";
import { cellsInside, contains, outlineFromNominatim, shareExplored, type SuburbOutline } from "../lib/suburbs";
import { newMilestones, type Milestone } from "../lib/milestones";

/** Explore mode on or off, per profile like the other settings. */
export const EXPLORE_KEY = "brava-explore-fog";
const SAVE_EVERY_MS = 30_000;
/** Place names are looked up again after this far, and no more often than this. */
const LOOKUP_EVERY_M = 400;
const LOOKUP_MIN_MS = 15_000;
const NOTICE_MS = 6_000;
/**
 * Below this zoom the map's labels are switched off while the fog is on. The fog lets a little of the map show through,
 * and big bold names (towns, highway shields) could still be read through it when zoomed out. Closer in, the fog is
 * solid enough that they cannot. (On the globe this also stops place names drawn on its rim out into space.)
 */
const LABELS_FROM_ZOOM = 13;
/** Road and transit labels cannot be hidden one by one, so below LABELS_FROM_ZOOM they are switched off as a whole. */
const LABEL_SWITCHES = ["showRoadLabels", "showTransitLabels"] as const;
/**
 * Below this zoom all place names are switched off too. Sea and ocean names cannot be hidden one by one (they are not in
 * a featureset) and always lie in fog, and on the globe names drawn on its rim stick out past the fog into space. Explored
 * ground is far too small to see from that high anyway.
 */
const PLACE_NAMES_FROM_ZOOM = 6;
/**
 * Labels that can be hidden one by one (Standard style featuresets): under the fog, each shows only on explored ground,
 * and a town or suburb name also once that place has been discovered. So known places keep their names at any zoom,
 * and the fog carries no faint names to read through it.
 */
const LABEL_SETS = ["place-labels", "poi", "landmark-icons"] as const;

export interface SuburbProgress { id: string; name: string; share: number }

export interface ExploreStats {
	areaKm2: number;
	distanceKm: number;
	newDistanceKm: number;
	places: DiscoveredPlace[];
	startedAt: number;
	/** Suburbs driven in, most explored first. */
	suburbs: SuburbProgress[];
	/** Milestones reached, newest first. */
	milestones: Milestone[];
}

export interface DiscoveryNotice {
	key: string;
	kind: DiscoveredPlace["kind"] | "milestone" | "suburb" | "pacman" | "drive";
	name: string;
	detail: string;
}

/**
 * Suburb outlines, shared by every profile (a suburb is the same shape whoever drives it), kept in local storage so each
 * is only looked up once. Losing them costs nothing but a lookup again.
 */
const OUTLINES_KEY = "brava-suburb-outlines";
/** Spots where no suburb was found (rural roads), so they are not looked up again for a week. */
const MISSES_KEY = "brava-suburb-misses";
const MISS_FOR_MS = 7 * 24 * 3600 * 1000;
/** After a failed lookup (offline), wait this long before the next. */
const RETRY_AFTER_MS = 60_000;
/** Suburbs already discovered before progress existed are looked up this many at a time per start, at most. */
const BACKFILL_MAX = 40;
const outlines = new Map<string, { outline: SuburbOutline; cells?: number[] }>();
let misses: Record<string, number> = {};
let outlinesLoaded = false;
function loadOutlines(): void {
	if (outlinesLoaded) return;
	outlinesLoaded = true;
	try {
		const saved = JSON.parse(localStorage.getItem(OUTLINES_KEY) ?? "[]") as SuburbOutline[];
		if (Array.isArray(saved)) for (const outline of saved) if (outline?.id && Array.isArray(outline.rings) && Array.isArray(outline.bbox)) outlines.set(outline.id, { outline });
		misses = JSON.parse(localStorage.getItem(MISSES_KEY) ?? "{}") as Record<string, number>;
		if (!misses || typeof misses !== "object") misses = {};
	} catch { misses = {}; }
}
function storeOutlines(): void {
	try {
		localStorage.setItem(OUTLINES_KEY, JSON.stringify([...outlines.values()].map(entry => entry.outline)));
		localStorage.setItem(MISSES_KEY, JSON.stringify(misses));
	} catch { /* Storage full or blocked: looked up again next time. */ }
}
const outlineAt = (pos: LngLat) => [...outlines.values()].find(entry => contains(entry.outline, pos));
/** About a kilometre square, for remembering where no suburb was found. */
const missKey = ([lng, lat]: LngLat) => `${Math.round(lng * 100)},${Math.round(lat * 100)}`;
const missed = (pos: LngLat) => Date.now() - (misses[missKey(pos)] ?? 0) < MISS_FOR_MS;
function shareOf(id: string, cells: ReadonlySet<number>): number | null {
	const entry = outlines.get(id);
	if (!entry) return null;
	entry.cells ??= cellsInside(entry.outline);
	return shareExplored(entry.cells, cells);
}

const KIND_LABEL: Record<DiscoveredPlace["kind"], string> = { place: "New town or city discovered", locality: "New suburb discovered", neighborhood: "New neighbourhood discovered", area: "Area uncovered" };
const KIND_ORDER: DiscoveredPlace["kind"][] = ["place", "locality", "neighborhood"];

function suburbsOf(explorer: Explorer): SuburbProgress[] {
	const out: SuburbProgress[] = [];
	for (const suburb of explorer.suburbs) {
		const share = shareOf(suburb.id, explorer.cells);
		if (share !== null) out.push({ id: suburb.id, name: suburb.name, share });
	}
	return out.sort((a, b) => b.share - a.share);
}

const statsOf = (explorer: Explorer): ExploreStats => ({ areaKm2: explorer.areaM2 / 1e6, distanceKm: explorer.distanceM / 1000, newDistanceKm: explorer.newDistanceM / 1000, places: [...explorer.places].reverse(), startedAt: explorer.startedAt, suburbs: suburbsOf(explorer), milestones: [...explorer.milestones].reverse() });

function insideRing([x, y]: LngLat, ring: LngLat[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i], [xj, yj] = ring[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** The name of a park (or failing that, any named place) inside a loop that was just driven round. */
function nameInside(map: mapboxgl.Map, ring: LngLat[]): string | null {
	try {
		const points = ring.map(point => map.project(point));
		const box: [[number, number], [number, number]] = [[Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y))], [Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y))]];
		const features = map.queryRenderedFeatures(box, { target: { featuresetId: "poi", importId: "basemap" } })
			.filter(feature => feature.geometry.type === "Point" && typeof feature.properties?.name === "string" && insideRing(feature.geometry.coordinates as LngLat, ring));
		const parkish = (feature: (typeof features)[number]) => /park|garden|reserve|golf|cemetery|sport|playground|domain/i.test(`${feature.properties?.class ?? ""} ${feature.properties?.maki ?? ""} ${feature.properties?.group ?? ""} ${feature.properties?.name ?? ""}`);
		const best = features.find(parkish) ?? features[0];
		return best ? cleanAreaName(String(best.properties!.name)) : null;
	} catch { return null; }
}

/**
 * A map name tidied for an announcement: council reserve numbers and the like are dropped ("Avon Corridor 13" →
 * "Avon Corridor"), so it reads like a place rather than a record.
 */
export function cleanAreaName(name: string): string | null {
	const clean = name.replace(/\s*(?:no\.?\s*)?#?\d+[a-z]?$/i, "").replace(/\s+/g, " ").trim();
	return clean.length >= 3 ? clean : null;
}

/** Suburb, town and neighbourhood names at a point, from Mapbox's geocoder. */
async function placesAt([lng, lat]: LngLat, token: string): Promise<DiscoveredPlace[]> {
	const params = new URLSearchParams({ longitude: String(lng), latitude: String(lat), types: "neighborhood,locality,place", access_token: token });
	const response = await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?${params}`, { signal: AbortSignal.timeout(8000) });
	if (!response.ok) return [];
	const data = await response.json() as { features?: { properties?: { mapbox_id?: string; feature_type?: string; name?: string; coordinates?: { longitude?: number; latitude?: number } } }[] };
	const out: DiscoveredPlace[] = [];
	for (const feature of data.features ?? []) {
		const props = feature.properties;
		const kind = props?.feature_type as DiscoveredPlace["kind"];
		if (!props?.name || !KIND_ORDER.includes(kind)) continue;
		const coords: LngLat = Number.isFinite(props.coordinates?.longitude) && Number.isFinite(props.coordinates?.latitude) ? [props.coordinates!.longitude!, props.coordinates!.latitude!] : [lng, lat];
		out.push({ id: props.mapbox_id ?? `${kind}:${props.name}`, name: props.name, kind, coords, at: Date.now() });
	}
	return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/**
 * Explore mode: records where this profile's driver has been from real GPS fixes and simulated drives (never the dead
 * reckoning), keeps it in a file per profile, draws the fog over everywhere else, and announces newly discovered places.
 * Recording carries on while the fog is hidden, so turning it back on never loses progress.
 */
export function useExploration(mapRef: React.RefObject<mapboxgl.Map | null>, mapLoaded: boolean, profileId: string, fogOn: boolean, token: string | undefined, routeSource: React.RefObject<() => LngLat[] | null>, puckSource: React.RefObject<() => LngLat | null>, puckFogRef: React.RefObject<number>) {
	const explorerRef = useRef<Explorer | null>(null);
	const fogRef = useRef<FogLayer | null>(null);
	if (!fogRef.current) fogRef.current = new FogLayer();
	// The route always shows through the fog.
	fogRef.current.routeSource = () => routeSource.current?.() ?? null;
	// The car shows as a faint outline while fog is in front of it.
	fogRef.current.puckSource = () => puckSource.current?.() ?? null;
	fogRef.current.onPuckFog = amount => { puckFogRef.current = amount; };
	const queued = useRef<{ pos: LngLat; time: number }[]>([]);
	const dirty = useRef(false);
	const [stats, setStats] = useState<ExploreStats | null>(null);
	const [notices, setNotices] = useState<DiscoveryNotice[]>([]);
	const statsTimer = useRef<number | undefined>(undefined);
	const lookup = useRef<{ pos: LngLat; time: number; busy: boolean } | null>(null);

	const announceRef = useRef<(notice: Omit<DiscoveryNotice, "key">) => void>(() => undefined);
	/** Set when a suburb is first given an outline: whatever share of it was already explored is not news. */
	const quietMilestones = useRef(false);
	const refreshStats = useCallback((now = false) => {
		const run = () => {
			statsTimer.current = undefined;
			const explorer = explorerRef.current;
			if (!explorer) return;
			const next = statsOf(explorer);
			// Milestones reached since the last look. A map saved before milestones existed gets the ones it had already
			// reached quietly, as does a suburb just given its outline.
			const { all, announce } = newMilestones({ areaKm2: next.areaKm2, newRoadsKm: next.newDistanceKm, places: explorer.places.filter(place => place.kind !== "area").length, suburbs: next.suburbs }, new Set(explorer.milestones.map(item => item.id)));
			if (all.length) {
				explorer.reach(all);
				dirty.current = true;
				if (explorer.milestonesKnown && !quietMilestones.current) for (const milestone of announce) announceRef.current({ kind: milestone.kind === "suburb" ? "suburb" : "milestone", name: milestone.title, detail: milestone.kind === "suburb" ? "Suburb progress" : "Milestone reached" });
				next.milestones = [...explorer.milestones].reverse();
			}
			explorer.milestonesKnown = true;
			quietMilestones.current = false;
			setStats(next);
		};
		if (now) { window.clearTimeout(statsTimer.current); run(); }
		else if (statsTimer.current === undefined) statsTimer.current = window.setTimeout(run, 2000);
	}, []);

	// True while the saved map exists but could not be read: nothing is saved then, so it is never overwritten.
	const blocked = useRef(false);
	/** Set when explored ground or discoveries change, so labels on it are checked again. */
	const labelsDirty = useRef(true);
	const save = useCallback((cleared = false) => {
		const explorer = explorerRef.current;
		if (!explorer || !dirty.current || blocked.current) return;
		dirty.current = false;
		void ipcRenderer.invoke("exploration:save", profileId, JSON.stringify(explorer.toJSON()), cleared).catch(() => { dirty.current = true; });
	}, [profileId]);

	const notify = useCallback((item: Omit<DiscoveryNotice, "key">) => {
		const notice: DiscoveryNotice = { ...item, key: `${item.kind}:${item.name}:${Date.now()}` };
		setNotices(list => [...list, notice].slice(-4));
		window.setTimeout(() => setNotices(list => list.filter(entry => entry.key !== notice.key)), NOTICE_MS);
	}, []);
	announceRef.current = notify;
	const announce = useCallback((place: DiscoveredPlace) => {
		const detail = place.kind === "area" && place.areaM2 ? `${KIND_LABEL.area} · ${(place.areaM2 / 1e6).toFixed(2)} km²` : KIND_LABEL[place.kind];
		notify({ kind: place.kind, name: place.name, detail });
	}, [notify]);

	// Suburb outlines: the car's suburb is looked up when it is in none that is known yet.
	const suburbLookup = useRef<{ busy: boolean; failedAt: number }>({ busy: false, failedAt: 0 });
	const visitSuburb = useCallback((outline: SuburbOutline) => {
		const explorer = explorerRef.current;
		if (!explorer?.visitSuburb({ id: outline.id, name: outline.name, at: Date.now() })) return;
		dirty.current = true;
		quietMilestones.current = true;
		refreshStats(true);
	}, [refreshStats]);
	/** Looks up the suburb at a point (one lookup at a time). Resolves once done, true if it found one. */
	const lookUpSuburb = useCallback(async (pos: LngLat): Promise<boolean> => {
		const state = suburbLookup.current;
		if (state.busy || missed(pos) || Date.now() - state.failedAt < RETRY_AFTER_MS || !navigator.onLine) return false;
		state.busy = true;
		try {
			const data = await ipcRenderer.invoke("exploration:suburb-at", pos[0], pos[1]) as unknown;
			if (data === null) { state.failedAt = Date.now(); return false; }
			const outline = outlineFromNominatim(data);
			if (!outline || !contains(outline, pos)) { misses[missKey(pos)] = Date.now(); storeOutlines(); return false; }
			if (!outlines.has(outline.id)) { outlines.set(outline.id, { outline }); storeOutlines(); }
			visitSuburb(outlines.get(outline.id)!.outline);
			return true;
		} catch { state.failedAt = Date.now(); return false; } finally { state.busy = false; }
	}, [visitSuburb]);

	const apply = useCallback((pos: LngLat, time: number) => {
		const explorer = explorerRef.current!;
		const result = explorer.addFix(pos, time);
		// The fog clears outward from the car.
		if (result.added.length) { fogRef.current!.addCells(result.added, true, pos); dirty.current = true; labelsDirty.current = true; refreshStats(); }
		if (result.loop) {
			const map = mapRef.current;
			const name = map ? nameInside(map, result.loop.ring) : null;
			// Unnamed ground takes its name from the suburb it is in, if one is known.
			const suburb = [...explorer.places].reverse().find(item => item.kind === "locality" || item.kind === "neighborhood");
			const place: DiscoveredPlace = { id: `area:${result.loop.centroid.map(v => v.toFixed(4)).join(",")}`, name: name ?? (suburb ? `Area in ${suburb.name}` : "New ground"), kind: "area", coords: result.loop.centroid, at: Date.now(), areaM2: result.loop.areaM2 };
			if (explorer.discover(place)) { labelsDirty.current = true; announce(place); }
		}
		// The suburb the car is in, for its progress.
		const known = outlineAt(pos);
		if (known) visitSuburb(known.outline);
		else void lookUpSuburb(pos);
		// Look up which suburb and town this is now and then, and announce any not seen before.
		const last = lookup.current;
		if (token && navigator.onLine && (!last || (!last.busy && distanceM(last.pos, pos) > LOOKUP_EVERY_M && time - last.time > LOOKUP_MIN_MS))) {
			lookup.current = { pos, time, busy: true };
			void placesAt(pos, token).then(found => {
				for (const place of found) if (explorerRef.current?.discover(place)) { dirty.current = true; labelsDirty.current = true; announce(place); }
				refreshStats();
			}).catch(() => { /* Offline: tried again further on. */ }).finally(() => { if (lookup.current) lookup.current.busy = false; });
		}
	}, [announce, lookUpSuburb, mapRef, refreshStats, token, visitSuburb]);

	// Load this profile's map. Fixes that arrive first wait for it.
	useEffect(() => {
		let cancelled = false;
		let retry: number | undefined;
		// Loads this profile's map. If it exists but cannot be read, exploring carries on in a fresh map that is not
		// saved, and loading is tried again; once it works, what was explored meanwhile is added to the real map.
		const load = () => {
			void (ipcRenderer.invoke("exploration:load", profileId) as Promise<ExplorationLoad>).catch((cause: unknown): ExplorationLoad => ({ status: "error", message: String(cause) })).then(result => {
				if (cancelled) return;
				const readable = result.status === "missing" || (result.status === "ok" && Explorer.canRead(result.data));
				if (!readable) {
					console.error("Explore map could not be read; not saving over it, trying again.", result);
					blocked.current = true;
					if (!explorerRef.current) explorerRef.current = new Explorer();
					retry = window.setTimeout(load, 15_000);
				} else {
					const explorer = Explorer.fromJSON(result.status === "ok" ? result.data : null);
					if (explorerRef.current) { explorer.merge(explorerRef.current); dirty.current = true; }
					explorerRef.current = explorer;
					blocked.current = false;
				}
				fogRef.current!.setCells(explorerRef.current!.cells);
				for (const fix of queued.current.splice(0)) apply(fix.pos, fix.time);
				loadOutlines();
				refreshStats(true);
				if (readable) void backfill();
			});
		};
		// Suburbs discovered before progress existed (or on another profile) get their outlines, a few per start.
		const backfill = async () => {
			let tries = 0;
			for (const place of [...(explorerRef.current?.places ?? [])]) {
				if (cancelled || tries >= BACKFILL_MAX) return;
				if (place.kind !== "locality" && place.kind !== "neighborhood") continue;
				const known = outlineAt(place.coords);
				if (known) { visitSuburb(known.outline); continue; }
				if (missed(place.coords)) continue;
				tries++;
				while (suburbLookup.current.busy && !cancelled) await new Promise(resolve => setTimeout(resolve, 500));
				await lookUpSuburb(place.coords);
				// Offline: try again next start.
				if (suburbLookup.current.failedAt && Date.now() - suburbLookup.current.failedAt < RETRY_AFTER_MS) return;
			}
		};
		load();
		const timer = window.setInterval(() => save(), SAVE_EVERY_MS);
		const saveNow = () => save();
		const onHide = () => { if (document.visibilityState === "hidden") save(); };
		window.addEventListener("beforeunload", saveNow);
		document.addEventListener("visibilitychange", onHide);
		return () => {
			cancelled = true;
			window.clearTimeout(retry);
			save();
			window.clearInterval(timer);
			window.clearTimeout(statsTimer.current);
			window.removeEventListener("beforeunload", saveNow);
			document.removeEventListener("visibilitychange", onHide);
		};
	}, [profileId]);

	/** Feed every real GPS fix here. */
	const recordFix = useCallback((pos: LngLat) => {
		if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
		const time = Date.now();
		if (!explorerRef.current) { queued.current.push({ pos, time }); return; }
		apply(pos, time);
	}, [apply]);

	// Show or hide the fog.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const fog = fogRef.current!;
		// Labels off while zoomed out under fog (see LABELS_FROM_ZOOM).
		let labelsHidden = false, placesHidden = false;
		const setLabels = (hide: boolean, hidePlaces: boolean) => {
			try {
				if (hide !== labelsHidden) {
					for (const name of LABEL_SWITCHES) map.setConfigProperty("basemap", name, !hide);
					labelsHidden = hide;
				}
				if (hidePlaces !== placesHidden) {
					map.setConfigProperty("basemap", "showPlaceLabels", !hidePlaces);
					placesHidden = hidePlaces;
				}
			} catch { /* Style not ready; tried again. */ }
		};
		const ensure = () => {
			if (!map.isStyleLoaded()) return;
			if (fogOn && !map.getLayer(FOG_LAYER_ID)) map.addLayer(fog);
			const zoom = map.getZoom();
			setLabels(fogOn && zoom < LABELS_FROM_ZOOM, fogOn && zoom < PLACE_NAMES_FROM_ZOOM);
		};
		// Each label hidden unless its spot is explored (or, for town and suburb names, the place is discovered).
		const hidden = new Map<string, mapboxgl.TargetFeature | mapboxgl.GeoJSONFeature>();
		const explored = ([lng, lat]: LngLat): boolean => {
			const cells = explorerRef.current?.cells;
			if (!cells) return false;
			const [x, y] = toCellSpace([lng, lat]);
			for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (cells.has(cellKey(Math.floor(x) + dx, Math.floor(y) + dy))) return true;
			return false;
		};
		const updateLabels = () => {
			labelsDirty.current = false;
			if (!fogOn || !map.isStyleLoaded()) return;
			const known = new Set((explorerRef.current?.places ?? []).map(place => place.name.toLocaleLowerCase()));
			for (const featuresetId of LABEL_SETS) {
				let features: ReturnType<mapboxgl.Map["queryRenderedFeatures"]>;
				try { features = map.queryRenderedFeatures({ target: { featuresetId, importId: "basemap" } }); } catch { continue; }
				for (const feature of features) {
					if (feature.id == null || feature.geometry?.type !== "Point") continue;
					const name = typeof feature.properties?.name === "string" ? feature.properties.name.toLocaleLowerCase() : "";
					const show = explored(feature.geometry.coordinates as LngLat) || (featuresetId === "place-labels" && known.has(name));
					const id = `${featuresetId}:${String(feature.id)}`;
					if (show === !hidden.has(id)) continue;
					try {
						map.setFeatureState(feature, { hide: !show });
						if (show) hidden.delete(id); else hidden.set(id, feature);
					} catch { /* That label cannot be hidden; leave it. */ }
				}
			}
		};
		const showAllLabels = () => {
			for (const feature of hidden.values()) { try { map.setFeatureState(feature, { hide: false }); } catch { /* Gone with the style. */ } }
			hidden.clear();
		};
		ensure();
		// The style may still be loading now; these keep trying until it is (and re-add the fog after a style change).
		const events = ["styledata", "sourcedata", "style.load", "idle", "zoom"] as const;
		for (const event of events) map.on(event, ensure);
		map.on("idle", updateLabels);
		// Labels that come into view while the map moves or loads are hidden straight away, not once it settles (which
		// left names showing through the fog until then). A few times a second is plenty (each look queries every label on screen, which costs the car computer several ms).
		const markDirty = () => { labelsDirty.current = true; };
		map.on("move", markDirty);
		map.on("sourcedata", markDirty);
		// As ground is explored, its labels come back.
		const labelTimer = window.setInterval(() => { if (labelsDirty.current) updateLabels(); }, 350);
		return () => {
			for (const event of events) map.off(event, ensure);
			map.off("idle", updateLabels);
			map.off("move", markDirty);
			map.off("sourcedata", markDirty);
			window.clearInterval(labelTimer);
			try { if (map.getLayer(FOG_LAYER_ID)) map.removeLayer(FOG_LAYER_ID); setLabels(false, false); showAllLabels(); } catch { /* The map is already gone. */ }
		};
	}, [mapRef, mapLoaded, fogOn]);

	// Lets the dev tools drive the explorer without a GPS receiver; never in packaged builds.
	useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		(window as unknown as { __bravaExplore?: unknown }).__bravaExplore = { recordFix, stats: () => explorerRef.current && statsOf(explorerRef.current) };
	}, [recordFix]);

	const reset = useCallback(() => {
		const explorer = explorerRef.current;
		if (!explorer) return;
		explorer.reset();
		fogRef.current!.setCells([]);
		lookup.current = null;
		dirty.current = true;
		// Cleared on purpose: no backup of the old map is kept for this one.
		save(true);
		refreshStats(true);
	}, [save, refreshStats]);

	const shareAround = useCallback((center: LngLat, radiusM: number) => explorerRef.current?.shareAround(center, radiusM) ?? 0, []);
	const dismissNotice = useCallback((key: string) => setNotices(list => list.filter(item => item.key !== key)), []);

	return { recordFix, stats, notices, dismissNotice, reset, shareAround };
}
