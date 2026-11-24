import { useCallback, useEffect, useRef, useState } from "react";
import { ipcRenderer } from "electron";
import type mapboxgl from "mapbox-gl";
import { distanceM, type LngLat } from "../lib/exploration";
import { DOTS_FROM_ZOOM, DotsLayer } from "../lib/dotsLayer";
import { RoadGraph } from "../lib/roadGraph";
import { GHOST_LABEL, GhostPack } from "../lib/ghosts";
import { Pacman, dotsFromWays, tileBounds, tileKey, tileOf, tilesAround, type Dot, type PacmanSummary, type Regrow } from "../lib/pacman";
import { PacmanSounds } from "../lib/pacmanSound";
import type { SoundName } from "../lib/pacmanSynth";
import { appScale } from "../lib/masterVolume";
import { masterVolume } from "./useMasterVolume";
import startUrl from "../../public/sounds/pacman/start.wav";
import wakaUrl from "../../public/sounds/pacman/waka.wav";
import wakaBUrl from "../../public/sounds/pacman/wakaB.wav";
import deathUrl from "../../public/sounds/pacman/death.wav";
import eatGhostUrl from "../../public/sounds/pacman/eatghost.wav";
import extraUrl from "../../public/sounds/pacman/extra.wav";
import powerUrl from "../../public/sounds/pacman/power.wav";
import sirenUrl from "../../public/sounds/pacman/siren.wav";
import type { PacmanLoad, RoadsTile } from "../pacmanMain";
import type { DiscoveryNotice } from "./useExploration";

/** How long the dots' regrow time is kept for: per profile, like the other settings. */
export const PACMAN_REGROW_KEY = "brava-pacman-regrow";
/** Whether the ghost is on (per profile). */
export const PACMAN_GHOSTS_KEY = "brava-pacman-ghosts";
/** How loud the sound effects are: off, quiet or normal (per profile). */
export const PACMAN_SOUND_KEY = "brava-pacman-sound";
export type SoundSetting = "off" | "quiet" | "normal";
export const isSoundSetting = (v: unknown): v is SoundSetting => v === "off" || v === "quiet" || v === "normal";
const SOUND_LEVEL: Record<SoundSetting, number> = { off: 0, quiet: 0.4, normal: 1 };
const SOUND_FILES: [SoundName, string][] = [["start", startUrl], ["waka", wakaUrl], ["wakaB", wakaBUrl], ["death", deathUrl], ["eatGhost", eatGhostUrl], ["extra", extraUrl], ["power", powerUrl], ["siren", sirenUrl]];
/** The ghost moves this often (milliseconds). */
const GHOST_STEP_MS = 100;
/** The car's position is guessed ahead from its last fix for at most this long (milliseconds), and counts as stopped after STOP_AFTER_MS without one. */
const GUESS_MS = 1_500;
const STOP_AFTER_MS = 3_000;
const SAVE_EVERY_MS = 30_000;
const NOTICE_MS = 5_000;
/** The dots drawn cover what the map shows: a circle round its centre, this size at least and at most (in metres). */
const MIN_VIEW_M = 700;
const MAX_VIEW_M = 4_000;
/** Without a map to look at, dots this far round the car are drawn. */
const DEFAULT_VIEW_M = 1_500;
/** The drawn dots are worked out again once the view has moved this far, or grown or shrunk by a quarter. */
const REDRAW_M = 200;
/** Never more than this many dots are drawn (the nearest to the middle of the view). */
const MAX_DRAWN = 30_000;
/** The tiles round the car are always loaded (so it can eat), and those the map shows too, at most this many. */
const CAR_TILES = 1;
const VIEW_TILES = 12;
/** After a failed lookup (offline), roads are asked for again after this long. */
const RETRY_MS = 30_000;
const NEARBY_M = 1_000;

export interface PacmanStats extends PacmanSummary {
	/** Dots left to eat within a kilometre, or null while the roads are loading. */
	nearby: number | null;
	loading: boolean;
	/** The roads could not be fetched (offline, or the map servers are busy); they are tried again. */
	roadsFailed: boolean;
}

/**
 * Pac-Man mode: while it is the active mode, every fix eats the dots it passes (see lib/pacman.ts), the dots around the
 * car are fetched by map tile and drawn in 3D, and the score and stats are kept in a file per profile. The game loads
 * whichever mode is active, so its stats can always be looked at.
 */
export function usePacman(mapRef: React.RefObject<mapboxgl.Map | null>, mapLoaded: boolean, profileId: string, active: boolean, regrow: Regrow, puckSource: React.RefObject<() => LngLat | null>, ghosts: boolean, sound: SoundSetting = "normal") {
	const gameRef = useRef<Pacman | null>(null);
	const layerRef = useRef<DotsLayer | null>(null);
	const activeRef = useRef(active);
	activeRef.current = active;
	const regrowRef = useRef(regrow);
	regrowRef.current = regrow;
	const lastFix = useRef<LngLat | null>(null);
	/** What the dots drawn now cover. */
	const lastView = useRef<{ center: LngLat; radius: number } | null>(null);
	const lastPos = useRef<LngLat | null>(null);
	const dirty = useRef(false);
	const loadingRoads = useRef(false);
	const loadAgain = useRef(false);
	// The ghost: the roads it moves on (built from the loaded tiles' roads) and what is known of the car's speed.
	const roadsOfTile = useRef(new Map<string, number[][]>());
	const graphRef = useRef(new RoadGraph());
	const huntRef = useRef(new GhostPack(graphRef.current));
	const soundsRef = useRef<PacmanSounds | null>(null);
	if (!soundsRef.current) soundsRef.current = new PacmanSounds(() => appScale(masterVolume.get()));
	soundsRef.current.setLevel(SOUND_LEVEL[sound]);
	// The arcade's own recordings; an imitation plays for any that cannot be loaded.
	useEffect(() => {
		const sounds = soundsRef.current;
		let gone = false;
		void (async () => {
			const files: Partial<Record<SoundName, ArrayBuffer>> = {};
			for (const [name, url] of SOUND_FILES) {
				try { files[name] = await (await fetch(url)).arrayBuffer(); } catch { /* The imitation plays. */ }
			}
			if (!gone) await sounds?.useFiles(files);
		})();
		return () => { gone = true; sounds?.dispose(); };
	}, []);
	// The start tune plays when the mode is switched to, not when the app opens already in it.
	const wasActive = useRef(active);
	useEffect(() => {
		if (active && !wasActive.current) soundsRef.current?.play("start");
		if (!active) soundsRef.current?.stopAll();
		wasActive.current = active;
	}, [active]);
	const ghostsRef = useRef(ghosts);
	ghostsRef.current = ghosts;
	const graphStale = useRef(false);
	const motion = useRef({ at: 0, speed: 0, bearing: null as number | null });
	const failedAt = useRef(0);
	const statsTimer = useRef<number | undefined>(undefined);
	const [stats, setStats] = useState<PacmanStats | null>(null);
	const [notices, setNotices] = useState<DiscoveryNotice[]>([]);

	const notify = useCallback((item: Omit<DiscoveryNotice, "key">) => {
		const notice: DiscoveryNotice = { ...item, key: `${item.kind}:${item.name}:${Date.now()}` };
		setNotices(list => [...list, notice].slice(-3));
		window.setTimeout(() => setNotices(list => list.filter(entry => entry.key !== notice.key)), NOTICE_MS);
	}, []);

	const refreshStats = useCallback((now = false) => {
		const run = () => {
			statsTimer.current = undefined;
			const game = gameRef.current;
			if (!game) return;
			const time = Date.now();
			const here = lastPos.current;
			setStats({ ...game.summary(time), nearby: here && game.tileCount ? game.countNear(here, NEARBY_M, time) : null, loading: loadingRoads.current, roadsFailed: Date.now() - failedAt.current < RETRY_MS });
		};
		if (now) { window.clearTimeout(statsTimer.current); run(); }
		else if (statsTimer.current === undefined) statsTimer.current = window.setTimeout(run, 800);
	}, []);

	/** What the map is showing: its middle, and how far from that the dots should reach. */
	const currentView = useCallback((): { center: LngLat; radius: number } => {
		const map = mapRef.current;
		if (!map) return { center: lastPos.current ?? [0, 0], radius: DEFAULT_VIEW_M };
		const middle = map.getCenter();
		const canvas = map.getCanvas();
		const metresPerPixel = (78_271.517 * Math.cos((middle.lat * Math.PI) / 180)) / 2 ** map.getZoom();
		const radius = Math.min(MAX_VIEW_M, Math.max(MIN_VIEW_M, Math.max(canvas.clientWidth, canvas.clientHeight) * 0.7 * metresPerPixel));
		return { center: [middle.lng, middle.lat], radius };
	}, [mapRef]);

	/** The dots in view, handed to the map. */
	const redraw = useCallback(() => {
		const game = gameRef.current, layer = layerRef.current;
		if (!game || !layer) return;
		const view = currentView();
		lastView.current = view;
		let dots: Dot[] = game.dotsNear(view.center, view.radius, Date.now());
		if (dots.length > MAX_DRAWN) {
			const mx = Math.cos((view.center[1] * Math.PI) / 180);
			const away = (dot: Dot) => (dot.pos[0] - view.center[0]) ** 2 * mx * mx + (dot.pos[1] - view.center[1]) ** 2;
			dots = dots.sort((a, b) => away(a) - away(b)).slice(0, MAX_DRAWN);
		}
		layer.setDots(view.center, dots);
	}, [currentView]);

	/**
	 * Loads the roads the car needs (its own tile and those round it) and those the map is showing, one tile at a time,
	 * drawing as each arrives. Tiles no longer needed are let go.
	 */
	const loadTiles = useCallback(async () => {
		const game = gameRef.current;
		if (!game || Date.now() - failedAt.current < RETRY_MS) return;
		if (loadingRoads.current) { loadAgain.current = true; return; }
		const wanted: [number, number][] = [];
		const add = (tx: number, ty: number) => { if (!wanted.some(([x, y]) => x === tx && y === ty)) wanted.push([tx, ty]); };
		const car = lastPos.current;
		if (car) {
			const [cx, cy] = tileOf(car);
			add(cx, cy);
			for (let dx = -CAR_TILES; dx <= CAR_TILES; dx++) for (let dy = -CAR_TILES; dy <= CAR_TILES; dy++) add(cx + dx, cy + dy);
		}
		const map = mapRef.current;
		if (map && map.getZoom() >= DOTS_FROM_ZOOM) { const view = currentView(); for (const [tx, ty] of tilesAround(view.center, view.radius, VIEW_TILES)) add(tx, ty); }
		// Tiles with none of the wanted ones within a tile of them are let go.
		for (const key of game.loadedTiles()) {
			const [tx, ty] = key.split(",").map(Number);
			if (!wanted.some(([x, y]) => Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1)) { game.removeTile(key); if (roadsOfTile.current.delete(key)) graphStale.current = true; }
		}
		loadingRoads.current = true;
		refreshStats(true);
		try {
			for (const [tx, ty] of wanted) {
				const key = tileKey(tx, ty);
				if (gameRef.current !== game || !activeRef.current) break;
				if (game.hasTile(key)) continue;
				const tile = await (ipcRenderer.invoke("pacman:roads", tx, ty, process.env.MAPBOX_TOKEN) as Promise<RoadsTile | null>).catch((): null => null);
				if (gameRef.current !== game) break;
				if (!tile) { failedAt.current = Date.now(); console.warn("Pac-Man: could not get the roads for this area; trying again shortly."); refreshStats(true); break; }
				game.addTile(key, dotsFromWays(tile.ways, tileBounds(tx, ty)));
				roadsOfTile.current.set(key, tile.ways);
				graphRef.current.addWays(tile.ways);
				redraw();
				refreshStats(true);
			}
		} finally {
			loadingRoads.current = false;
			refreshStats(true);
			// The view moved on while tiles were loading: look again.
			if (loadAgain.current) { loadAgain.current = false; void loadTiles(); }
		}
	}, [currentView, mapRef, redraw, refreshStats]);

	const save = useCallback(() => {
		const game = gameRef.current;
		if (!game || !dirty.current) return;
		dirty.current = false;
		void ipcRenderer.invoke("pacman:save", profileId, JSON.stringify(game.toJSON())).catch(() => { dirty.current = true; });
	}, [profileId]);

	// This profile's game. If its file exists but cannot be read, nothing is played or saved (so it is never written
	// over) and loading is tried again.
	useEffect(() => {
		let cancelled = false;
		let retry: number | undefined;
		const load = () => {
			void (ipcRenderer.invoke("pacman:load", profileId) as Promise<PacmanLoad>).catch((cause: unknown): PacmanLoad => ({ status: "error", message: String(cause) })).then(result => {
				if (cancelled) return;
				if (result.status === "error" || (result.status === "ok" && !Pacman.canRead(result.data))) {
					console.error("Pac-Man save could not be read; not playing over it, trying again.", result);
					retry = window.setTimeout(load, 15_000);
					return;
				}
				gameRef.current = Pacman.fromJSON(result.status === "ok" ? result.data : null, regrowRef.current);
				refreshStats(true);
				if (activeRef.current) { void loadTiles(); redraw(); }
			});
		};
		load();
		const timer = window.setInterval(save, SAVE_EVERY_MS);
		const onHide = () => { if (document.visibilityState === "hidden") save(); };
		window.addEventListener("beforeunload", save);
		document.addEventListener("visibilitychange", onHide);
		return () => {
			cancelled = true;
			window.clearTimeout(retry);
			save();
			gameRef.current = null;
			lastFix.current = null;
			lastView.current = null;
			window.clearInterval(timer);
			window.clearTimeout(statsTimer.current);
			window.removeEventListener("beforeunload", save);
			document.removeEventListener("visibilitychange", onHide);
		};
	}, [profileId]);

	// The dots on the map.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !mapLoaded) return;
		const layer = new DotsLayer(map);
		layerRef.current = layer;
		layer.setEnabled(activeRef.current);
		if (activeRef.current) redraw();
		// The dots follow what the map shows, so panning anywhere shows dots there.
		const onView = () => {
			if (!activeRef.current) return;
			const view = currentView(), last = lastView.current;
			if (last && distanceM(last.center, view.center) < REDRAW_M && Math.abs(view.radius / last.radius - 1) < 0.25) return;
			redraw();
			void loadTiles();
		};
		map.on("move", onView);
		map.on("moveend", onView);
		return () => { map.off("move", onView); map.off("moveend", onView); layerRef.current = null; layer.dispose(); };
	}, [mapRef, mapLoaded, redraw, currentView, loadTiles]);

	// Switching the mode on or off.
	useEffect(() => {
		layerRef.current?.setEnabled(active);
		lastFix.current = null;
		if (active) { void loadTiles(); redraw(); }
	}, [active, loadTiles, redraw]);

	// A change of regrow time brings back (or hides) the dots it affects.
	useEffect(() => {
		const game = gameRef.current;
		if (!game) return;
		game.regrow = regrow;
		dirty.current = true;
		redraw();
		refreshStats(true);
	}, [regrow, redraw, refreshStats]);

	/** Feed every real GPS fix (and simulated drive) here. */
	const recordFix = useCallback((pos: LngLat) => {
		if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
		lastPos.current = pos;
		const game = gameRef.current;
		if (!activeRef.current || !game) return;
		const result = game.eatAlong(lastFix.current, pos, Date.now());
		// How fast and which way the car is going, from this fix and the one before.
		const moved = lastFix.current, nowMs = Date.now(), m = motion.current;
		if (moved && m.at && nowMs - m.at < 5_000) {
			const metres = distanceM(moved, pos);
			m.speed = m.speed * 0.5 + (metres / Math.max(0.2, (nowMs - m.at) / 1000)) * 0.5;
			if (metres > 3) m.bearing = (Math.atan2((pos[0] - moved[0]) * Math.cos((pos[1] * Math.PI) / 180), pos[1] - moved[1]) * 180 / Math.PI + 360) % 360;
		}
		m.at = nowMs;
		lastFix.current = pos;
		if (result.eaten.length) {
			dirty.current = true;
			redraw();
			refreshStats();
			soundsRef.current?.play(result.pellets || result.multiplierUp ? "extra" : "waka");
			if (result.pellets) {
				notify({ kind: "pacman", name: `+${result.pelletPoints} points`, detail: result.pellets > 1 ? "Power pellets" : "Power pellet" });
				// A power pellet turns every ghost blue.
				if (ghostsRef.current) huntRef.current.frighten(performance.now() / 1000);
			}
			else if (result.multiplierUp) notify({ kind: "pacman", name: `${result.multiplier}× multiplier`, detail: "Keep the run going" });
		}
		// The roads under the car are always wanted, wherever the map is looking.
		if (!game.hasTile(tileKey(...tileOf(pos)))) void loadTiles();
	}, [loadTiles, notify, redraw, refreshStats]);

	// Where the car is shown, for loading roads and drawing dots before the first GPS fix (or with none, such as a preview
	// run), and for trying again after the roads could not be fetched. It never eats dots: only real fixes do.
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => {
			const pos = puckSource.current?.();
			if (!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return;
			if (!lastPos.current) lastPos.current = pos;
			if (!gameRef.current) return;
			if (!lastView.current) redraw();
			void loadTiles();
		}, 3_000);
		return () => window.clearInterval(timer);
	}, [active, loadTiles, puckSource, redraw]);

	// The ghost: a few times a second it takes a step towards the car, and is told to the map to draw. It runs only while the
	// mode is on and the ghost setting is.
	useEffect(() => {
		if (!active || !ghosts) { huntRef.current.clear(); layerRef.current?.setGhosts([]); return; }
		const timer = window.setInterval(() => {
			const game = gameRef.current, pos = lastPos.current;
			if (!game || !pos) return;
			if (graphStale.current) {
				// Roads were let go: the map of them is made again from those still loaded.
				graphStale.current = false;
				const graph = new RoadGraph();
				for (const ways of roadsOfTile.current.values()) graph.addWays(ways);
				graphRef.current = graph;
				huntRef.current.setGraph(graph);
			}
			// The car's speed is what its fixes say (and none, if they have stopped coming), and it is placed a little ahead of its last fix.
			const m = motion.current, age = Date.now() - m.at;
			const moving = m.at > 0 && age < STOP_AFTER_MS;
			const speed = moving ? m.speed : 0;
			let car = pos;
			if (moving && m.bearing !== null && age < GUESS_MS) {
				const ahead = (speed * age) / 1000, heading = (m.bearing * Math.PI) / 180;
				car = [pos[0] + (ahead * Math.sin(heading)) / (111_320 * Math.cos((pos[1] * Math.PI) / 180)), pos[1] + (ahead * Math.cos(heading)) / 110_540];
			}
			const events = huntRef.current.update(GHOST_STEP_MS / 1000, { pos: car, speed, bearing: m.bearing }, performance.now() / 1000);
			layerRef.current?.setGhosts(huntRef.current.places());
			// Several ghosts can have had the car at once: the run is lost once, however many.
			const caught = events.filter(event => event.type === "caught");
			const blue = huntRef.current.frightenedFor() > 0;
			soundsRef.current?.setLoop("power", blue);
			soundsRef.current?.setLoop("siren", !blue);
			if (caught.length) {
				soundsRef.current?.play("death");
				const lost = game.caughtByGhost();
				notify({ kind: "pacman", name: `${GHOST_LABEL[caught[0].name]} caught you`, detail: lost ? `Run lost · −${lost} points` : "Run lost" });
			}
			for (const event of events) {
				if (event.type !== "eaten") continue;
				game.ateGhost(event.points);
			soundsRef.current?.play("eatGhost");
				notify({ kind: "pacman", name: `+${event.points} points`, detail: `${GHOST_LABEL[event.name]} eaten` });
			}
			if (events.length) { dirty.current = true; refreshStats(true); }
		}, GHOST_STEP_MS);
		return () => { window.clearInterval(timer); soundsRef.current?.setLoop("power", false); soundsRef.current?.setLoop("siren", false); huntRef.current.clear(); layerRef.current?.setGhosts([]); };
	}, [active, ghosts, notify, refreshStats]);

	// Lets the dev tools drive the game without a GPS receiver; never in packaged builds.
	useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		(window as unknown as { __bravaPacman?: unknown }).__bravaPacman = { recordFix, stats: () => gameRef.current?.summary(Date.now()), ghost: () => huntRef.current.place(), ghosts: () => huntRef.current.places(), frightenedFor: () => huntRef.current.frightenedFor(), frighten: () => huntRef.current.frighten(performance.now() / 1000) };
	}, [recordFix]);

	const reset = useCallback(() => {
		const game = gameRef.current;
		if (!game) return;
		game.reset();
		dirty.current = true;
		save();
		redraw();
		refreshStats(true);
	}, [redraw, refreshStats, save]);

	const dismissNotice = useCallback((key: string) => setNotices(list => list.filter(item => item.key !== key)), []);

	return { recordFix, stats, notices, dismissNotice, reset };
}
