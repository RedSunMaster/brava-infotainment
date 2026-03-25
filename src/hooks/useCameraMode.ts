import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { ZOOM_LEVEL, type CameraMode, type Orientation } from "../constants";
export function useCameraMode(mapRef: React.RefObject<mapboxgl.Map | null>) {
	const [cameraMode, setCameraMode] = useState<CameraMode>("following");
	const [orientation, setOrientation] = useState<Orientation>("heading");
	const followingRef = useRef<CameraMode>("following");
	const orientationRef = useRef<Orientation>("heading");

	function setMode(mode: CameraMode) {
		setCameraMode(mode);
		followingRef.current = mode;
	}

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;
		const canvas = map.getCanvas();

		// ── Single finger drag → overview mode ──
		const onDrag = () => setMode("overview");
		const onWheel = () => setMode("overview");
		map.on("dragstart", onDrag);
		canvas.addEventListener("wheel", onWheel, { passive: true });

		// ── Manual pinch zoom + rotate ────────────────────────────────────────
		let lastDist = 0;
		let lastAngle = 0;

		function getDist(a: Touch, b: Touch) {
			return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		}
		function getAngle(a: Touch, b: Touch) {
			return (
				(Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) /
				Math.PI
			);
		}

		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				lastDist = getDist(e.touches[0], e.touches[1]);
				lastAngle = getAngle(e.touches[0], e.touches[1]);
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (e.touches.length !== 2) return;
			e.preventDefault();

			const dist = getDist(e.touches[0], e.touches[1]);
			const angle = getAngle(e.touches[0], e.touches[1]);

			map.zoomTo(map.getZoom() + (dist - lastDist) * 0.01, { duration: 0 });
			map.setBearing(map.getBearing() + (angle - lastAngle));

			lastDist = dist;
			lastAngle = angle;
		};

		const onTouchEnd = () => {
			lastDist = 0;
			lastAngle = 0;
		};

		canvas.addEventListener("touchstart", onTouchStart, { passive: true });
		canvas.addEventListener("touchmove", onTouchMove, { passive: false });
		canvas.addEventListener("touchend", onTouchEnd, { passive: true });

		return () => {
			map.off("dragstart", onDrag);
			canvas.removeEventListener("wheel", onWheel);
			canvas.removeEventListener("touchstart", onTouchStart);
			canvas.removeEventListener("touchmove", onTouchMove);
			canvas.removeEventListener("touchend", onTouchEnd);
		};
	}, [mapRef.current]);

	function followPosition(
		pos: [number, number],
		bearing: number,
		elapsed: number,
	) {
		if (followingRef.current !== "following") return;
		mapRef.current!.easeTo({
			center: pos,
			bearing: orientationRef.current === "heading" ? bearing : 0,
			pitch: orientationRef.current === "heading" ? 45 : 0,
			zoom: ZOOM_LEVEL,
			duration: Math.min(elapsed, 1000),
		});
	}

	function showOverview(coords: [number, number][]) {
		if (!mapRef.current || coords.length === 0) return;
		setMode("overview");
		const bounds = coords.reduce(
			(b, c) => b.extend(c),
			new mapboxgl.LngLatBounds(coords[0], coords[0]),
		);
		mapRef.current.fitBounds(bounds, {
			padding: { top: 80, bottom: 80, left: 60, right: 60 },
			pitch: 0,
			bearing: 0,
			duration: 800,
			maxZoom: 14,
		});
	}

	function resumeFollowing(pos: [number, number], bearing: number) {
		setMode("following");
		const isNorth = orientationRef.current === "north"; // ✅ respect current mode
		mapRef.current!.easeTo({
			center: pos,
			bearing: isNorth ? 0 : bearing,
			pitch: isNorth ? 0 : 45,
			zoom: ZOOM_LEVEL,
			duration: 600,
		});
	}

	function toggleOrientation(currentBearing: number) {
		const mapBearing = mapRef.current?.getBearing() ?? 0;
		const isNorth = orientationRef.current === "north";

		if (isNorth && Math.abs(mapBearing) > 1) {
			mapRef.current!.easeTo({ bearing: 0, pitch: 0, duration: 500 });
			return;
		}

		// Otherwise toggle normally
		const next: Orientation = isNorth ? "heading" : "north";
		orientationRef.current = next;
		setOrientation(next);
		mapRef.current!.easeTo({
			bearing: next === "north" ? 0 : currentBearing,
			pitch: next === "north" ? 0 : 45,
			duration: 500,
		});
	}

	return {
		cameraMode,
		orientation,
		followPosition,
		showOverview,
		resumeFollowing,
		toggleOrientation,
	};
}
