import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { type CameraMode, type Orientation } from "../constants";
import { puckOffset } from "../lib/cameraPadding";

export function useCameraMode(mapRef: React.RefObject<mapboxgl.Map | null>) {
	const [cameraMode, setCameraMode] = useState<CameraMode>("following");
	const [orientation, setOrientation] = useState<Orientation>("heading");
	const followingRef = useRef<CameraMode>("following");
	const orientationRef = useRef<Orientation>("heading");
	const cameraTransitionRef = useRef<boolean>(true);
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
		// Turning or tilting the map by hand (right-drag, Ctrl-drag) lets go of the car too; the follow camera's own
		// moves have no originalEvent, so they never count.
		const onTurn = (event: { originalEvent?: Event }) => { if (event.originalEvent) enterTemporaryOverview(); };
		map.on("dragstart", onDrag);
		map.on("rotatestart", onTurn);
		map.on("pitchstart", onTurn);
		canvas.addEventListener("touchstart", onTouch, { passive: true });
		canvas.addEventListener("wheel", onWheel, { passive: true });
		return () => {
			map.off("dragstart", onDrag);
			map.off("rotatestart", onTurn);
			map.off("pitchstart", onTurn);
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
		// A dock at the left or right edge takes that much width off the free map.
		const sideDock = typeof document === "undefined" ? undefined : document.querySelector("[data-dock-side]")?.getBoundingClientRect();
		const width = mapRef.current.getContainer().clientWidth;
		const sideLeft = sideDock && sideDock.left < width / 2 ? sideDock.right + 24 : 0;
		const sideRight = sideDock && sideDock.left >= width / 2 ? width - sideDock.left + 24 : 0;
		mapRef.current.fitBounds(bounds, {
			padding: {
				top: topEdge != null ? topEdge + margin : height * 0.28,
				bottom: dockEdge != null ? height - dockEdge + margin : height * 0.25,
				left: Math.max(60, sideLeft),
				right: Math.max(60, sideRight),
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

	/**
	 * Heading up <-> north up. While following, `blend` (the puck hook's smoothLocate) carries the view across to the new orientation
	 * while still tracking the live puck: a fixed-target move toward where the car was a moment ago left the car sliding about on a moving
	 * GPS, and snapped when the follow camera took over again.
	 */
	function toggleOrientation(
		currentBearing: number,
		currentPosition: [number, number],
		blend?: () => void,
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

		if (followingRef.current === "following" && blend) {
			blend();
		} else if (followingRef.current === "following") {
			cameraTransitionRef.current = true;
			map.easeTo({
				center: currentPosition,
				bearing: next === "north" ? 0 : currentBearing,
				pitch: next === "north" ? 0 : 45,
				zoom: map.getZoom(),
				offset: puckOffset(map, 0.2),
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
