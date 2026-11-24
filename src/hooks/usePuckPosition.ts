import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import spaceShuttle from "../../public/models/space_shuttle.glb";
import textureUrl from "../../public/models/texture.jpg";
import type { CameraMode, Orientation } from "../constants";
import { ZOOM_LEVEL } from "../constants";
import { createPacman } from "../lib/pacmanModel";
import { lookAheadCamera, puckModelScale, smoothToward } from "../lib/cameraLookAhead";
import { puckOffset, puckScreenPoint } from "../lib/cameraPadding";
import { locateOnRoute, nextOffTrack, pointAtDistance, routeCache, segmentAtDistance, type Located } from "../lib/routeLocate";
import { nearestLongitude } from "../lib/showcase";
import { repaintSoon } from "../lib/repaint";

// How quickly the rendered bearing chases the target bearing.
const BEARING_LERP_SPEED = 2.5;

// ── Camera follow thresholds ──────────────────────────────────────────────────
// jumpTo is skipped when the camera hasn't meaningfully changed.
// This prevents 60fps jumpTo calls from fighting Wayland's gesture recogniser.
// Kept tiny: at a few m/s a larger threshold made the camera advance in visible steps while the puck moved every frame.
const CAMERA_POS_THRESHOLD_M = 0.01;
const CAMERA_BEARING_THRESHOLD_DEG = 0.05;
const RECENTER_MS = 800; // duration of the recentre blend
const METERS_PER_DEGREE = 111_320;

function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const R = 6_371_000;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lerpBearing(current: number, target: number, alpha: number): number {
	let delta = target - current;
	if (delta > 180) delta -= 360;
	if (delta < -180) delta += 360;
	return current + delta * alpha;
}

export function usePositionPuck(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
	initialPos: [number, number],
	coordsRef: React.RefObject<[number, number][]>,
	followingRef: React.RefObject<CameraMode>,
	orientationRef: React.RefObject<Orientation>,
	cameraTransitionRef: React.RefObject<boolean>,
	trimRouteByDistance: (distanceM: number) => void,
	mapOffset: React.RefObject<number>,
	/** While `enabled`, the follow camera zooms and tilts with speed and the next turn. */
	lookAheadRef?: React.RefObject<{ enabled: boolean; distanceToNextM: number | null; significantTurn?: boolean }>,
	/** How much fog (0–1) lies over the car on screen, from Explore mode: the car then shows as a faint outline. */
	fogOverPuckRef?: React.RefObject<number>,
	/** True while Pac-Man mode is on: the car is then drawn as Pac-Man instead of the shuttle, and the following camera looks straight down. */
	pacmanRef?: React.RefObject<boolean>,
) {
	const speedMsRef = useRef<number>(0);
	const distancesFor = useRef(routeCache()).current;
	// Metres along the route of a position, searched near where the puck already is so that a route passing the same spot twice cannot jump it to the other pass.
	function locateOnCurrentRoute(coords: [number, number][], pos: [number, number]): Located {
		const cumulative = distancesFor(coords);
		const hint = distanceCursorRef.current >= 0 ? segmentAtDistance(cumulative, distanceCursorRef.current) : 0;
		return locateOnRoute(coords, cumulative, pos, hint);
	}
	function distanceAlongRouteToPoint(coords: [number, number][], pos: [number, number]): number {
		return locateOnCurrentRoute(coords, pos).along;
	}
	// True while the car is away from the route line (a missed turn, a detour): the puck then goes where the GPS says, facing the GPS heading,
	// instead of sliding along a line the car is not on.
	const offTrackRef = useRef(false);
	const distanceCursorRef = useRef<number>(-1);

	const gpsPosRef = useRef<[number, number]>(initialPos);
	const gpsBearingRef = useRef<number>(0);
	const gpsFixTimeRef = useRef<number>(performance.now());
	// Speed as the camera sees it: smoothed, so a GPS speed that steps down does not step the zoom.
	const smoothSpeedRef = useRef<number>(0);

	const targetBearingRef = useRef<number>(0);
	const renderPosRef = useRef<[number, number]>(initialPos);
	const renderBearingRef = useRef<number>(0);

	const lastFrameTimeRef = useRef<number>(performance.now());

	// ── Camera follow: track last committed camera position/bearing ───────────
	// jumpTo is only called when the puck has moved enough to justify it.
	// This stops the 60fps jumpTo spam that fights Wayland gesture recognition.
	const lastCameraPosRef = useRef<[number, number]>(initialPos);
	const lastCameraBearingRef = useRef<number>(0);
	const lastCameraOffsetRef = useRef<number>(mapOffset.current);
	const lastCameraPaddingRef = useRef<string>("");
	const cameraZoomRef = useRef<number>(ZOOM_LEVEL);
	const cameraPitchRef = useRef<number>(45);
	const lastCameraZoomRef = useRef<number>(ZOOM_LEVEL);
	const lastCameraPitchRef = useRef<number>(45);

	// ── Easing lock: suppresses jumpTo while smoothLocate's easeTo is running ─
	const isEasingRef = useRef<boolean>(false);
	const wasFollowingRef = useRef<boolean>(true);

	// ── Recentre blend ────────────────────────────────────────────────────────
	// Set by smoothLocate. The render loop blends the camera from this captured
	// view to the live follow view, so the move stays smooth while the car is
	// moving and ends exactly on the puck with no snap.
	const recenterRef = useRef<{
		started: number;
		anchor: [number, number];
		bearing: number;
		pitch: number;
		zoom: number;
	} | null>(null);

	function syncPuck(pos: [number, number], bearing: number, speedMs: number) {
		gpsPosRef.current = pos;
		gpsBearingRef.current = bearing;
		speedMsRef.current = speedMs;
		gpsFixTimeRef.current = performance.now();
		targetBearingRef.current = bearing;
		renderBearingRef.current = bearing;
		renderPosRef.current = [...pos] as [number, number];
		lastCameraPosRef.current = [...pos] as [number, number];
		lastCameraBearingRef.current = bearing;
		lastFrameTimeRef.current = performance.now();

		const coords = coordsRef.current;
		distanceCursorRef.current = -1;
		offTrackRef.current = false;
		if (coords.length >= 2) {
			const located = locateOnCurrentRoute(coords, pos);
			distanceCursorRef.current = located.along;
			offTrackRef.current = nextOffTrack(false, located.offsetM);
		}
		mapRef.current?.triggerRepaint();
	}

	useEffect(() => {
		if (!mapLoaded || !mapRef.current) return;
		const map = mapRef.current;
		const mapCanvas = map.getCanvas();
		const container = mapCanvas.parentElement!;

		// The car's own canvas covers only a square round the car, moved with it (see placeOverlay): a full-screen canvas with
		// antialiasing cost the car computer's GPU a few milliseconds every frame to clear, resolve and composite, for a car ~100 px across.
		const overlayCanvas = document.createElement("canvas");
		overlayCanvas.style.cssText = `
      position:absolute;top:0;left:0;
      transform-origin:0 0;
      pointer-events:none;z-index:2;
    `;
		overlayCanvas.width = 64;
		overlayCanvas.height = 64;
		container.appendChild(overlayCanvas);

		const camera = new THREE.Camera();
		const scene = new THREE.Scene();
		const renderer = new THREE.WebGLRenderer({
			canvas: overlayCanvas,
			antialias: true,
			alpha: true,
			// For the outline shown when fog is in front of the car.
			stencil: true,
		});
		renderer.setClearColor(0x000000, 0);
		renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

		const ringGeo = new THREE.RingGeometry(1.2, 1.8, 48);
		const pulseMat = new THREE.MeshBasicMaterial({
			color: 0x3b82f6,
			transparent: true,
			opacity: 0.8,
			side: THREE.DoubleSide,
		});
		const pulseBlue = pulseMat.color.clone();
		const pulseYellow = new THREE.Color().setRGB(1, 0.8, 0.05, THREE.LinearSRGBColorSpace);
		const pulseRing = new THREE.Mesh(ringGeo, pulseMat);
		pulseRing.rotation.x = -Math.PI / 2;
		scene.add(pulseRing);

		// With fog in front of the car it shows as a faint ghost inside a light outline. The outline is a slightly larger
		// copy of the model drawn only outside the model's own silhouette (the model marks its pixels in the stencil).
		const bodyMaterials: THREE.MeshBasicMaterial[] = [];
		const outlineMaterial = new THREE.MeshBasicMaterial({
			color: 0xd8e6ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
			stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
		});
		let outline: THREE.Object3D | null = null;
		let shuttle: THREE.Object3D | null = null;
		let fogShown = 0;
		let lastRenderAt = performance.now();
		// Pac-Man mode's car, shown instead of the shuttle.
		const pacman = createPacman();
		scene.add(pacman.group);
		// Everything drawn, in the scene's units: the pulse ring at its widest (1.8 × 4), Pac-Man, and the shuttle once loaded; with room to spare.
		const drawnBounds = new THREE.Box3(new THREE.Vector3(-7.2, -0.5, -7.2), new THREE.Vector3(7.2, 0.5, 7.2))
			.union(new THREE.Box3().setFromObject(pacman.group).expandByScalar(0.5));

		const texture = new THREE.Texture();
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.flipY = false;
		const img = new Image();
		let disposed = false;
		img.onload = () => {
			if (disposed) return;
			texture.image = img;
			texture.needsUpdate = true;
			new GLTFLoader().load(spaceShuttle, (gltf) => {
				gltf.scene.traverse((child) => {
					if (!(child as THREE.Mesh).isMesh) return;
					const mesh = child as THREE.Mesh;
					const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
					if (disposed) {
						mesh.geometry.dispose();
						materials.forEach((material) => { if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); });
						return;
					}
					materials.forEach((material) => { if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); });
					const body = new THREE.MeshBasicMaterial({
						map: texture, transparent: true,
						stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
					});
					bodyMaterials.push(body);
					mesh.material = body;
				});
				if (!disposed) {
					shuttle = gltf.scene; scene.add(gltf.scene);
					drawnBounds.union(new THREE.Box3().setFromObject(gltf.scene).expandByScalar(0.5));
					// The outline: the same shape, 8% bigger about its middle.
					const centre = new THREE.Box3().setFromObject(gltf.scene).getCenter(new THREE.Vector3());
					const copy = gltf.scene.clone(true);
					copy.traverse((child) => { if ((child as THREE.Mesh).isMesh) { (child as THREE.Mesh).material = outlineMaterial; child.renderOrder = 2; } });
					copy.position.copy(centre).multiplyScalar(-1);
					outline = new THREE.Group().add(copy);
					outline.position.copy(centre);
					outline.scale.setScalar(1.08);
					outline.visible = false;
					scene.add(outline);
					map.triggerRepaint();
				}
			}, undefined, () => console.error("Unable to load vehicle model."));
		};
		img.onerror = () => console.error("Unable to load shuttle texture.");
		img.src = textureUrl;

		const m4 = new THREE.Matrix4();
		const l4 = new THREE.Matrix4();
		const rotX = new THREE.Matrix4().makeRotationAxis(
			new THREE.Vector3(1, 0, 0),
			Math.PI / 2,
		);
		const rotY = new THREE.Matrix4();
		const scaleVec = new THREE.Vector3();

		function renderModel(matrix: number[]) {
			const pos = renderPosRef.current;
			const brg = renderBearingRef.current;
			const mercator = mapboxgl.MercatorCoordinate.fromLngLat(
				{ lng: pos[0], lat: pos[1] },
				map.queryTerrainElevation(pos) ?? 0,
			);
			const scale = mercator.meterInMercatorCoordinateUnits();
			const bearingRad = ((brg + 180) * Math.PI) / 180;
			const zoom = map.getZoom();
			const modelScale = puckModelScale(zoom);

			// Fade between the car and its outline as fog comes and goes in front of it.
			const fog = Math.min(1, Math.max(0, fogOverPuckRef?.current ?? 0));
			fogShown += (fog - fogShown) * 0.2;
			if (fogShown < 0.01) fogShown = 0;
			for (const body of bodyMaterials) body.opacity = 1 - 0.85 * fogShown;
			outlineMaterial.opacity = 0.9 * fogShown;
			const pac = pacmanRef?.current ?? false;
			if (outline) outline.visible = fogShown > 0 && !pac;
			if (shuttle) shuttle.visible = !pac;
			pacman.group.visible = pac;
			const frameAt = performance.now();
			if (pac) pacman.update(Math.min((frameAt - lastRenderAt) / 1000, 0.1), speedMsRef.current);
			lastRenderAt = frameAt;
			pulseMat.opacity *= 1 - 0.7 * fogShown;

			rotY.makeRotationAxis(new THREE.Vector3(0, 1, 0), -bearingRad);
			scaleVec.set(scale * modelScale, -scale * modelScale, scale * modelScale);
			m4.fromArray(matrix);
			l4.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0)
				.scale(scaleVec)
				.multiply(rotX)
				.multiply(rotY);
			const full = m4.multiply(l4);
			if (!placeOverlay(full)) return;
			camera.projectionMatrix.multiplyMatrices(crop, full);
			renderer.render(scene, camera);
		}

		// The small canvas: its size (device pixels, in steps), where it sits on the map, and the matrix that crops the view to it.
		const crop = new THREE.Matrix4();
		const corner = new THREE.Vector4();
		let overlayW = 0, overlayH = 0, overlayAt = "";
		const STEP = 64;
		/**
		 * Puts the car's canvas over the part of the map the car (and its pulse) covers this frame: the corners of everything drawn are
		 * projected with the frame's own matrix. Its size changes only in steps (growing at once, shrinking when well over), and it sits on
		 * whole pixels, so the car is drawn exactly as it was on the full-screen canvas. False when the car is off the map.
		 */
		function placeOverlay(full: THREE.Matrix4): boolean {
			const W = mapCanvas.width, H = mapCanvas.height;
			const dpr = W / Math.max(1, mapCanvas.clientWidth);
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, behind = false;
			const { min, max } = drawnBounds;
			for (let i = 0; i < 8 && !behind; i++) {
				corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z, 1).applyMatrix4(full);
				if (corner.w <= 1e-6) { behind = true; break; }
				const x = (corner.x / corner.w * 0.5 + 0.5) * W, y = (0.5 - corner.y / corner.w * 0.5) * H;
				minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
			}
			// Part of it behind the camera (only when looking out level): the whole map.
			if (behind) { minX = 0; minY = 0; maxX = W; maxY = H; }
			if (maxX < 0 || maxY < 0 || minX > W || minY > H) { overlayCanvas.style.visibility = "hidden"; return false; }
			const needW = Math.min(W * 2, maxX - minX + 16), needH = Math.min(H * 2, maxY - minY + 16);
			if (needW > overlayW || needW < overlayW - 2 * STEP || needH > overlayH || needH < overlayH - 2 * STEP) {
				overlayW = Math.ceil(needW / STEP) * STEP;
				overlayH = Math.ceil(needH / STEP) * STEP;
				renderer.setSize(overlayW, overlayH, false);
				overlayCanvas.style.width = `${overlayW / dpr}px`;
				overlayCanvas.style.height = `${overlayH / dpr}px`;
			}
			const left = Math.round((minX + maxX - overlayW) / 2), top = Math.round((minY + maxY - overlayH) / 2);
			const at = `translate(${left / dpr}px, ${top / dpr}px)`;
			if (at !== overlayAt) { overlayCanvas.style.transform = at; overlayAt = at; }
			overlayCanvas.style.visibility = "";
			// Clip space of the whole map to clip space of this rectangle of it.
			const hx = overlayW / W, hy = overlayH / H;
			const cx = ((left + overlayW / 2) / W) * 2 - 1, cy = 1 - ((top + overlayH / 2) / H) * 2;
			crop.set(1 / hx, 0, 0, -cx / hx, 0, 1 / hy, 0, -cy / hy, 0, 0, 1, 0, 0, 0, 0, 1);
			return true;
		}

		const dummyLayer: mapboxgl.CustomLayerInterface = {
			id: "puck-layer",
			type: "custom",
			renderingMode: "3d",
			onAdd() {
				//Nothing
			},

			render(_gl, matrix) {
				const now = performance.now();
				const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
				lastFrameTimeRef.current = now;
				// Whether the camera was moved this frame: if not, and the car is still, the next frame can wait (see the end).
				let cameraMoved = false;

				const coords = coordsRef.current;
				const hasRoute = coords.length >= 2 && distanceCursorRef.current >= 0 && !offTrackRef.current;
				const bearingAlpha = 1 - Math.exp(-BEARING_LERP_SPEED * dt);

				if (hasRoute) {
					distanceCursorRef.current += speedMsRef.current * dt;
					const here = pointAtDistance(coords, distancesFor(coords), distanceCursorRef.current);
					renderPosRef.current = here.pos;
					trimRouteByDistance(distanceCursorRef.current);
					if (speedMsRef.current > 0.5) {
						targetBearingRef.current = here.bearing;
					}
				} else {
					// No route: dead-reckon. Glide along the heading at the current speed every frame, and only gently pull toward where the GPS says the car is by now,
					// so the 1 Hz fixes do not show up as stop-start movement.
					const speed = speedMsRef.current > 0.5 ? speedMsRef.current : 0;
					const headingRad = (gpsBearingRef.current * Math.PI) / 180;
					const cosLat = Math.max(0.01, Math.cos((renderPosRef.current[1] * Math.PI) / 180));
					const vLon = (speed * Math.sin(headingRad)) / (METERS_PER_DEGREE * cosLat);
					const vLat = (speed * Math.cos(headingRad)) / METERS_PER_DEGREE;
					const fixAge = Math.min(3, (now - gpsFixTimeRef.current) / 1000);
					const predicted: [number, number] = [gpsPosRef.current[0] + vLon * fixAge, gpsPosRef.current[1] + vLat * fixAge];
					let next: [number, number] = [renderPosRef.current[0] + vLon * dt, renderPosRef.current[1] + vLat * dt];
					if (haversineMeters(next, predicted) > 60) next = predicted;
					const posAlpha = 1 - Math.exp(-dt / (speed > 0 ? 0.9 : 0.25));
					renderPosRef.current = [
						next[0] + (predicted[0] - next[0]) * posAlpha,
						next[1] + (predicted[1] - next[1]) * posAlpha,
					];
					if (speedMsRef.current > 0.5) {
						targetBearingRef.current = gpsBearingRef.current;
					}
				}

				if (speedMsRef.current > 0.5) {
					renderBearingRef.current = lerpBearing(
						renderBearingRef.current,
						targetBearingRef.current,
						bearingAlpha,
					);
				}

				// ── Pulse ring ────────────────────────────────────────────────────────
				const pt = (Date.now() % 1800) / 1800;
				// The pulse is blue, or Pac-Man yellow in Pac-Man mode (where blue is the maze's walls).
				pulseMat.color.copy(pacmanRef?.current ? pulseYellow : pulseBlue);
				pulseRing.scale.setScalar(1 + pt * 3);
				pulseMat.opacity = (1 - pt) * 0.7;

				renderModel(matrix);

				// ── Camera follow ─────────────────────────────────────────────────────
				// Guard 1: skip entirely while smoothLocate's easeTo is animating.
				// Guard 2: skip if position/bearing haven't meaningfully changed —
				//          prevents 60fps jumpTo calls blocking Wayland gestures.
					const following = followingRef.current === "following";
					if (!following) recenterRef.current = null;
					// However the camera comes back to following (a button, the auto-return after browsing, a route starting), glide
					// back to the car instead of snapping: only a deliberate smoothLocate used to do that.
					// (Not while a flight is running, such as the fly-down from the globe: that brings the camera back itself.)
					else if (!wasFollowingRef.current && !recenterRef.current && !cameraTransitionRef.current) smoothLocate();
					wasFollowingRef.current = following;
					const recenter = recenterRef.current;
					if (recenter && !cameraTransitionRef.current) {
						const t = Math.min(1, (now - recenter.started) / RECENTER_MS);
						const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
						const heading = orientationRef.current === "heading";
						const goal = renderPosRef.current;
						const goalBearing = heading ? renderBearingRef.current : 0;
						// Blend along the short way round the world: the longitudes are not simply averaged, or a camera that has been turned
						// round the globe (by hand) would sweep back round the whole Earth, once for every turn it was given.
						const goalLng = nearestLongitude(goal[0], recenter.anchor[0]);
						cameraMoved = true;
						map.easeTo({
							center: [
								recenter.anchor[0] + (goalLng - recenter.anchor[0]) * e,
								recenter.anchor[1] + (goal[1] - recenter.anchor[1]) * e,
							],
							bearing: lerpBearing(recenter.bearing, goalBearing, e),
							// Pac-Man mode looks straight down.
							pitch: recenter.pitch + ((heading && !pacmanRef?.current ? 45 : 0) - recenter.pitch) * e,
							zoom: recenter.zoom + (cameraZoomRef.current - recenter.zoom) * e,
							offset: puckOffset(map, mapOffset.current),
							duration: 0,
							essential: true,
						});
						lastCameraPosRef.current = [...goal] as [number, number];
						lastCameraBearingRef.current = goalBearing;
						lastCameraOffsetRef.current = mapOffset.current;
						if (t >= 1) {
							recenterRef.current = null;
							// Following carries on from where the recentre ended: straight down in Pac-Man mode, tilted otherwise. A remembered
							// pitch from the other mode (flat after Pac-Man, tilted before it) would otherwise snap the view and ease it back again.
							cameraPitchRef.current = pacmanRef?.current ? 0 : 45;
						}
					} else if (
						followingRef.current === "following" &&
						!isEasingRef.current &&
						!cameraTransitionRef.current
					) {
					// Pac-Man mode looks straight down (the view still turns with the car's heading).
					const topDown = pacmanRef?.current ?? false;
					const targetBearing =
						orientationRef.current === "heading" ? renderBearingRef.current : 0;
					const lookAhead = lookAheadRef?.current;
					// Smooth the speed itself: GPS speed steps down in chunks, and the zoom followed those steps.
					smoothSpeedRef.current = smoothToward(smoothSpeedRef.current, speedMsRef.current, dt * 1000, 1500);
					const desired = lookAhead?.enabled
						? lookAheadCamera({ speedMs: smoothSpeedRef.current, distanceToNextM: lookAhead.distanceToNextM, significantTurn: lookAhead.significantTurn })
						: { zoom: ZOOM_LEVEL, pitch: 45 };
					// Close in fairly quickly for a turn, but ease back out slowly so back-to-back turns do not make the map breathe.
					cameraZoomRef.current = smoothToward(cameraZoomRef.current, desired.zoom, dt * 1000, desired.zoom > cameraZoomRef.current ? 1200 : 3500);
					cameraPitchRef.current = smoothToward(cameraPitchRef.current, topDown ? 0 : desired.pitch, dt * 1000, 1500);
					const targetZoom = cameraZoomRef.current;
					const targetPitch = orientationRef.current === "heading" || topDown ? cameraPitchRef.current : 0;
					const targetCenter = renderPosRef.current;
					const cameraOffset = puckOffset(map, mapOffset.current);
					// Padding changes too (a side dock appears, the screen resizes): the car has to be put back where it belongs.
					const pad = map.getPadding();
					const paddingKey = `${pad.left},${pad.right},${pad.top},${pad.bottom}`;

					const posDelta = haversineMeters(
						lastCameraPosRef.current,
						targetCenter,
					);
					const bearingDelta = Math.abs(
						((targetBearing - lastCameraBearingRef.current + 540) % 360) - 180,
					);

					// The offset glides when a panel opens or closes; follow it frame by
					// frame so the map slides instead of jumping.
					const offsetMoved =
						Math.abs(mapOffset.current - lastCameraOffsetRef.current) > 0.0005 || paddingKey !== lastCameraPaddingRef.current;

					const lensMoved =
						Math.abs(targetZoom - lastCameraZoomRef.current) > 0.0005 ||
						Math.abs(targetPitch - lastCameraPitchRef.current) > 0.02;

					if (
						posDelta > CAMERA_POS_THRESHOLD_M ||
						bearingDelta > CAMERA_BEARING_THRESHOLD_DEG ||
						offsetMoved ||
						lensMoved
					) {
						lastCameraZoomRef.current = targetZoom;
						lastCameraPitchRef.current = targetPitch;
						lastCameraOffsetRef.current = mapOffset.current;
						lastCameraPaddingRef.current = paddingKey;
						cameraMoved = true;
						map.easeTo({
							center: targetCenter,
							bearing: targetBearing,
							pitch: targetPitch,
							zoom: targetZoom,
							offset: cameraOffset,
							duration: 0,
							essential: true,
						});
						lastCameraPosRef.current = [...targetCenter] as [number, number];
						lastCameraBearingRef.current = targetBearing;
					}
				}

				// Moving (or the camera gliding somewhere): every frame. Parked with the camera still, only the pulse animates, and 30 fps
				// is plenty for that: it halves the work (and the heat, which slowed the car computer down once it was driving).
				if (speedMsRef.current > 0.5 || cameraMoved || recenterRef.current || cameraTransitionRef.current) map.triggerRepaint();
				else repaintSoon(map);
			},
		};

		const addLayer = () => {
			if (!map.isStyleLoaded()) return;
			// Only when it was missing: this runs on every style change (the route line is trimmed as the car moves).
			if (!map.getLayer("puck-layer")) { map.addLayer(dummyLayer); map.triggerRepaint(); }
		};

		const onStyleLoad = () => {
			syncPuck(gpsPosRef.current, gpsBearingRef.current, speedMsRef.current);
			onResize();
			addLayer();
		};

		addLayer();
		map.on("styledata", addLayer);
		map.on("sourcedata", addLayer);
		map.on("style.load", onStyleLoad);

		// The map's size or pixel density changed: size the car's canvas afresh on the next frame.
		const onResize = () => { overlayW = 0; overlayH = 0; overlayAt = ""; map.triggerRepaint(); };
		map.on("resize", onResize);


		return () => {
			map.off("resize", onResize);
			map.off("styledata", addLayer);
			map.off("sourcedata", addLayer);
			map.off("style.load", onStyleLoad);
			if (map.getLayer("puck-layer")) map.removeLayer("puck-layer");
			overlayCanvas.remove();
            disposed = true;
            img.onload = null;
            img.onerror = null;
            texture.dispose();
            ringGeo.dispose();
            pulseMat.dispose();
            outlineMaterial.dispose();
            pacman.dispose();
            scene.traverse((child) => {
                if (child instanceof THREE.Mesh && child !== pulseRing) {
                    child.geometry.dispose();
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => { if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); });
                }
            });
            renderer.dispose();
		};
	}, [mapLoaded]);

	function updatePuck(pos: [number, number], bearing: number, speedMs: number) {
		gpsPosRef.current = pos;
		gpsBearingRef.current = bearing;
		speedMsRef.current = speedMs;
		gpsFixTimeRef.current = performance.now();

		const coords = coordsRef.current;

		if (coords.length < 2) {
			distanceCursorRef.current = -1;
			offTrackRef.current = false;
			return;
		}

		const located = locateOnCurrentRoute(coords, pos);
		const actualDist = located.along;
		offTrackRef.current = nextOffTrack(offTrackRef.current, located.offsetM);

		if (distanceCursorRef.current < 0) {
			distanceCursorRef.current = actualDist;
			renderPosRef.current = [...pos] as [number, number];
			return;
		}
		// Off the line the cursor just follows the car, so rejoining the route carries on from where it really is.
		if (offTrackRef.current) { distanceCursorRef.current = actualDist; return; }

		const error = actualDist - distanceCursorRef.current;

		if (Math.abs(error) > 300) {
			distanceCursorRef.current = actualDist;
			renderPosRef.current = [...pos] as [number, number];
		} else if (Math.abs(error) > 10) {
			distanceCursorRef.current += error * 0.15;
		}
	}

	function resetCursor() {
		distanceCursorRef.current = -1;
		offTrackRef.current = false;
		speedMsRef.current = 0;
	}

	// ── smoothLocate ────────────────────────────────────────────────────────────
	// Called by handleLocate in App.tsx instead of a bare resumeFollowing().
	// Animates the camera back to the puck with easeTo (smooth), then re-enables
	// frame-by-frame jumpTo following after the animation completes.
	// The isEasingRef lock ensures jumpTo doesn't fight the ongoing easeTo.
	function smoothLocate() {
		const map = mapRef.current;
		if (!map) return;
		// Start from the point currently shown where the puck normally sits, so
		// the first blended frame matches the view the driver is looking at.
		const anchor = map.unproject(puckScreenPoint(map, mapOffset.current));
		recenterRef.current = {
			started: performance.now(),
			anchor: [anchor.lng, anchor.lat],
			bearing: map.getBearing(),
			pitch: map.getPitch(),
			zoom: map.getZoom(),
		};
		map.stop();
		map.triggerRepaint();
	}

	/** Where the car is drawn right now. */
	const puckPosition = (): [number, number] => renderPosRef.current;
	return { updatePuck, resetCursor, smoothLocate, syncPuck, puckPosition };
}
