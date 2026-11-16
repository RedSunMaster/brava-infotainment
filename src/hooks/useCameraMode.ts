import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { type CameraMode, type Orientation } from "../constants";

export function useCameraMode(mapRef: React.RefObject<mapboxgl.Map | null>) {
	const [cameraMode, setCameraMode] = useState<CameraMode>("following");
	const [orientation, setOrientation] = useState<Orientation>("heading");
	const followingRef = useRef<CameraMode>("following");
	const orientationRef = useRef<Orientation>("heading");
	const cameraTransitionRef = useRef<boolean>(false);
	const recenterTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	function setMode(mode: CameraMode) {
		setCameraMode(mode);
		followingRef.current = mode;
	}

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		const canvas = map.getCanvas();

		const enterTemporaryOverview = () => {
			setMode("overview");
			if (recenterTimeoutRef.current) clearTimeout(recenterTimeoutRef.current);
			recenterTimeoutRef.current = setTimeout(() => setMode("following"), 12_000);
		};
		const onDrag = () => enterTemporaryOverview();
		const onWheel = () => enterTemporaryOverview();
		const onTouch = (event: TouchEvent) => {
			if (event.touches.length > 1) enterTemporaryOverview();
		};
		map.on("dragstart", onDrag);
		canvas.addEventListener("touchstart", onTouch, { passive: true });
		canvas.addEventListener("wheel", onWheel, { passive: true });
		return () => {
			map.off("dragstart", onDrag);
			canvas.removeEventListener("touchstart", onTouch);
			canvas.removeEventListener("wheel", onWheel);
			if (recenterTimeoutRef.current) clearTimeout(recenterTimeoutRef.current);
			if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
		};
	}, [mapRef.current]);

	function showOverview(coords: [number, number][]) {
		if (!mapRef.current || coords.length === 0) return;
		if (recenterTimeoutRef.current) clearTimeout(recenterTimeoutRef.current);
		setMode("overview");
		const bounds = coords.reduce(
			(b, c) => b.extend(c),
			new mapboxgl.LngLatBounds(coords[0], coords[0]),
		);
		// Fit the route into the map area that is actually free: below the cards
		// at the top and above the dock. Falls back to fixed proportions when the
		// overlays cannot be measured.
		const height = mapRef.current.getContainer().clientHeight;
		const edge = (selector: string, side: "top" | "bottom") =>
			typeof document === "undefined"
				? undefined
				: document.querySelector(selector)?.getBoundingClientRect()[side];
		const topEdge = edge("[data-top-overlay]", "bottom");
		const dockEdge = edge("[data-dock]", "top");
		const margin = 48;
		mapRef.current.fitBounds(bounds, {
			padding: {
				top: topEdge != null ? topEdge + margin : height * 0.28,
				bottom: dockEdge != null ? height - dockEdge + margin : height * 0.25,
				left: 60,
				right: 60,
			},
			pitch: 0,
			bearing: 0,
			duration: 800,
			maxZoom: 17,
			// Without this, Mapbox skips the animation when the OS has reduced
			// motion enabled and the camera jumps.
			essential: true,
		});
	}

	// Just re-enable following — the render loop's jumpTo takes over next frame.
	function resumeFollowing() {
		if (recenterTimeoutRef.current) clearTimeout(recenterTimeoutRef.current);
		setMode("following");
	}

	function toggleOrientation(
		currentBearing: number,
		currentPosition: [number, number],
	) {
		const map = mapRef.current;
		if (!map) return;
		const mapBearing = map.getBearing();
		const isNorth = orientationRef.current === "north";
		const duration = 650;

		// If already north-locked but map has drifted, snap north first
		if (isNorth && Math.abs(mapBearing) > 1) {
			map.easeTo({ bearing: 0, pitch: 0, duration: 500, essential: true });
			return;
		}

		const next: Orientation = isNorth ? "heading" : "north";
		orientationRef.current = next;
		setOrientation(next);

		if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);

		if (followingRef.current === "following") {
			cameraTransitionRef.current = true;
			map.easeTo({
				center: currentPosition,
				bearing: next === "north" ? 0 : currentBearing,
				pitch: next === "north" ? 0 : 45,
				zoom: map.getZoom(),
				offset: [0, map.getContainer().clientHeight * 0.2],
				duration,
				essential: true,
			});
			transitionTimeoutRef.current = setTimeout(() => {
				cameraTransitionRef.current = false;
			}, duration + 100);
		} else {
			map.easeTo({
				bearing: next === "north" ? 0 : currentBearing,
				pitch: next === "north" ? 0 : 45,
				duration,
				essential: true,
			});
		}
	}

	return {
		cameraMode,
		orientation,
		followingRef, // consumed by usePositionPuck render loop
		orientationRef, // consumed by usePositionPuck render loop
		cameraTransitionRef,
		showOverview,
		resumeFollowing,
		toggleOrientation,
	};
}
