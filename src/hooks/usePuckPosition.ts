import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import spaceShuttle from "../../public/models/space_shuttle.glb";
import textureUrl from "../../public/models/texture.jpg";

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

export function usePositionPuck(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
	initialPos: [number, number],
) {
	// GPS-side: raw target set on every tick
	const targetPosRef = useRef<[number, number]>(initialPos);
	const targetBearingRef = useRef<number>(0);

	// Render-side: continuously lerped toward target each frame
	const renderPosRef = useRef<[number, number]>(initialPos);
	const renderBearingRef = useRef<number>(0);

	// Per-frame lerp state
	const lastFrameTimeRef = useRef<number>(performance.now());

	useEffect(() => {
		if (!mapLoaded || !mapRef.current) return;
		const map = mapRef.current;
		const mapCanvas = map.getCanvas();
		const container = mapCanvas.parentElement!;

		const overlayCanvas = document.createElement("canvas");
		overlayCanvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none; z-index: 2;
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

		// Pulse ring
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

		// Model texture + loader
		const texture = new THREE.Texture();
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.flipY = false;

		const img = new Image();
		img.onload = () => {
			texture.image = img;
			texture.needsUpdate = true;
			new GLTFLoader().load(spaceShuttle, (gltf) => {
				gltf.scene.traverse((child) => {
					if ((child as THREE.Mesh).isMesh) {
						(child as THREE.Mesh).material = new THREE.MeshBasicMaterial({
							map: texture,
						});
					}
				});
				scene.add(gltf.scene);
				map.triggerRepaint();
			});
		};
		img.src = textureUrl;

		// Reusable matrix/vector objects — avoids GC pressure each frame
		const m4 = new THREE.Matrix4();
		const l4 = new THREE.Matrix4();
		const rotX = new THREE.Matrix4().makeRotationAxis(
			new THREE.Vector3(1, 0, 0),
			Math.PI / 2,
		);
		const rotY = new THREE.Matrix4();
		const scaleVec = new THREE.Vector3();

		// LERP_SPEED controls how tightly the rendered puck chases the GPS target.
		// Higher = snappier, lower = more lag/smoothing.
		// At 5, the puck covers ~99% of the gap in ~1 second — ideal for 1 Hz GPS.
		const LERP_SPEED = 5;

		const dummyLayer: mapboxgl.CustomLayerInterface = {
			id: "puck-matrix-capture",
			type: "custom",
			renderingMode: "3d",
			onAdd() {
				// Nothing
			},

			render(_gl, matrix) {
				if (!camera || !scene || !renderer) return;

				const now = performance.now();
				const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1); // seconds, capped at 100ms
				lastFrameTimeRef.current = now;

				// ── Exponential lerp — frame-rate independent ─────────────────────
				// alpha = fraction of remaining distance to close this frame.
				// Formula: 1 - e^(-speed * dt) gives consistent feel at any fps.
				const alpha = 1 - Math.exp(-LERP_SPEED * dt);

				renderPosRef.current = [
					renderPosRef.current[0] +
						(targetPosRef.current[0] - renderPosRef.current[0]) * alpha,
					renderPosRef.current[1] +
						(targetPosRef.current[1] - renderPosRef.current[1]) * alpha,
				];

				// Bearing: always take the shortest angular path
				let bDelta = targetBearingRef.current - renderBearingRef.current;
				if (bDelta > 180) bDelta -= 360;
				if (bDelta < -180) bDelta += 360;
				renderBearingRef.current += bDelta * alpha;

				// ── Pulse ring ────────────────────────────────────────────────────
				const pt = (Date.now() % 1800) / 1800;
				pulseRing.scale.setScalar(1 + pt * 3);
				pulseMat.opacity = (1 - pt) * 0.7;

				// ── Build transform matrix ────────────────────────────────────────
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
				scaleVec.set(
					scale * modelScale,
					-scale * modelScale,
					scale * modelScale,
				);

				m4.fromArray(matrix);
				l4.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0)
					.scale(scaleVec)
					.multiply(rotX)
					.multiply(rotY);

				camera.projectionMatrix = m4.multiply(l4);
				renderer.render(scene, camera);

				// Keep driving 60fps lerp and pulse ring continuously
				map.triggerRepaint();
			},
		};

		const addLayer = () => {
			if (!map.getLayer("puck-matrix-capture")) map.addLayer(dummyLayer);
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
			if (map.getLayer("puck-matrix-capture"))
				map.removeLayer("puck-matrix-capture");
			overlayCanvas.remove();
			renderer.dispose();
		};
	}, [mapLoaded]);

	function updatePuck(pos: [number, number], bearing: number, speedMs: number) {
		const dist = haversineMeters(renderPosRef.current, pos);

		// Teleport guard: snap instantly for large jumps (reroute / cold start)
		// or when effectively stationary so the puck doesn't crawl.
		if (dist > 500 || speedMs < 0.5) {
			renderPosRef.current = [...pos] as [number, number];
			renderBearingRef.current = bearing;
			targetPosRef.current = [...pos] as [number, number];
			targetBearingRef.current = bearing;
			mapRef.current?.triggerRepaint();
			return;
		}

		// Just update the target — the render loop lerps toward it continuously.
		targetPosRef.current = pos;
		targetBearingRef.current = bearing;
		// triggerRepaint not needed here: render loop is already running continuously.
	}

	return { updatePuck };
}
