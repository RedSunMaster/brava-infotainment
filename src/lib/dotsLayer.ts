import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import type { LngLat } from "./exploration";
import { createGhost, type GhostModel, type Mood } from "./ghostModel";
import { createFruit, type FruitModel } from "./fruitModel";
import type { LiveFruit } from "./fruit";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { puckModelScale } from "./cameraLookAhead";
import { toLocalMetres } from "./localMetres";
import { DOT_SPRITE, GHOST_COLOURS, PELLET_COLOUR, POWER_PELLET_SPRITE } from "./sprites";

/**
 * Pac-Man mode's dots, in the arcade's pixel art made 3D: a dot is the arcade's 2 by 2 square, flat on the road, and a power
 * pellet its 8 by 8 octagon, a little thicker, blinking as the arcade's do. Like the car and the fog, they are drawn on a
 * canvas of their own just above the map's (a Mapbox custom layer is added only to be called with the camera every frame),
 * and all dots of a kind are one instanced mesh, so thousands cost little.
 *
 * Dots are placed in metres from an anchor near the car (so the numbers stay small), and the anchor moves when the car
 * has gone far from it. They are drawn a constant size on screen (so they can still be seen when zoomed out) but never
 * smaller than a real dot's size, and are hidden when zoomed out too far to tell them apart.
 */
/** A ghost to draw: which, where it is, the way it is going (degrees clockwise from north), and whether it is blue. */
export interface DrawnGhost { name: keyof typeof GHOST_COLOURS; pos: LngLat; bearing: number; mood: Mood }

/** A ghost on the map: its model, and where it was and is going, so it glides between updates. */
interface GhostEntry { model: GhostModel; root: THREE.Group; from: DrawnGhost; to: DrawnGhost; at: number; bearing: number; height: number }
/** The ghost is drawn as big as the Pac-Man car (whose radius is 3 in the car's own units). */
const GHOST_RADIUS_UNITS = 3;
/** Positions come in about this often, so the ghost is smoothed between them (milliseconds). */
const GHOST_STEP_MS = 100;

/** A bonus fruit on the map: its model, and where and until when. */
interface FruitEntry { model: FruitModel; root: THREE.Group; fruit: LiveFruit; height: number }
/** A fruit is drawn as big as a ghost, and flashes for its last few seconds (milliseconds). */
const FRUIT_RADIUS_UNITS = 5;
const FRUIT_FLASH_MS = 5_000;

export interface DrawnDot { id: number; pos: LngLat; pellet: boolean }

const LAYER_ID = "pacman-dots-layer";
/** Below this zoom no dots are drawn. */
export const DOTS_FROM_ZOOM = 14;
/**
 * Half the width of a dot on screen in CSS pixels (so a dot is twice this across), and the least it is in metres. One
 * arcade pixel of a dot is this big; a power pellet's pixels are PELLET_PIXEL of it, so an 8 pixel pellet is 4.8 times it.
 */
const DOT_PX = 3.4;
const MIN_DOT_M = 1.1;
const MAX_DOT_M = 30;
const PELLET_PIXEL = 0.6;
/** How thick a dot is, in its own pixels, and a power pellet, in its own pixels. */
const DOT_THICK = 1;
const PELLET_THICK = 2;
/**
 * How many dots have their ground height read again each frame. The height the map gives for a place is not fixed: it
 * changes with the zoom and the terrain tiles loaded (by tens of metres, once), so a height read once and kept was wrong
 * by that much whenever the camera was tilted. The car and the ghosts read theirs afresh every frame; this does the same for
 * the dots, a slice at a time, so all of them come round within a second or two.
 */
const REFRESH_PER_FRAME = 400;
/** The power pellets blink on and off this often (milliseconds each way). */
const BLINK_MS = 240;

/** The blocks of a sprite of one colour, as one shape: each row's runs of filled squares made a box, centred on the origin, a unit across a square, `layers` thick, on z = 0. */
function spriteGeometry(rows: readonly string[], layers: number): THREE.BufferGeometry {
	const boxes: THREE.BufferGeometry[] = [];
	const columns = Math.max(...rows.map(row => row.length));
	rows.forEach((row, r) => {
		for (const run of row.matchAll(/X+/g)) {
			const box = new THREE.BoxGeometry(run[0].length, 1, layers);
			box.translate(run.index! + run[0].length / 2 - columns / 2, (rows.length - 1) / 2 - r, layers / 2);
			boxes.push(box);
		}
	});
	const merged = mergeGeometries(boxes)!;
	boxes.forEach(box => box.dispose());
	return merged;
}

export class DotsLayer {
	private readonly map: mapboxgl.Map;
	private readonly canvas = document.createElement("canvas");
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	/** The ghost has a pass of its own, drawn over the dots: the map's depth is too coarse to tell a dot on the ground from the ghost lying on it. */
	private readonly ghostScene = new THREE.Scene();
	private readonly camera = new THREE.Camera();
	// A dot is one flat block (the sprite's 2 by 2 square); a power pellet the octagon of blocks, built as one shape.
	private readonly dotGeometry = spriteGeometry(DOT_SPRITE, DOT_THICK);
	private readonly pelletGeometry = spriteGeometry(POWER_PELLET_SPRITE, PELLET_THICK);
	private readonly material = new THREE.MeshLambertMaterial({ color: PELLET_COLOUR });
	private dotMesh: THREE.InstancedMesh;
	private pelletMesh: THREE.InstancedMesh;
	private anchor: LngLat = [0, 0];
	private dotsLocal: number[] = [];
	private pelletsLocal: number[] = [];
	// Where each dot is, and how high the ground is under it (the map has real terrain, so a dot at sea level would sink
	// into a hill or float over a valley as soon as the camera tilts).
	private dotsPos: DrawnDot[] = [];
	private pelletsPos: DrawnDot[] = [];
	/** Ground height by dot, kept so a dot already seen is not looked up again on every change. */
	private readonly heightCache = new Map<number, number>();
	private dotsHeight: number[] = [];
	private pelletsHeight: number[] = [];
	private heightsPending = false;
	/** Where the round of height re-reads has got to, and the zoom the remembered heights were read at. */
	private refreshAt = 0;
	private cacheZoom = 0;
	private heightTimer: number | undefined;
	private readonly ghosts = new Map<string, GhostEntry>();
	private fruit: FruitEntry | null = null;
	private enabled = true;
	private appliedSize = 0;
	private disposed = false;
	private readonly m4 = new THREE.Matrix4();
	private readonly l4 = new THREE.Matrix4();
	private readonly instance = new THREE.Matrix4();
	private readonly layer: mapboxgl.CustomLayerInterface;
	/** Terrain tiles arriving (or the map settling) give heights that were not known before. */
	private readonly onTerrain = (event?: object) => {
		if (!this.heightsPending || ("sourceId" in (event ?? {}) && (event as { sourceId?: string }).sourceId !== "brava-terrain")) return;
		window.clearTimeout(this.heightTimer);
		this.heightTimer = window.setTimeout(() => this.updateHeights(), 250);
	};
	private readonly onResize = () => { this.canvas.width = this.map.getCanvas().width; this.canvas.height = this.map.getCanvas().height; this.renderer.setSize(this.canvas.width, this.canvas.height, false); };
	private readonly ensureLayer = () => { if (this.disposed || !this.map.isStyleLoaded()) return; if (!this.map.getLayer(LAYER_ID)) this.map.addLayer(this.layer); this.map.triggerRepaint(); };

	constructor(map: mapboxgl.Map) {
		this.map = map;
		const mapCanvas = map.getCanvas();
		// Above the map and under the car's canvas.
		this.canvas.setAttribute("aria-hidden", "true");
		this.canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;";
		this.canvas.width = mapCanvas.width;
		this.canvas.height = mapCanvas.height;
		mapCanvas.parentElement!.appendChild(this.canvas);
		this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.autoClear = false;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		// Bright enough that the tops of the blocks show in the sprite's own colour, with the sides a shade darker.
		this.scene.add(new THREE.AmbientLight(0xffffff, 2.4));
		const sun = new THREE.DirectionalLight(0xffffff, 1.4);
		sun.position.set(-1, 2, 3);
		this.scene.add(sun);
		// A ghost's pixel-art sprite stands in the model's X-Y plane with its face to +Z: here that is east-north, face to the sky
		// and the top of the sprite to the top of the screen. It is turned about the vertical to the map's bearing (placeGhosts),
		// so it stays upright on the screen however the map is turned.
		// Bright enough that the tops of the blocks show in the sprite's own colours, with the sides a shade darker.
		this.ghostScene.add(new THREE.AmbientLight(0xffffff, 2.4));
		const ghostSun = new THREE.DirectionalLight(0xffffff, 1.4);
		ghostSun.position.set(-1, 2, 3);
		this.ghostScene.add(ghostSun);
		this.dotMesh = this.makeMesh(this.dotGeometry, 256);
		this.pelletMesh = this.makeMesh(this.pelletGeometry, 16);
		this.layer = { id: LAYER_ID, type: "custom", renderingMode: "3d", onAdd: () => undefined, render: (_gl, matrix) => this.render(matrix as unknown as number[]) };
		this.ensureLayer();
		map.on("styledata", this.ensureLayer);
		map.on("sourcedata", this.ensureLayer);
		map.on("style.load", this.ensureLayer);
		map.on("resize", this.onResize);
		map.on("sourcedata", this.onTerrain);
		map.on("idle", this.onTerrain);
		// Lets the dev tools look inside; never in packaged builds.
		if (process.env.NODE_ENV !== "production") (window as unknown as { __bravaDotsLayer?: unknown }).__bravaDotsLayer = this;
	}

	private makeMesh(geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
		const mesh = new THREE.InstancedMesh(geometry, this.material, capacity);
		mesh.count = 0;
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		return mesh;
	}

	/** Shows or hides all the dots (the mode being on or off). */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.canvas.style.display = enabled ? "" : "none";
		this.map.triggerRepaint();
	}

	/** Where the ghosts are (the ones not listed are gone). Called a few times a second; the layer glides them between calls. */
	setGhosts(list: readonly DrawnGhost[]): void {
		const now = performance.now();
		const names = new Set(list.map(ghost => ghost.name));
		for (const [name, entry] of this.ghosts) if (!names.has(name as DrawnGhost["name"])) { this.ghostScene.remove(entry.root); entry.model.dispose(); this.ghosts.delete(name); }
		for (const ghost of list) {
			const entry = this.ghosts.get(ghost.name);
			if (entry) { entry.from = this.currentGhost(entry, now); entry.to = ghost; entry.at = now; continue; }
			const model = createGhost(GHOST_COLOURS[ghost.name]);
			const root = new THREE.Group();
			root.add(model.group);
			this.ghostScene.add(root);
			this.ghosts.set(ghost.name, { model, root, from: ghost, to: ghost, at: now, bearing: ghost.bearing, height: 0 });
		}
		this.map.triggerRepaint();
	}

	private currentGhost(entry: GhostEntry, now: number): DrawnGhost {
		const t = Math.min(1, (now - entry.at) / GHOST_STEP_MS);
		return { ...entry.to, pos: [entry.from.pos[0] + (entry.to.pos[0] - entry.from.pos[0]) * t, entry.from.pos[1] + (entry.to.pos[1] - entry.from.pos[1]) * t] };
	}

	/** The bonus fruit on the map (null for none). */
	setFruit(fruit: LiveFruit | null): void {
		if (this.fruit && fruit && this.fruit.fruit.kind === fruit.kind && this.fruit.fruit.pos === fruit.pos) { this.fruit.fruit = fruit; return; }
		if (this.fruit) { this.ghostScene.remove(this.fruit.root); this.fruit.model.dispose(); this.fruit = null; }
		if (fruit) {
			const model = createFruit(fruit.kind), root = new THREE.Group();
			root.add(model.group);
			this.ghostScene.add(root);
			this.fruit = { model, root, fruit, height: 0 };
		}
		this.map.triggerRepaint();
	}

	/** Places the fruit for this frame: upright on the screen, bobbing a little, flashing as its time runs out. */
	private placeFruit(now: number, zoom: number): void {
		const entry = this.fruit;
		if (!entry) return;
		const radius = FRUIT_RADIUS_UNITS * puckModelScale(zoom);
		const left = entry.fruit.expiresAt - now;
		entry.root.visible = left > 0 && (left > FRUIT_FLASH_MS || Math.floor(now / 220) % 2 === 0);
		let ground: number | null = null;
		try { ground = this.map.queryTerrainElevation({ lng: entry.fruit.pos[0], lat: entry.fruit.pos[1] }); } catch { /* No terrain yet. */ }
		if (ground !== null) entry.height = ground;
		entry.root.scale.setScalar(radius);
		const [east, north] = toLocalMetres(this.anchor, entry.fruit.pos);
		entry.root.position.set(east, north, entry.height + radius * (0.1 + 0.08 * Math.sin(now / 280)));
		entry.root.rotation.z = -(this.map.getBearing() * Math.PI) / 180;
	}

	/** Places every ghost model for this frame. */
	private placeGhosts(now: number, zoom: number): void {
		const mapBearing = this.map.getBearing();
		const radius = GHOST_RADIUS_UNITS * puckModelScale(zoom);
		for (const entry of this.ghosts.values()) {
			const at = this.currentGhost(entry, now);
			// Turns the short way round to the way it is going.
			const turn = ((at.bearing - entry.bearing + 540) % 360) - 180;
			entry.bearing = (entry.bearing + turn * 0.25 + 360) % 360;
			let ground: number | null = null;
			try { ground = this.map.queryTerrainElevation({ lng: at.pos[0], lat: at.pos[1] }); } catch { /* No terrain yet. */ }
			if (ground !== null) entry.height = ground;
			entry.model.setMood(at.mood);
			entry.model.update(now / 1000);
			// The ghost stays upright on the screen, as in the arcade, and its pupils look the way it is going (on the screen).
			const looking = (((entry.bearing - mapBearing) % 360) * Math.PI) / 180;
			entry.model.look(Math.sin(looking), Math.cos(looking));
			entry.root.scale.setScalar(radius);
			// It lies just clear of the ground.
			const [east, north] = toLocalMetres(this.anchor, at.pos);
			entry.root.position.set(east, north, entry.height + radius * 0.06);
			entry.root.rotation.z = -(mapBearing * Math.PI) / 180;
		}
	}

	/** Replaces the dots drawn. */
	setDots(anchor: LngLat, dots: readonly DrawnDot[]): void {
		this.anchor = anchor;
		this.dotsLocal = [];
		this.pelletsLocal = [];
		this.dotsPos = [];
		this.pelletsPos = [];
		for (const dot of dots) {
			(dot.pellet ? this.pelletsLocal : this.dotsLocal).push(...toLocalMetres(anchor, dot.pos));
			(dot.pellet ? this.pelletsPos : this.dotsPos).push(dot);
		}
		this.dotMesh = this.fit(this.dotMesh, this.dotGeometry, this.dotsLocal.length / 2);
		this.pelletMesh = this.fit(this.pelletMesh, this.pelletGeometry, this.pelletsLocal.length / 2);
		this.updateHeights();
		this.map.triggerRepaint();
	}

	/** Looks up the ground height under every dot. Dots whose terrain tile is not loaded yet are tried again as tiles arrive. */
	private updateHeights(): void {
		this.heightsPending = false;
		// Heights read at a very different zoom are not to be trusted for a first guess.
		const zoom = this.map.getZoom();
		if (this.heightCache.size > 200_000 || Math.abs(zoom - this.cacheZoom) > 0.4) { this.heightCache.clear(); this.cacheZoom = zoom; }
		const look = (dots: DrawnDot[]): number[] => dots.map(dot => {
			const known = this.heightCache.get(dot.id);
			if (known !== undefined) return known;
			let height: number | null = null;
			try { height = this.map.queryTerrainElevation({ lng: dot.pos[0], lat: dot.pos[1] }); } catch { /* No terrain yet. */ }
			if (height === null) { this.heightsPending = true; return 0; }
			this.heightCache.set(dot.id, height);
			return height;
		});
		this.dotsHeight = look(this.dotsPos);
		this.pelletsHeight = look(this.pelletsPos);
		this.appliedSize = 0;
		this.map.triggerRepaint();
	}

	/** A mesh with room for `count` instances: the same one if it is big enough, else a bigger one. */
	private fit(mesh: THREE.InstancedMesh, geometry: THREE.BufferGeometry, count: number): THREE.InstancedMesh {
		if (count <= mesh.instanceMatrix.count) return mesh;
		this.scene.remove(mesh);
		mesh.dispose();
		return this.makeMesh(geometry, Math.max(count, Math.ceil(mesh.instanceMatrix.count * 1.5)));
	}

	/** Puts one of the shape in each place, `unit` metres to a block of it, standing on the ground there. */
	private place(mesh: THREE.InstancedMesh, local: number[], heights: number[], unit: number): void {
		const n = local.length / 2;
		for (let i = 0; i < n; i++) {
			this.instance.makeScale(unit, unit, unit).setPosition(local[i * 2], local[i * 2 + 1], (heights[i] ?? 0));
			mesh.setMatrixAt(i, this.instance);
		}
		mesh.count = n;
		mesh.instanceMatrix.needsUpdate = true;
	}

	/** Reads the ground height again under the next slice of dots, and moves the ones that have changed. */
	private refreshHeights(radius: number): void {
		const dots = this.dotsPos.length, total = dots + this.pelletsPos.length;
		if (!total) return;
		let movedDots = false, movedPellets = false;
		for (let k = 0; k < Math.min(total, REFRESH_PER_FRAME); k++) {
			this.refreshAt = (this.refreshAt + 1) % total;
			const asDot = this.refreshAt < dots;
			const index = asDot ? this.refreshAt : this.refreshAt - dots;
			const dot = asDot ? this.dotsPos[index] : this.pelletsPos[index];
			let height: number | null = null;
			try { height = this.map.queryTerrainElevation({ lng: dot.pos[0], lat: dot.pos[1] }); } catch { /* No terrain yet. */ }
			if (height === null) continue;
			const heights = asDot ? this.dotsHeight : this.pelletsHeight;
			if (Math.abs(height - (heights[index] ?? 0)) < 0.05) continue;
			heights[index] = height;
			this.heightCache.set(dot.id, height);
			const local = asDot ? this.dotsLocal : this.pelletsLocal, unit = asDot ? radius : radius * PELLET_PIXEL;
			this.instance.makeScale(unit, unit, unit).setPosition(local[index * 2], local[index * 2 + 1], height);
			(asDot ? this.dotMesh : this.pelletMesh).setMatrixAt(index, this.instance);
			if (asDot) movedDots = true; else movedPellets = true;
		}
		if (movedDots) this.dotMesh.instanceMatrix.needsUpdate = true;
		if (movedPellets) this.pelletMesh.instanceMatrix.needsUpdate = true;
	}

	private render(matrix: number[]): void {
		if (this.disposed) return;
		const map = this.map;
		const zoom = map.getZoom();
		if (!this.enabled || zoom < DOTS_FROM_ZOOM || (!this.dotsLocal.length && !this.pelletsLocal.length && !this.ghosts.size && !this.fruit)) {
			this.renderer.setClearColor(0x000000, 0);
			this.renderer.clear();
			return;
		}
		const origin = mapboxgl.MercatorCoordinate.fromLngLat({ lng: this.anchor[0], lat: this.anchor[1] }, 0);
		const metre = origin.meterInMercatorCoordinateUnits();
		// Metres per CSS pixel at this zoom and place.
		const perPixel = (78_271.517 * Math.cos((this.anchor[1] * Math.PI) / 180)) / 2 ** zoom;
		const radius = Math.min(MAX_DOT_M, Math.max(MIN_DOT_M, DOT_PX * perPixel));
		if (Math.abs(radius - this.appliedSize) > radius * 0.04 || !this.appliedSize) {
			this.appliedSize = radius;
			this.place(this.dotMesh, this.dotsLocal, this.dotsHeight, radius);
			this.place(this.pelletMesh, this.pelletsLocal, this.pelletsHeight, radius * PELLET_PIXEL);
		}
		this.refreshHeights(radius);
		// The power pellets blink.
		this.pelletMesh.visible = Math.floor(performance.now() / BLINK_MS) % 2 === 0;
		this.placeGhosts(performance.now(), zoom);
		this.placeFruit(performance.now(), zoom);
		// Local metres (east, north, up) to Mercator (east, south, up).
		this.m4.fromArray(matrix);
		this.l4.makeTranslation(origin.x, origin.y, origin.z ?? 0).scale(new THREE.Vector3(metre, -metre, metre));
		this.camera.projectionMatrix = this.m4.multiply(this.l4);
		this.renderer.clear();
		this.renderer.render(this.scene, this.camera);
		this.renderer.clearDepth();
		this.renderer.render(this.ghostScene, this.camera);
		// Pellets blink, so a frame is wanted whenever there are any in view.
		if (this.pelletsLocal.length || this.ghosts.size || this.fruit) map.triggerRepaint();
	}

	dispose(): void {
		this.disposed = true;
		const map = this.map;
		map.off("styledata", this.ensureLayer);
		map.off("sourcedata", this.ensureLayer);
		map.off("style.load", this.ensureLayer);
		map.off("resize", this.onResize);
		map.off("sourcedata", this.onTerrain);
		map.off("idle", this.onTerrain);
		window.clearTimeout(this.heightTimer);
		try { if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID); } catch { /* The map is already gone. */ }
		this.canvas.remove();
		for (const entry of this.ghosts.values()) entry.model.dispose();
		this.ghosts.clear();
		this.fruit?.model.dispose();
		this.fruit = null;
		this.dotMesh.dispose();
		this.pelletMesh.dispose();
		this.dotGeometry.dispose();
		this.pelletGeometry.dispose();
		this.material.dispose();
		this.renderer.dispose();
	}
}
