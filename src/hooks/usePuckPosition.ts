import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import spaceShuttle from "../../public/models/space_shuttle.glb";
import textureUrl from "../../public/models/texture.jpg";
import type { CameraMode, Orientation } from "../constants";
import { ZOOM_LEVEL } from "../constants";

// How quickly the rendered bearing chases the target bearing.
const BEARING_LERP_SPEED = 2.5;

// ── Camera follow thresholds ──────────────────────────────────────────────────
// jumpTo is skipped when the camera hasn't meaningfully changed.
// This prevents 60fps jumpTo calls from fighting Wayland's gesture recogniser.
const CAMERA_POS_THRESHOLD_M = 0.5; // skip if puck moved < 0.5 m
const CAMERA_BEARING_THRESHOLD_DEG = 0.3; // skip if bearing changed < 0.3°

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

function positionAlongRoute(
	coords: [number, number][],
	distanceM: number,
): [number, number] {
	if (coords.length === 0) return [0, 0];
	if (coords.length === 1) return coords[0];
	let remaining = Math.max(0, distanceM);
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		if (remaining <= segLen) {
			const t = segLen > 0 ? remaining / segLen : 0;
			return [
				coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
				coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
			];
		}
		remaining -= segLen;
	}
	return coords[coords.length - 1];
}

function bearingAlongRoute(
	coords: [number, number][],
	distanceM: number,
): number {
	if (coords.length < 2) return 0;
	let remaining = Math.max(0, distanceM);
	let segIdx = 0;
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		if (remaining <= segLen) {
			segIdx = i;
			break;
		}
		remaining -= segLen;
		segIdx = i + 1;
	}
	const i = Math.min(segIdx, coords.length - 2);
	const [lon1, lat1] = coords[i];
	const [lon2, lat2] = coords[i + 1];
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const lat1R = (lat1 * Math.PI) / 180;
	const lat2R = (lat2 * Math.PI) / 180;
	const y = Math.sin(dLon) * Math.cos(lat2R);
	const x =
		Math.cos(lat1R) * Math.sin(lat2R) -
		Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function projectOntoSegment(
	pos: [number, number],
	a: [number, number],
	b: [number, number],
): number {
	const ax = b[0] - a[0];
	const ay = b[1] - a[1];
	const bx = pos[0] - a[0];
	const by = pos[1] - a[1];
	const lenSq = ax * ax + ay * ay;
	if (lenSq < 1e-12) return 0;
	return Math.max(0, Math.min(1, (bx * ax + by * ay) / lenSq));
}

function distanceAlongRouteToPoint(
	coords: [number, number][],
	pos: [number, number],
): number {
	if (coords.length < 2) return 0;
	let bestOffRoute = Infinity;
	let bestRouteDistance = 0;
	let cumulative = 0;
	for (let i = 0; i < coords.length - 1; i++) {
		const segLen = haversineMeters(coords[i], coords[i + 1]);
		const t = projectOntoSegment(pos, coords[i], coords[i + 1]);
		const projected: [number, number] = [
			coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
			coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
		];
		const offRoute = haversineMeters(pos, projected);
		if (offRoute < bestOffRoute) {
			bestOffRoute = offRoute;
			bestRouteDistance = cumulative + t * segLen;
		}
		cumulative += segLen;
	}
	return bestRouteDistance;
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
	trimRouteByDistance: (distanceM: number) => void,
) {
	const speedMsRef = useRef<number>(0);
	const distanceCursorRef = useRef<number>(-1);

	const gpsPosRef = useRef<[number, number]>(initialPos);
	const gpsBearingRef = useRef<number>(0);

	const targetBearingRef = useRef<number>(0);
	const renderPosRef = useRef<[number, number]>(initialPos);
	const renderBearingRef = useRef<number>(0);

	const lastFrameTimeRef = useRef<number>(performance.now());

	// ── Camera follow: track last committed camera position/bearing ───────────
	// jumpTo is only called when the puck has moved enough to justify it.
	// This stops the 60fps jumpTo spam that fights Wayland gesture recognition.
	const lastCameraPosRef = useRef<[number, number]>(initialPos);
	const lastCameraBearingRef = useRef<number>(0);

	// ── Easing lock: suppresses jumpTo while smoothLocate's easeTo is running ─
	const isEasingRef = useRef<boolean>(false);

	useEffect(() => {
		if (!mapLoaded || !mapRef.current) return;
		const map = mapRef.current;
		const mapCanvas = map.getCanvas();
		const container = mapCanvas.parentElement!;

		const overlayCanvas = document.createElement("canvas");
		overlayCanvas.style.cssText = `
      position:absolute;top:0;left:0;
      width:100%;height:100%;
      pointer-events:none;z-index:2;
    `;
		overlayCanvas.width = mapCanvas.width;
		overlayCanvas.height = mapCanvas.height;
		container.appendChild(overlayCanvas);

		const camera = new THREE.Camera();
		const scene = new THREE.Scene();
		const renderer = new THREE.WebGLRenderer({
			canvas: overlayCanvas,
			antialias: true,
			alpha: true,
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
		const pulseRing = new THREE.Mesh(ringGeo, pulseMat);
		pulseRing.rotation.x = -Math.PI / 2;
		scene.add(pulseRing);

		const texture = new THREE.Texture();
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.flipY = false;
		const img = new Image();
		img.onload = () => {
			texture.image = img;
			texture.needsUpdate = true;
			new GLTFLoader().load(spaceShuttle, (gltf) => {
				gltf.scene.traverse((child) => {
					if ((child as THREE.Mesh).isMesh)
						(child as THREE.Mesh).material = new THREE.MeshBasicMaterial({
							map: texture,
						});
				});
				scene.add(gltf.scene);
				map.triggerRepaint();
			});
		};
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
				0,
			);
			const scale = mercator.meterInMercatorCoordinateUnits();
			const bearingRad = ((brg + 180) * Math.PI) / 180;
			const zoom = map.getZoom();
			const zoomFactor = Math.pow(2, Math.max(0, 16 - zoom));
			const modelScale = 3 * Math.min(zoomFactor, 8);

			rotY.makeRotationAxis(new THREE.Vector3(0, 1, 0), -bearingRad);
			scaleVec.set(scale * modelScale, -scale * modelScale, scale * modelScale);
			m4.fromArray(matrix);
			l4.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0)
				.scale(scaleVec)
				.multiply(rotX)
				.multiply(rotY);
			camera.projectionMatrix = m4.multiply(l4);
			renderer.render(scene, camera);
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

				const coords = coordsRef.current;
				const hasRoute = coords.length >= 2 && distanceCursorRef.current >= 0;
				const bearingAlpha = 1 - Math.exp(-BEARING_LERP_SPEED * dt);

				if (hasRoute) {
					distanceCursorRef.current += speedMsRef.current * dt;
					renderPosRef.current = positionAlongRoute(
						coords,
						distanceCursorRef.current,
					);
					trimRouteByDistance(distanceCursorRef.current);
					if (speedMsRef.current > 0.5) {
						targetBearingRef.current = bearingAlongRoute(
							coords,
							distanceCursorRef.current,
						);
					}
				} else {
					const posAlpha = 1 - Math.exp(-5 * dt);
					renderPosRef.current = [
						renderPosRef.current[0] +
							(gpsPosRef.current[0] - renderPosRef.current[0]) * posAlpha,
						renderPosRef.current[1] +
							(gpsPosRef.current[1] - renderPosRef.current[1]) * posAlpha,
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
				pulseRing.scale.setScalar(1 + pt * 3);
				pulseMat.opacity = (1 - pt) * 0.7;

				renderModel(matrix);

				// ── Camera follow ─────────────────────────────────────────────────────
				// Guard 1: skip entirely while smoothLocate's easeTo is animating.
				// Guard 2: skip if position/bearing haven't meaningfully changed —
				//          prevents 60fps jumpTo calls blocking Wayland gestures.
				if (followingRef.current === "following" && !isEasingRef.current) {
					const targetCenter = renderPosRef.current;
					const targetBearing =
						orientationRef.current === "heading" ? renderBearingRef.current : 0;
					const targetPitch = orientationRef.current === "heading" ? 45 : 0;

					const posDelta = haversineMeters(
						lastCameraPosRef.current,
						targetCenter,
					);
					const bearingDelta = Math.abs(
						((targetBearing - lastCameraBearingRef.current + 540) % 360) - 180,
					);

					if (
						posDelta > CAMERA_POS_THRESHOLD_M ||
						bearingDelta > CAMERA_BEARING_THRESHOLD_DEG
					) {
						map.jumpTo({
							center: targetCenter,
							bearing: targetBearing,
							pitch: targetPitch,
							zoom: ZOOM_LEVEL,
						});
						lastCameraPosRef.current = [...targetCenter] as [number, number];
						lastCameraBearingRef.current = targetBearing;
					}
				}

				map.triggerRepaint();
			},
		};

		const addLayer = () => {
			if (!map.getLayer("puck-layer")) map.addLayer(dummyLayer);
		};
		map.isStyleLoaded() ? addLayer() : map.once("styledata", addLayer);

		const onResize = () => {
			overlayCanvas.width = mapCanvas.width;
			overlayCanvas.height = mapCanvas.height;
			renderer.setSize(mapCanvas.width, mapCanvas.height, false);
		};
		map.on("resize", onResize);

		return () => {
			map.off("resize", onResize);
			if (map.getLayer("puck-layer")) map.removeLayer("puck-layer");
			overlayCanvas.remove();
			renderer.dispose();
		};
	}, [mapLoaded]);

	function updatePuck(pos: [number, number], bearing: number, speedMs: number) {
		gpsPosRef.current = pos;
		gpsBearingRef.current = bearing;
		speedMsRef.current = speedMs;

		const coords = coordsRef.current;

		if (coords.length < 2) {
			distanceCursorRef.current = -1;
			return;
		}

		const actualDist = distanceAlongRouteToPoint(coords, pos);

		if (distanceCursorRef.current < 0) {
			distanceCursorRef.current = actualDist;
			renderPosRef.current = [...pos] as [number, number];
			return;
		}

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
		speedMsRef.current = 0;
	}

	// ── smoothLocate ────────────────────────────────────────────────────────────
	// Called by handleLocate in App.tsx instead of a bare resumeFollowing().
	// Animates the camera back to the puck with easeTo (smooth), then re-enables
	// frame-by-frame jumpTo following after the animation completes.
	// The isEasingRef lock ensures jumpTo doesn't fight the ongoing easeTo.
	function smoothLocate(pos: [number, number], bearing: number) {
		const map = mapRef.current;
		if (!map) return;

		isEasingRef.current = true;

		map.easeTo({
			center: pos,
			bearing: orientationRef.current === "heading" ? bearing : 0,
			pitch: orientationRef.current === "heading" ? 45 : 0,
			zoom: ZOOM_LEVEL,
			duration: 800,
		});

		// After easeTo finishes (+100ms buffer), sync the camera refs to wherever
		// the puck currently is, then release the lock so jumpTo resumes normally.
		setTimeout(() => {
			isEasingRef.current = false;
			lastCameraPosRef.current = [...renderPosRef.current] as [number, number];
			lastCameraBearingRef.current = renderBearingRef.current;
		}, 900);
	}

	return { updatePuck, resetCursor, smoothLocate };
}
