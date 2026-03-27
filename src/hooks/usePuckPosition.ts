import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import spaceShuttle from "../../public/models/space_shuttle.glb";
import textureUrl from "../../public/models/texture.jpg";
export function usePositionPuck(
	mapRef: React.RefObject<mapboxgl.Map | null>,
	mapLoaded: boolean,
	initialPos: [number, number],
	lowPerf: boolean,
) {
	const posRef = useRef<[number, number]>(initialPos);
	const bearingRef = useRef<number>(0);
	const lowPerfRef = useRef(lowPerf);

	// Keep ref in sync without re-running the effect
	useEffect(() => {
		lowPerfRef.current = lowPerf;
	}, [lowPerf]);

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
			antialias: !lowPerf, // set at creation time
			alpha: true,
		});
		renderer.setClearColor(0x000000, 0);
		renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

		const ringGeo = new THREE.RingGeometry(1.2, 1.8, 24); // reduced segments
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

		const dummyLayer: mapboxgl.CustomLayerInterface = {
			id: "puck-matrix-capture",
			type: "custom",
			renderingMode: "3d",
			onAdd() {
				// Nothign
			},
			render(_gl, matrix) {
				if (!camera || !scene || !renderer) return;

				// Skip pulse animation in low perf
				if (pulseRing && pulseMat) {
					if (lowPerfRef.current) {
						pulseRing.visible = false;
					} else {
						pulseRing.visible = true;
						const t = (Date.now() % 1800) / 1800;
						pulseRing.scale.setScalar(1 + t * 3);
						pulseMat.opacity = (1 - t) * 0.7;
					}
				}

				const pos = posRef.current;
				const brg = bearingRef.current;
				const mercator = mapboxgl.MercatorCoordinate.fromLngLat(
					{ lng: pos[0], lat: pos[1] },
					0,
				);
				const scale = mercator.meterInMercatorCoordinateUnits();
				const bearingRad = ((brg + 180) * Math.PI) / 180;
				const zoom = map.getZoom();
				const zoomFactor = Math.pow(2, Math.max(0, 16 - zoom));
				const modelScale = 3 * Math.min(zoomFactor, 8);

				const rotX = new THREE.Matrix4().makeRotationAxis(
					new THREE.Vector3(1, 0, 0),
					Math.PI / 2,
				);
				const rotY = new THREE.Matrix4().makeRotationAxis(
					new THREE.Vector3(0, 1, 0),
					-bearingRad,
				);
				const m = new THREE.Matrix4().fromArray(matrix);
				const l = new THREE.Matrix4()
					.makeTranslation(mercator.x, mercator.y, mercator.z ?? 0)
					.scale(
						new THREE.Vector3(
							scale * modelScale,
							-scale * modelScale,
							scale * modelScale,
						),
					)
					.multiply(rotX)
					.multiply(rotY);

				camera.projectionMatrix = m.multiply(l);
				renderer.render(scene, camera);
			},
		};

		const addLayer = () => {
			if (!map.getLayer("puck-matrix-capture")) map.addLayer(dummyLayer);
		};
		map.isStyleLoaded() ? addLayer() : map.once("styledata", addLayer);

		// Pulse interval — slower in low perf mode
		const pulseInterval = setInterval(() => {
			if (!lowPerfRef.current) map.triggerRepaint();
		}, 100);

		const onResize = () => {
			overlayCanvas.width = mapCanvas.width;
			overlayCanvas.height = mapCanvas.height;
			renderer.setSize(mapCanvas.width, mapCanvas.height, false);
		};
		map.on("resize", onResize);

		return () => {
			clearInterval(pulseInterval);
			map.off("resize", onResize);
			if (map.getLayer("puck-matrix-capture"))
				map.removeLayer("puck-matrix-capture");
			overlayCanvas.remove();
			renderer.dispose();
		};
	}, [mapLoaded]);

	function updatePuck(pos: [number, number], bearing: number) {
		posRef.current = pos;
		bearingRef.current = bearing;
		if (!lowPerfRef.current) mapRef.current?.triggerRepaint();
	}

	return { updatePuck };
}
